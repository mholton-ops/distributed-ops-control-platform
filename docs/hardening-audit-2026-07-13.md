# Platform Hardening Audit — 2026-07-13

## Outcome

The audited system is a loopback-only PostgreSQL test platform. It is not deployed to IIS, public DNS, a LAN listener, or the Internet. The implementation findings below were repaired in this hardening pass unless explicitly marked as an accepted test-only boundary.

Priority meanings:

- **P1** — data integrity, credential exposure, or false operational state.
- **P2** — material reliability, security, accessibility, or operator-risk issue.
- **P3** — clarity, maintainability, polish, or evidence quality.

## Runtime and Security Boundary

| Priority | Audit item | Resolution |
| --- | --- | --- |
| P1 | API routes were usable without a real test access boundary. | Added constant-time bearer validation to versioned API routes and metrics; liveness/readiness remain probe-safe. |
| P1 | Browser access risked exposing or directly using the API bearer. | Kept the token in the Next.js server and moved mutations behind same-origin route handlers. |
| P1 | Mutation origin validation could trust an attacker-controlled Host/Origin pair. | Require one configured canonical loopback origin and an exact matching Host; reject missing or malformed origins. |
| P1 | A configured workbench or simulator could forward the bearer to an arbitrary URL. | Added explicit loopback/Compose API URL allowlists, scheme/port/path validation, and credential/query rejection. |
| P1 | A misconfigured API could connect mutating routes to an unintended PostgreSQL database. | Runtime now requires the `ops_test` user, `ops_control_test` database, a strong password, and a loopback/Compose host. |
| P1 | Compose made the application login the PostgreSQL cluster bootstrap superuser. | Split the ephemeral bootstrap administrator from `ops_test`; revoke public database/schema creation, grant only the schema capabilities needed for migrations/runtime, and fail health/readiness/migration checks on elevated attributes or memberships. |
| P1 | Runtime credentials could drift into local files. | Removed the populated ignored environment file; credentials remain process/container runtime values only. |
| P2 | A short or implicit bearer could weaken the test boundary. | Enforced a minimum 32-character token and removed known test fallback credentials. |
| P2 | Browser-supplied operator identities could falsify the audit actor. | Actor identity is explicit server configuration; mutation payload schemas reject actor aliases. |
| P2 | Web health could report healthy while API/database access was down. | Workbench readiness now performs a bounded upstream API readiness probe. |
| P2 | Container and host ports could be accidentally published broadly. | Compose publishes PostgreSQL, API, and web only on `127.0.0.1`; containers use an isolated service network. |
| P2 | Production-mode containers ran with broader privileges than needed. | Added multi-stage images, non-root runtime users, init handling, and `no-new-privileges`. |
| P2 | Image tags could drift between builds. | Pinned immutable Node and PostgreSQL image digests. |
| P3 | Probe/auth documentation was ambiguous. | Documented exact public probes, protected routes, loopback assumptions, and the absence of a workbench login/session. |

## Ledger, Replay, and Persistence Mechanics

| Priority | Audit item | Resolution |
| --- | --- | --- |
| P1 | Ledger append, side effects, and projection updates could diverge on failure. | Unified each accepted event into one PostgreSQL transaction with rollback coverage. |
| P1 | Concurrent events for one asset could allocate/apply state out of order. | Added per-asset advisory locking and monotonic projection sequence guards. |
| P1 | Source IDs alone could silently deduplicate different payloads. | Added canonical SHA-256 content hashes; exact retries deduplicate and changed content conflicts. |
| P1 | Business entity IDs could be rebound through a different source event ID. | Registration, transfer, inspection, and evidence IDs reject alias attempts before state changes. |
| P1 | Replay batch IDs could be reused with different content. | Persisted a canonical request hash and reject content/size/site mismatches. |
| P1 | Two workers could process one replay concurrently. | Batch reservation and row locking reject the second in-progress worker. |
| P1 | Replay retries did not preserve exact per-item provenance. | Persisted accepted, deduplicated, and rejected outcomes for every queue index with safe error codes. |
| P1 | A second lifecycle completion could overwrite a terminal batch. | Completion updates only a matching `processing` batch; later starts/completions conflict unless they are exact event retries. |
| P1 | Seed data manufactured stale sync state by appending duplicate lifecycle events. | Added internal replay timing injection for deterministic seed history and removed duplicate lifecycle markers. |
| P1 | Projection lag counts were inferred from global sequence gaps. | Query exact asset-stream sequence and exact accepted events after the projected sequence. |
| P2 | Internal lifecycle event types could be submitted as normal external events. | External event and replay schemas exclude internal sync/divergence/reconciliation events. |
| P2 | Oversized replay requests could consume unbounded work. | Added the documented 500-event replay cap and bounded query results. |
| P2 | Replay detail used only ledger events and hid rejected queue items. | Added durable event-attempt detail with disposition, source ID, hash, ledger link, and safe rejection context. |
| P2 | “Accepted” and “deduplicated” looked like disjoint totals. | Labels now state that accepted includes the deduplicated subset. |
| P2 | Graceful termination could abandon database resources abruptly. | Added signal handling and orderly HTTP/database shutdown. |
| P3 | Replay diagnostics and idempotency behavior were difficult to inspect. | Added batch diagnostics, affected assets/event types, rejection reasons, and linked ledger views. |

