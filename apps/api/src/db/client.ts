import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "./schema";
import { env } from "../lib/env";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  application_name: "distributed-ops-control-platform-api",
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  max: 10
});
export const db = drizzle(pool, { schema });

type DatabaseRoleBoundaryRow = {
  role_name: string;
  database_name: string;
  is_superuser: boolean;
  can_create_database: boolean;
  can_create_role: boolean;
  can_replicate: boolean;
  can_bypass_rls: boolean;
  has_role_memberships: boolean;
  can_create_database_objects: boolean;
  can_use_public_schema: boolean;
  can_create_in_public_schema: boolean;
};

export async function assertDatabaseRoleBoundary(client: Pool | PoolClient = pool): Promise<void> {
  const result = await client.query<DatabaseRoleBoundaryRow>(`
    select
      current_user::text as role_name,
      current_database()::text as database_name,
      r.rolsuper as is_superuser,
      r.rolcreatedb as can_create_database,
      r.rolcreaterole as can_create_role,
      r.rolreplication as can_replicate,
      r.rolbypassrls as can_bypass_rls,
      exists (select 1 from pg_auth_members m where m.member = r.oid) as has_role_memberships,
      has_database_privilege(current_user, current_database(), 'CREATE') as can_create_database_objects,
      has_schema_privilege(current_user, 'public', 'USAGE') as can_use_public_schema,
      has_schema_privilege(current_user, 'public', 'CREATE') as can_create_in_public_schema
    from pg_roles r
    where r.rolname = current_user
  `);
  const role = result.rows[0];
  if (
    !role ||
    role.role_name !== "ops_test" ||
    role.database_name !== "ops_control_test" ||
    role.is_superuser ||
    role.can_create_database ||
    role.can_create_role ||
    role.can_replicate ||
    role.can_bypass_rls ||
    role.has_role_memberships ||
    role.can_create_database_objects ||
    !role.can_use_public_schema ||
    !role.can_create_in_public_schema
  ) {
    throw new Error(
      "The database role violates the restricted ops_test/ops_control_test boundary; reset the disposable test volume."
    );
  }
}

export async function checkDatabaseReadiness(): Promise<{ ready: boolean; reason?: string }> {
  try {
    await assertDatabaseRoleBoundary();
    const table = await pool.query<{ migrations_table: string | null }>(
      "select to_regclass('public.schema_migrations')::text as migrations_table"
    );
    if (!table.rows[0]?.migrations_table) {
      return { ready: false, reason: "database migrations are not current" };
    }
    const result = await pool.query<{ migration_ready: boolean }>(
      "select exists (select 1 from schema_migrations where filename = '0002_integrity_hardening.sql') as migration_ready"
    );
    return result.rows[0]?.migration_ready
      ? { ready: true }
      : { ready: false, reason: "database migrations are not current" };
  } catch (error) {
    if (error instanceof Error && error.message.includes("database role violates")) {
      return { ready: false, reason: "database role violates the restricted test boundary" };
    }
    return { ready: false, reason: "database is unavailable" };
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
