# ADR-0004: Server-authoritative pricing and consent

- **Record date:** 2026-10-20 (reconstructed from the retained conversation and repository; original decision timestamp not preserved)
- **Status:** accepted
**Deciders:** project owner and implementation team

## Context

A customer can leave the menu open while prices or availability change. Browser totals are convenient estimates, but they cannot be trusted to set the amount for an order. The customer must see and accept a current total before a reservation/payment attempt.

## Decision

The API creates an opaque, short-lived quote from catalog prices and available stock. The order API accepts the quote ID and revalidates its snapshot against current catalog state. An expired quote or changed price/stock is rejected; the customer must review a fresh quote before continuing.

## Alternatives considered

- **Trust a client-supplied total:** rejected because a client can change it and stale menu prices could charge an amount not seen.
- **Send only cart lines and charge current prices without consent:** rejected because repricing must be shown before the customer agrees.

## Consequences

- All money is integer cents computed by the server; quoted order lines snapshot names and prices.
- A menu change can require a second review/consent step.
- The client uses cached prices only for estimates; quote and order responses are authoritative.