## Divergence, Alerts, and Reconciliation

| Priority | Audit item | Resolution |
| --- | --- | --- |
| P1 | Alert recurrence could create duplicate active work or stale timestamps. | Stable fingerprints reuse active alerts, increment recurrence, and update `last_detected_at`. |
| P1 | Automatic clearing could close alerts that still had an open case. | Clear only when the rule no longer finds the condition and no open reconciliation case owns it. |
| P1 | Case resolution could overwrite newer operator work. | Added optimistic version checks and one-winner transactional resolution. |
| P1 | Resolution could update a case without a matching ledger event. | Case state and `reconciliation_resolved` append in the same transaction. |
| P2 | High-severity findings lacked a consistent operator workflow. | High findings auto-open a case; all findings remain inspectable and manually caseable. |
| P2 | Dashboard alert severity mixed active-only high counts with all medium/low counts. | Severity mix now uses the same recent-alert population for every severity. |
| P2 | Policy values in UI/config/Compose could disagree. | API returns authoritative stale, transfer, and dual-site thresholds; the UI renders those values. |
| P2 | Recent alerts sorted/displayed first detection instead of recurrence. | Queries and UI use the authoritative last-detected time. |
| P3 | Global status could hide the rule causing degradation. | Added authoritative open-alert counts by rule and clearer scenario/global status language. |

## Simulator and Seed Quality

| Priority | Audit item | Resolution |
| --- | --- | --- |
| P1 | Static IDs with changing timestamps made simulator reruns conflict. | Scenario IDs, source IDs, and payload times are deterministic within a 30-minute run bucket. |
| P1 | A fixed historical epoch made rolling-window divergence scenarios stop working. | Later buckets rotate identity and stay current; the drift run asserts partial replay and its expected dual-site alert. |
| P2 | The “healthy” scenario lacked inspection evidence. | Added a completed inspection plus valid evidence metadata. |
| P2 | Unknown scenario names silently selected another workflow. | Invalid names fail with an explicit supported-scenario message. |
| P2 | The seed could be run destructively without a strong intent signal. | Seed requires the exact test-only guard and truncates only synthetic domain tables, preserving migration history. |
| P2 | Seed timestamps did not always trigger the named rolling-window rules. | Conflicting observations and sync history now fall inside their intended policy windows. |
| P2 | Simulator success meant only that HTTP calls returned. | Runtime assertions verify replay status and the expected alert; integration tests verify exact reruns. |
| P3 | Seed documentation misstated transfer/overdue totals. | Corrected the documented 12 assets, 11 transfers, and 3 overdue transfers. |

## Operator Workbench and Visual Layout

