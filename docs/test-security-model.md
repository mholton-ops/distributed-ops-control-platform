# Test Security Model

## Scope

This repository is a test and review system, not a public service. Its controls are designed to make local verification safer and more honest; they are not a substitute for production identity, authorization, tenancy, network segmentation, or secret management.

The supported topology is:

- PostgreSQL runs in a container and publishes only to `127.0.0.1` on the host.
- The API and web workbench publish only to `127.0.0.1` on the host.
- Containers may listen on their isolated Compose network so the web service can reach the API and the API can reach PostgreSQL.
- No IIS deployment, public DNS record, firewall publication, or Internet-facing listener is part of the supported test setup.

The API refuses runtime database URLs unless they use the canonical `ops_test` user, `ops_control_test` database, a strong password, and a loopback or Compose PostgreSQL host. PostgreSQL is initialized by a separate ephemeral bootstrap administrator. The `ops_test` role cannot act as superuser, create databases or roles, replicate, bypass row security, create database-level objects, or inherit another role; it receives only database connection/temporary access and `USAGE`/`CREATE` within the `public` schema needed by the combined migration/runtime test role. Database health, API readiness, and migration preflight all reject a role that violates this boundary. The workbench and simulator likewise refuse API targets outside the fixed loopback/Compose API allowlist, preventing their server-held bearer from being forwarded to an arbitrary URL.

## Authentication Boundary

All non-probe versioned API routes and operational metrics require a single test bearer token supplied through the server process environment. Health and readiness probes remain unauthenticated so local supervisors can determine whether a process is alive and whether PostgreSQL is reachable.

The Next.js workbench keeps the token on the server. Browser mutations call same-origin route handlers, which require the configured canonical loopback origin and host before forwarding the bearer token to the API. Missing or attacker-controlled `Origin`/`Host` values are rejected. The token must never use a `NEXT_PUBLIC_*` variable or be returned to browser JavaScript.

The workbench readiness probe checks both valid server configuration and bounded upstream API/database readiness. A live Next.js process is therefore not reported as ready when the API or database is unavailable.

The API records the configured test actor for reconciliation mutations. Browser-supplied actor fields are not accepted and strict request validation rejects them.

The workbench has no independent login or browser session. Its server-side handlers hold the shared test token, so any process that can reach the loopback web listener can operate the test UI. Loopback publication and control of the SKYNET test host are therefore part of this limited test boundary.

This is intentionally a single-operator test control. It does not provide accounts, roles, sessions, tenant isolation, token rotation, revocation, or production audit identity.

## Secret Handling

Separate bootstrap-administrator and app-role database passwords plus the test bearer token are required at runtime. They are not stored in Compose files, source, documentation, screenshots, logs, result packets, or committed environment files. The administrator password is supplied only to the PostgreSQL container; API, migration, simulator, and browser processes use only the restricted app-role connection.

For an operator-managed run, populate process environment variables from an approved vault or credential-reference workflow. A shell-scoped cryptographically random value is also suitable for a disposable local verification run, provided it is not printed or persisted.

## Data Boundary

Only deterministic synthetic data belongs in this system. Evidence records contain metadata and content hashes, not customer files or real media. Screenshots and test artifacts must remain public-safe and must not contain credentials, connection strings, private host information, or personal data.

The confirmed demo seed clears and rebuilds the synthetic domain tables in `ops_control_test`; it preserves schema migration history but is not a merge or production-safe import workflow.

The same restricted `ops_test` role owns the objects it creates during migrations and performs runtime DML for this test system. A production design should split a schema-owning migrator from a DML-only runtime role.

## Before Any Broader Deployment

A separate production design and authorization review would be required before exposing this system beyond loopback. At minimum, that review would need to add real identity and role authorization, managed secrets, TLS, network policy, durable observability, backup and recovery, data retention, abuse controls, dependency and image patch operations, and a deployment-specific threat model.
