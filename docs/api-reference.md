# API Reference

## Base URL

- Loopback test API: `http://127.0.0.1:4000`
- Versioned API: `http://127.0.0.1:4000/api/v1`

The API is not supported on a public listener.

## Test Authentication

Every `/api/v1/*` endpoint except versioned liveness/readiness, plus both metrics routes, requires `Authorization: Bearer <runtime test token>`. The token is supplied to server processes through `OPS_TEST_AUTH_TOKEN`; it is never a browser-visible variable.

The API records `OPS_TEST_ACTOR` for reconciliation writes. `openedBy` and `resolvedBy` are not accepted from clients. This is a single-operator test control, not a production account or role model.

## Health and Metrics

- `GET /health` and `GET /api/v1/health`: unauthenticated process liveness and uptime
- `GET /ready` and `GET /api/v1/ready`: unauthenticated PostgreSQL/migration readiness; returns `503` when unavailable
- `GET /metrics` and `GET /api/v1/metrics`: authenticated in-memory operational counters

## Core Read Endpoints

- `GET /api/v1/dashboard`
- `GET /api/v1/sites`
- `GET /api/v1/sites/:siteId`
- `GET /api/v1/assets`
- `GET /api/v1/assets/:assetId`
- `GET /api/v1/assets/:assetId/events`
- `GET /api/v1/transfers`
- `GET /api/v1/transfers/:transferId`
- `GET /api/v1/sync-batches`
- `GET /api/v1/sync-batches/:syncBatchId`
- `GET /api/v1/alerts`
- `GET /api/v1/evidence-metadata`
- `GET /api/v1/reconciliation-cases`
- `GET /api/v1/reconciliation-cases/:caseId`

## Core Write Endpoints

- `POST /api/v1/events`
- `POST /api/v1/sync/replay`
- `POST /api/v1/divergence/scan`
- `POST /api/v1/reconciliation-cases`
- `PATCH /api/v1/reconciliation-cases/:caseId/resolve`

## Request/Response Notes

- Requests are validated with Zod contracts (`packages/contracts`).
- Event payload schema depends on `eventType`; unknown fields and inconsistent cross-field IDs are rejected.
- Direct ingestion and replay accept external operating events only. Lifecycle/divergence/reconciliation events are server-generated.
- Direct events and every replay item require a stable `sourceSiteEventId`.
- Replay batches contain at most 500 events and persist one disposition per submitted index.
- API errors use structured payload:

```json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "Readable failure message",
    "details": {}
  }
}
```

Unknown server failures return a generic message without database internals. Authentication failures use `AUTHENTICATION_REQUIRED`; validation, identity reuse, replay state, and case-version conflicts have distinct codes.

## Example: Ingest Event

`POST /api/v1/events`

```json
{
  "eventType": "transfer_initiated",
  "assetId": "7b4b2d2f-88fb-4d8d-931a-6a5645f1e7c2",
  "siteId": "9f1a3d29-8db1-4d2e-9c7f-4c6e46d5b2a1",
  "transferOrderId": "6d55f8f7-5ddf-4c07-91f7-26d1b91a9f20",
  "occurredAt": "2026-04-13T19:35:08.204Z",
  "sourceSiteEventId": "north-transfer-init-001",
  "payload": {
    "transferOrderId": "6d55f8f7-5ddf-4c07-91f7-26d1b91a9f20",
    "originSiteId": "9f1a3d29-8db1-4d2e-9c7f-4c6e46d5b2a1",
    "destinationSiteId": "c55f6935-40df-4aa7-9f84-5b9c8e5f9a60",
    "initiatedBy": "north-operator"
  }
}
```

Response:

```json
{
  "data": {
    "eventId": "dc1e5f53-22ec-4593-9e7f-77e83ccf4f74",
    "sequenceNumber": 42,
    "deduplicated": false,
    "eventHash": "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

## Flow Summary

1. API validates event envelope + type-specific payload.
2. API serializes writes for the affected asset and computes a canonical event hash.
3. An exact source-key retry returns the original event; different content under the same key is a `409` conflict.
4. Event append, deterministic side effects, and projection advancement commit as one PostgreSQL transaction.

## Example: Replay Outcome

`POST /api/v1/sync/replay` returns batch status/counts plus durable item dispositions:

```json
{
  "data": {
    "syncBatchId": "cb16f437-d84e-4f7e-a3b8-66c4f7376d1d",
    "status": "partial",
    "acceptedEventCount": 1,
    "rejectedEventCount": 1,
    "deduplicatedEventCount": 0,
    "rejectionReasons": ["INVALID_EVENT: Replay event payload is invalid"],
    "dispositions": [
      {
        "index": 0,
        "sourceSiteEventId": "north-queued-001",
        "eventHash": "0000000000000000000000000000000000000000000000000000000000000000",
        "disposition": "accepted",
        "eventId": "dc1e5f53-22ec-4593-9e7f-77e83ccf4f74",
        "sequenceNumber": 42,
        "errorCode": null,
        "errorMessage": null
      },
      {
        "index": 1,
        "sourceSiteEventId": "north-queued-002",
        "eventHash": "1111111111111111111111111111111111111111111111111111111111111111",
        "disposition": "rejected",
        "eventId": null,
        "sequenceNumber": null,
        "errorCode": "INVALID_EVENT",
        "errorMessage": "Replay event payload is invalid"
      }
    ]
  }
}
```

Reusing a completed batch ID with identical content returns the persisted result. Different content returns `SYNC_BATCH_CONTENT_CONFLICT`; a concurrent worker receives `SYNC_BATCH_IN_PROGRESS`.

## Reconciliation Writes

Manual case creation requires an explicit valid `siteId`, `title`, and `description`. The API validates optional alert/asset references and derives the recorded actor server-side.

Resolution requires `resolutionSummary` and `expectedVersion`. `resolvedAssetStatus` is required for an asset-linked case and must be omitted for a site-level case. Stale writes return `CASE_VERSION_CONFLICT`; a successful resolution appends its immutable event and atomically updates the case plus its linked alert and asset projection when present and applicable.

## Non-Goals

- Not a full public API product surface.
- Not version-negotiated backward compatibility guarantees.
- Not an implementation of confidential endpoint contracts.
- Not a production authentication or authorization contract.
