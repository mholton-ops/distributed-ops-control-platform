# ADR-001: Append-Only Event Ledger with Projection Read Model

## Status
Accepted

## Context
The platform must support auditability, replay, and offline sync ingestion.

## Decision
Use an append-only `event_log` as source of truth and maintain `asset_projection` as deterministic current-state materialization. Enforce append-only behavior with a database trigger, bind source identity to a canonical event hash, and commit event append, side effects, and projection advancement in one transaction. Serialize writes per asset so reducer order follows ledger order under concurrency.

## Consequences
- Pros: replayable history, payload-aware idempotency, atomic domain state, strong audit trail, easier divergence analysis
- Cons: requires projection maintenance, transaction-lock discipline, sequence integrity checks, and an explicit recovery design for interrupted work
