# ADR-0006: Kiosk session privacy and reset

- **Record date:** 2026-10-20 (reconstructed from the retained conversation and repository; original decision timestamp not preserved)
- **Status:** accepted
**Deciders:** project owner and implementation team

## Context

The kiosk is shared by strangers. A reload should not lose the current cart or an in-flight payment attempt, but the next customer must not see the previous customer's checkout. Persisting sensitive data would create unnecessary exposure.

## Decision

Store only item IDs and quantities for the cart in `sessionStorage`. While an attempt is pending, store only its idempotency key, quote ID, and mock scenario to resume by-key status resolution. After 60 seconds idle, show a continue-or-reset prompt and reset 15 seconds later unless continued. Clear the cart on reset or paid completion; reset paid confirmation after 30 seconds. Never auto-clear an unresolved payment.

## Alternatives considered

- **Memory-only cart:** rejected because it loses a cart on accidental reload and cannot recover a pending attempt.
- **Persist payment credentials:**
- **A longer five-minute warning and one-minute grace period:** considered in review, then rejected in favor of the supplied plan's faster kiosk privacy reset.

## Consequences

- A refresh can recover a cart and pending attempt without restoring prices or payment credentials.
- Idle reset limits how long an unattended kiosk displays the previous customer's cart.
- The short 60+15-second timing may affect some users; keep the continue action accessible and verify keyboard, screen-reader, zoom, and timing-adjustment needs on the target device.
