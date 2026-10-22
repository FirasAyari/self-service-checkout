# ADR-0007: Keep the take-home scope focused

- **Record date:** 2026-10-20 (reconstructed from the retained conversation and repository; original decision timestamp not preserved)
- **Status:** accepted
**Deciders:** project owner and implementation team

## Context

The assignment evaluates safe checkout behavior and engineering judgment. A complete commerce stack would require real payment operations, identity, fulfillment, support staffing, and multi-location inventory that the brief does not provide.

## Decision

Keep this implementation as a local single-location demo: simulated payment outcomes, no customer accounts, no cashier/kitchen/fulfillment workflow, no refunds, loyalty, coupons, tips, or production admin UI. Development-only protected endpoints support test catalog edits, reset, and mock chaos; they are disabled by default.

## Alternatives considered

- **Add a real PSP and card workflow:** rejected for this scope because it needs provider configuration, secure deployment, and a separate payment review.
- **Build staff/admin and fulfillment applications:** deferred because no staffed operating process or back-office requirements are defined.

## Consequences

- The app can demonstrate quote consent, idempotent order handling, stock reservations, and unknown outcomes without implying production readiness.
- The demo requires explicit manual reset for a permanently unknown mock attempt.
- A real pilot requires a payment provider, operational roles, a reachable customer support channel, an approved pending-order recovery procedure, and deployment/data-store decisions before launch. The configured kiosk help link gives the customer an escalation route but does not settle an order.