| Priority | Audit item | Resolution |
| --- | --- | --- |
| P1 | Browser mutations lacked durable pending/success/failure feedback. | Added disabled/pending states, validated messages, safe upstream errors, and refresh-on-success behavior. |
| P2 | Narrow layouts could cause page-level horizontal overflow. | Reworked shell/navigation/grid sizing and kept wide tables inside explicit horizontal scrollers. |
| P2 | Detail navigation did not consistently preserve active parent context. | Parent sections remain active across nested routes. |
| P2 | Pages could render blank or confusing states during load/failure/not-found. | Added loading, error, not-found, and configuration-aware states. |
| P2 | Data age and snapshot timing were unclear. | Added freshness labels and absolute-plus-relative timestamps. |
| P2 | Theme controls used radio semantics without radio keyboard behavior. | Added roving tab focus plus arrow, Home, and End selection behavior. |
| P2 | Theme choice and dark mode were not consistently legible. | Added persistent light/dark/system modes and audited contrast-aware tokens. |
| P2 | Tables lost hover feedback on even rows due to CSS ordering. | Applied striping before the hover rule so every row receives hover state. |
| P2 | Status pills reused incomplete tones for operational states. | Expanded semantic tones for lifecycle, inspection, replay, and reconciliation states. |
| P2 | Automated accessibility coverage was missing. | Added WCAG A/AA axe checks plus semantic/keyboard assertions in Playwright. |
| P3 | IDs and raw payloads overwhelmed operational views. | Added short IDs with full-value copy/title affordances and concise event summaries. |
| P3 | Filtering and selection lacked clear reset/selected-state cues. | Added explicit filters, reset paths, selected-row styling, and linked detail panels. |
| P3 | HTTP 200 was being treated as visual proof. | Added real desktop/mobile, light/dark screenshot capture and human visual review requirements. |

## Build, CI, and Operations

| Priority | Audit item | Resolution |
| --- | --- | --- |
| P1 | Dependency versions and runtime tools could drift. | Pinned Node 24, npm 11, exact direct dependencies, and the lockfile. |
| P1 | Next’s nested vulnerable PostCSS remained outside the initial override. | Added a root Next reference plus targeted PostCSS override; clean install and audit resolve to PostCSS 8.5.19. |
| P1 | API image pruning removed a runtime ORM dependency. | Changed production-only workspace installation so required externalized packages remain present. |
| P2 | Builds could pass using stale output. | Added clean-first builds and explicit artifact cleanup. |
| P2 | API TypeScript output was not a self-contained, predictable runtime bundle. | Added explicit esbuild entry points and production externals. |
| P2 | CI did not prove real persistence and browser behavior. | CI now provisions ephemeral PostgreSQL, migrates, integrates, seeds twice, runs Playwright/axe, and exercises Compose. |
| P2 | Container checks proved build success but not runtime posture. | Added in-image migrate/seed checks, non-root assertions, readiness, loopback port checks, and authenticated API smoke. |
| P2 | Bootstrap could close the caller’s PowerShell session. | Removed the wrapper-level `exit`; failures still propagate without terminating the shell. |
| P2 | Bootstrap could leave generated environment values behind. | Tracks and removes only values generated by that invocation. |
| P2 | Stop-only operation unnecessarily required an actor. | Stop gets a transient non-secret label; all startup/mutation workflows require an explicit actor. |
| P2 | Repository line endings and generated artifacts were inconsistent. | Added `.editorconfig`, `.gitattributes`, ignore rules, and Docker-context exclusions. |
| P3 | Operational runbooks omitted exact integration/E2E environment steps. | Added guarded build, migration, seed, integration, simulator, E2E, stop, and reset workflows. |

## Accepted Test-Only Boundaries

These are intentionally disclosed rather than presented as production-ready features:

- One shared bearer and one configured actor; no accounts, roles, SSO, sessions, tenant isolation, rotation, or revocation.
- HTTP on loopback/Compose only; no TLS termination or public ingress.
- One PostgreSQL instance; no backup, restore drill, high availability, or disaster recovery workflow.
- One cluster-restricted role performs both migrations and runtime DML; production should split schema ownership from a DML-only app role.
- A process crash during an in-progress replay may require disposal/reset of the synthetic test database; production would need a lease/recovery worker.
- Operational counters are process-memory metrics; durable metrics/log aggregation is not included.
- Evidence is metadata and hashes only; binary object storage, malware scanning, retention, and legal controls are out of scope.
- List endpoints are bounded but do not implement cursor pagination for large production datasets.
- The deterministic demo seed is destructive by design and is guarded for the canonical synthetic test database only.
- No IIS, SQL Server, public DNS, firewall, Cloudflare, or Internet deployment is included or authorized.

## Verification Contract

Completion requires a locked clean install, zero-vulnerability dependency audit, clean build, lint, all workspace typechecks, unit tests, compiled-start smoke, fresh PostgreSQL migration/integration, repeatable seed and simulator runs, production Compose runtime checks, browser mutation/accessibility/mobile checks, screenshot review, secret scan, and Git checkpoint. Current run evidence is recorded in `.codex/verification.md` and the latest local result packet.
