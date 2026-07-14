#!/bin/sh
set -eu

: "${OPS_TEST_DB_PASSWORD:?OPS_TEST_DB_PASSWORD is required}"

actual="$({
  PGPASSWORD="$OPS_TEST_DB_PASSWORD" psql \
    --host 127.0.0.1 \
    --username ops_test \
    --dbname ops_control_test \
    --no-password \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --command "select current_user, current_database(), r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls, exists (select 1 from pg_auth_members m where m.member = r.oid), has_database_privilege(current_user, current_database(), 'CREATE'), has_schema_privilege(current_user, 'public', 'USAGE'), has_schema_privilege(current_user, 'public', 'CREATE') from pg_roles r where r.rolname = current_user"
} 2>/dev/null || true)"

expected="ops_test|ops_control_test|f|f|f|f|f|f|f|t|t"
if [ "$actual" != "$expected" ]; then
  echo "The ops_test database role is unavailable or violates the least-privilege test boundary. Reset the disposable test volume." >&2
  exit 1
fi
