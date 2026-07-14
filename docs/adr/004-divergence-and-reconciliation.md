# ADR-004: Rule-Based Divergence Engine with Reconciliation Escalation

## Status
Accepted

## Context
Operational exceptions must be visible and actionable without proprietary business logic.

## Decision
Implement generic rule-based divergence detection with fingerprinted alert lifecycle records and automatic reconciliation case creation for high-severity findings. Preserve acknowledgement across repeated detections, allow resolved findings to recur, and use optimistic case versions plus event-backed resolution.

## Consequences
- Pros: transparent rules, auditable recurrence history, duplicate-resistant case creation, practical exception handling workflow
- Cons: rules and lifecycle policy require tuning as domain complexity grows; a production deployment would need escalation and ownership authorization
