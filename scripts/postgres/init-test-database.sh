#!/bin/sh
set -eu

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${OPS_TEST_DB_PASSWORD:?OPS_TEST_DB_PASSWORD is required}"

if [ "$POSTGRES_USER" != "ops_bootstrap_admin" ] || [ "$POSTGRES_DB" != "ops_control_test" ]; then
  echo "Refusing to initialize outside the canonical test database boundary." >&2
  exit 1
fi

if [ "${#OPS_TEST_DB_PASSWORD}" -lt 24 ]; then
  echo "OPS_TEST_DB_PASSWORD must contain at least 24 characters." >&2
  exit 1
fi

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
REVOKE ALL ON DATABASE ops_control_test FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\getenv app_password OPS_TEST_DB_PASSWORD
CREATE ROLE ops_test
  LOGIN
  PASSWORD :'app_password'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS;
GRANT CONNECT, TEMPORARY ON DATABASE ops_control_test TO ops_test;
GRANT USAGE, CREATE ON SCHEMA public TO ops_test;
ALTER ROLE ops_test IN DATABASE ops_control_test SET search_path TO public;
SQL
