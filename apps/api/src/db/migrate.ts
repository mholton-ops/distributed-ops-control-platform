import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { assertDatabaseRoleBoundary, pool } from "./client";

const migrationLockKey = "distributed-ops-control-platform:migrations";

function checksum(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await assertDatabaseRoleBoundary(client);
    await client.query("select pg_advisory_lock(hashtext($1))", [migrationLockKey]);
    await client.query(`
      create table if not exists schema_migrations (
        id serial primary key,
        filename text not null unique,
        checksum varchar(64),
        applied_at timestamptz not null default now()
      )
    `);
    await client.query("alter table schema_migrations add column if not exists checksum varchar(64)");

    const directory = path.resolve(process.cwd(), "src", "db", "migrations");
    const entries = (await readdir(directory)).filter((entry) => entry.endsWith(".sql")).sort();
    for (const filename of entries) {
      const migrationSql = await readFile(path.join(directory, filename), "utf8");
      const migrationChecksum = checksum(migrationSql);
      const prior = await client.query<{ checksum: string | null }>(
        "select checksum from schema_migrations where filename = $1",
        [filename]
      );
      if (prior.rows[0]) {
        if (prior.rows[0].checksum && prior.rows[0].checksum !== migrationChecksum) {
          throw new Error(`Applied migration checksum mismatch: ${filename}`);
        }
        if (!prior.rows[0].checksum) {
          await client.query(
            "update schema_migrations set checksum = $2 where filename = $1 and checksum is null",
            [filename, migrationChecksum]
          );
        }
        continue;
      }

      await client.query("begin");
      try {
        await client.query(migrationSql);
        await client.query(
          "insert into schema_migrations (filename, checksum) values ($1, $2)",
          [filename, migrationChecksum]
        );
        await client.query("commit");
        // eslint-disable-next-line no-console
        console.log(`Applied migration ${filename}`);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext($1))", [migrationLockKey]);
    } finally {
      client.release();
    }
  }
}

runMigrations()
  .then(() => pool.end())
  .catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error("Migration failed", error);
    await pool.end();
    process.exit(1);
  });
