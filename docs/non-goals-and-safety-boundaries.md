# Non-Goals and Safety Boundaries

## Non-Goals

- Reproducing any proprietary platform behavior
- Replicating confidential schemas or terminology
- Including customer-specific workflows
- Solving every distributed systems failure mode
- Building a production identity, authorization, or tenancy layer
- Hosting the application on a public or non-loopback interface
- Treating the test bearer token as a production security control

## Safety Boundaries

- Generic domain terms only: sites, assets, transfers, inspections, evidence metadata, sync batches, alerts, reconciliation cases
- No protected industry-specific logic or naming
- No real business thresholds from prior systems
- No real customer records, media, or screenshots
- No copied internal documentation text
- No committed passwords, tokens, connection strings, or known default credentials
- No browser-visible API token; the workbench uses server-side same-origin handlers

## Public-Safe Design Choices

- Explicitly generic divergence rules
- Deterministic simulator with synthetic IDs
- Synthetic, content-addressed evidence metadata only; no binary evidence payloads
- Generic status vocab and generic operational metrics
- Loopback-only host publication for PostgreSQL, API, and web test ports
- Runtime-only credentials supplied through approved secret plumbing

See [Test Security Model](test-security-model.md) for the supported topology and the controls required before any broader deployment.
