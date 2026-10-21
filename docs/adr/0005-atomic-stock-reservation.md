# ADR-0005: Atomic stock reservation

- **Record date:** 2026-10-20 (reconstructed from the retained conversation and repository; original decision timestamp not preserved)
- **Status:** accepted
**Deciders:** project owner and implementation team

## Context

Two customers may try to buy the last item at nearly the same time. A read-then-write check can let both see stock as available and oversell it. A reservation must remain consistent with the pending order even if payment later declines or is unclear.

## Decision

Inside a short database transaction, conditionally decrement finite stock, insert the pending order and its line snapshots, and claim the idempotency key. A definite decline restores stock once in the settlement transaction. An unknown outcome keeps its reservation until a durable outcome is available.

## Alternatives considered

- **Read stock then save a decrement:** rejected because concurrent requests can race between the read and write.
- **Hold a database transaction while contacting a payment processor:** rejected because slow external I/O would hold database locks and transactions open.

## Consequences

- Finite stock cannot go below zero through concurrent checkout attempts.
- Order, idempotency, and reservation state commit or roll back together.
- Unknown outcomes can hold stock until reconciliation or an explicit Development reset; SQLite is intended for a single-location demo, not multi-instance traffic.
