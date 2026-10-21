# ADR-0002: Client-only card validation with no payment data transfer

- **Record date:** 2026-10-20 (revised from the retained implementation decision)
- **Status:** accepted
**Deciders:** project owner and implementation team

## Context

The implementation plan requires card-field validation, formatting, and numeric keypad hints. This demo has no real payment provider, so card values must not cross the browser boundary or be treated as payment credentials. Repository guidance forbids sending PAN, expiry, CVC, or payment tokens to the order API, database, browser storage, logs, or screenshots.

## Decision

Allow test-only card values in the payment screen for local format validation. Keep them in that component's memory, clear them as soon as submission starts, and send only the quote ID, idempotency key, and selected simulated outcome to the order API. Do not create a payment token or persist, log, or capture the field values. Tell customers never to enter a real card.

## Alternatives considered

- **No card fields:** safe, but leaves the plan's card validation, formatting, and numeric keypad criteria unimplemented.
- **Send fields to a mock tokenization endpoint:** rejected because it creates an unnecessary payment-data server boundary and conflicts with the repository's order API restrictions.
- **Integrate a live provider now:** outside the demo's scope and requires provider credentials, deployment controls, and a separately reviewed payment flow.

## Consequences

- AC-Y1 and AC-Y2 are implemented and tested with generated test values; browser tests disable screenshots and traces while entering them.
- Payment outcomes remain simulated through the demo outcome selector. Card values do not determine approval or decline and are not a payment method.
- The original `/payment-tokens` endpoint, tokenized order request, provider behavior, and card-specific gateway outcomes are not implemented.
- A production payment feature must use a provider-hosted or otherwise reviewed tokenization boundary and be assessed independently.
