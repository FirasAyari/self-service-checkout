# ADR-0002: No payment data in the simulated checkout

- **Record date:** 2026-10-21 (revised)
- **Status:** accepted
- **Deciders:** project owner and implementation team

## Context

The original plan described card-field validation, formatting, and numeric keypad hints. This product has no payment provider and creates no real charge. Asking kiosk customers for card number, expiry, or security code would imply a real payment step and could invite entry of real credentials even when the interface warns against it.

## Decision

The simulated checkout collects no payment details. After reviewing the authoritative quote, the customer can place the demo order directly. The order API receives only the quote ID, idempotency key, and simulated outcome. No card fields, card-like test values, or payment tokens are rendered, sent, stored, logged, or captured.

## Alternatives considered

- **Keep browser-only card validation:** rejected because it asks customers for unnecessary sensitive-looking data and misrepresents the demo.
- **Send values to a mock token endpoint:** rejected because it creates an unnecessary payment-data server boundary.
- **Integrate a live provider now:** outside the demo scope; it requires provider configuration, secure deployment, and a separate payment review.

## Consequences

- Original plan criteria AC-Y1 and AC-Y2 are intentionally out of scope and recorded as deviations in the trace table.
- AC-D7 covers the replacement behavior: the checkout requests no payment details and lets the customer place a simulated order.
- Simulated outcomes remain independent of customer-provided credentials. Production copy continues to identify the result as simulated and state that no money was charged.
- A future real-payment product requires a separately reviewed payment design and provider-hosted or otherwise approved collection boundary.
