# Distributed Ops Control Platform

A clean-room reference implementation showing how multi-site operations detect, explain, and resolve drift between accepted history and current operating state.

The system models sites that can work independently, reconnect later, replay queued events, and disagree about asset location, transfer status, evidence, or projected state. It turns those disagreements into explicit operator work instead of hiding them in mutable records.

[Mike Holton's portfolio](https://haldn.com/mike) | [GitHub profile](https://github.com/mholton-ops) | [Safety boundaries](docs/non-goals-and-safety-boundaries.md)

## Why This Matters

Distributed operations rarely fail as one obvious outage. They drift:

- A site works offline and syncs later.
- A transfer is physically complete but not confirmed.
- Two locations report conflicting observations.
- Required evidence is missing.
- A projection falls behind accepted events.
- A replay sends the same source event more than once.

This platform preserves accepted history, derives current state deterministically, detects disagreement, and gives an operator a traceable path to resolution.

## What Reviewers Can Verify

| Engineering concern | Visible proof |
| --- | --- |
| Immutable operating history | Append-only event log with normalized event inspection |
| Current-state performance | Deterministic asset projections derived from accepted events |
| Offline and delayed sync | Replay batches with accepted, rejected, and deduplicated outcomes |
| Idempotency | Source-site event identity prevents duplicate application |
| Drift detection | Rules for stale sites, missing evidence, overdue transfers, conflicting observations, and projection lag |
| Human control | Alerts become owned reconciliation cases with event-backed resolution |
| Traceability | Asset, transfer, sync, inspection, alert, and case views remain linked |

## Architecture at a Glance

~~~mermaid
flowchart LR
  Sites[Distributed Sites] -->|events and replay| API[Fastify API]
  API --> Log[(Append-Only Event Log)]
  API --> Project[Deterministic Projection]
  Project --> State[(Asset Projection)]
  Log --> Scan[Divergence Scanner]
  State --> Scan
  Scan --> Alerts[Alerts]
  Alerts --> Cases[Reconciliation Cases]
  Workbench[Operator Workbench] --> API
  Cases -->|controlled resolution| API
~~~

## Review in 5 Minutes

1. Open the dashboard and inspect system health, policy thresholds, and scenario state.
2. Open an asset detail page and compare projected state with accepted event sequence.
3. Open a reconciliation case to inspect its source alert, linked entities, evidence, and resolution writeback.
4. Open a sync batch to inspect accepted, rejected, and deduplicated replay results.
5. Run the tests that cover replay idempotency, projection correctness, stale-site detection, evidence gaps, and reconciliation.

## Seeded Demonstration Scenario

The deterministic seed creates a mixed operating state:

1. Twelve assets are registered across three sites.
2. Ten transfers are created; two remain unconfirmed beyond policy threshold.
3. Conflicting site observations generate alerts.
4. Two inspections intentionally lack evidence metadata.
5. A replay batch includes a duplicate source event to demonstrate idempotent handling.
6. One site remains stale beyond threshold.
7. One projection is intentionally placed behind the accepted stream.
8. A divergence scan opens reconciliation cases for high-severity findings.

The scenario is deliberately inspectable and repeatable. It is not random demo data.

## Core Model

- **Accepted event**: immutable source-of-truth record
- **Projection**: derived current-state view for fast operational reads
- **Alert**: explainable rule output showing where state and policy disagree
- **Reconciliation case**: operator-owned investigation and closure record
- **Sync batch**: replay envelope with accepted, rejected, and deduplicated outcomes

Supported event flows include asset registration and movement, transfer initiation and completion, inspection and evidence, site sync, divergence detection, and reconciliation.

See [Architecture](docs/architecture.md), [Domain Model](docs/domain-model.md), and [Event Model](docs/event-model.md).

## Technical Implementation

- TypeScript monorepo
- Fastify API
- PostgreSQL with Drizzle migrations
- Next.js operator workbench
- Shared Zod contracts
- Deterministic projection and divergence packages
- Replay and delay simulator
- Seeded scenarios plus unit and end-to-end tests

## Run Locally

Prerequisites:

- Docker and Docker Compose
- Node.js 20+

~~~bash
cp .env.example .env
docker compose up --build -d
docker compose exec api npm run db:migrate
docker compose exec api npm run seed
~~~

Endpoints:

- Operator workbench: http://localhost:3000
- API health: http://localhost:4000/health
- Dashboard API: http://localhost:4000/api/v1/dashboard

Run the simulator:

~~~bash
npm run start --workspace apps/simulator
~~~

Available deterministic scenarios:

~~~bash
SIM_SCENARIO=healthy-movement npm run start --workspace apps/simulator
SIM_SCENARIO=sync-lag-divergence npm run start --workspace apps/simulator
~~~

## Verification

~~~bash
npm test
npm run test:e2e
~~~

High-value tests cover:

- replay idempotency
- projection update correctness
- stale-site detection
- overdue transfer confirmation
- inspection evidence gaps
- reconciliation resolution events

## Repository Map

~~~text
apps/
  api/                 Fastify API and database access
  web/                 Next.js operator workbench
  simulator/           Deterministic replay and delay scenarios
packages/
  contracts/           Shared typed contracts and schemas
  domain/              Projection and divergence logic
  config/              Shared TypeScript configuration
  ui/                  Shared UI helpers
docs/
  architecture.md
  domain-model.md
  event-model.md
  non-goals-and-safety-boundaries.md
~~~

## Deep Review Path

1. Inspect [event ingestion and side effects](apps/api/src/domain/event-service.ts).
2. Inspect [operator-facing aggregation](apps/api/src/domain/query-service.ts).
3. Inspect [projection logic](packages/domain/src/projection.ts).
4. Inspect [divergence rules](packages/domain/src/divergence.ts).
5. Review asset, transfer, sync, reconciliation, and site detail pages.
6. Run the deterministic seed and test suite.

## Design Decisions

- **Append-only history plus derived projections** preserves auditability and replay semantics.
- **Rule-based divergence detection** keeps exceptions explainable to operators.
- **Explicit reconciliation workflows** make ownership and resolution visible.
- **A single relational database** keeps the public reference deterministic while still modeling multi-site drift.
- **Operator-focused interfaces** prioritize investigation and control over decorative dashboards.

## Public-Safe Boundary

This repository is original and public-safe. It intentionally omits proprietary schemas, customer data, protected workflow details, production authentication, binary evidence storage, and private integrations.

It demonstrates the control pattern and implementation depth without claiming to be a production deployment.
