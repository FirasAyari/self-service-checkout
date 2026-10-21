# ADR-0003: Idempotency and unknown payment outcomes

- **Record date:** 2026-10-20 (reconstructed from the retained conversation and repository; original decision timestamp not preserved)
- **Status:** accepted
**Deciders:** project owner and implementation team

## Context

Checkout can lose a response after the server starts an attempt. Retrying with a new key risks duplicate orders. A payment lookup with no ledger result also does not establish whether payment occurred. The plan's raw-body pre-claim and automatic expiry on missing ledger evidence could create unstable claims or an unsafe false decline.

## Decision

Fingerprint a normalized quote ID and mock outcome. Create the idempotency record, pending order, and stock reservation in one database transaction. Replay the same key against that fingerprint. Keep attempts pending and inventory reserved when payment remains unknown; settle only from an authoritative mock-ledger result.

## Alternatives considered

- **Hash raw JSON and insert a key before validation:** rejected because formatting/order can change the hash and an early claim can be stranded by validation failure.
- **Release stock when no ledger row is found:** rejected because absence of evidence is not proof that no payment happened.

## Consequences

- A valid retry resolves the existing attempt rather than creating a second order.
- Unknown attempts can hold stock until resolved or explicitly managed; the demo's `StillUnknown` scenario may remain pending indefinitely.
- A real processor integration must define authoritative lookup, retention, timeouts, and reconciliation semantics before deployment.
