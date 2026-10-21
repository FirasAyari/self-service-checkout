# Acceptance-criteria traceability

This table maps the plan's criteria to business rules and scenarios. `scripts/traceability.mjs` scans `backend/tests/`, `frontend/src/*.{test,spec}.*`, `frontend/e2e/`, and delivery contract tests for acceptance IDs in named tests. A string or comment elsewhere in a test file does not satisfy the gate. `Deviated: ADR-####` rows are reported separately and never counted as coverage.

Use `make trace` for the strict gate. Each `Required` criterion needs the ID in an xUnit `DisplayName` or method name, Vitest test name, Playwright test name, or delivery test name. The gate reports deviations separately.

| AC | Criterion | Business rules | Scenario | Disposition |
| --- | --- | --- | --- | --- |
| AC-M1 | Initial menu renders category, item, price, and availability with loading feedback. | BR-M1, BR-M6 | SC-A1 | Required |
| AC-M2 | Sold-out items are visible, disabled, and announced unavailable. | BR-M2 | SC-B2 | Required |
| AC-M3 | Initial menu failure provides retry; automatic retry waits are 2, 4, 8, then capped at 15 seconds, without showing an empty menu. | BR-M6, BR-K6 | SC-E1 | Required |
| AC-M4 | Later refresh failure retains the current menu and signals reconnection. | BR-M6, BR-P1 | SC-C5 | Required |
| AC-M5 | Menu changes refresh the grid and affected cart lines are identified. | BR-M3, BR-P3 | SC-C5 | Required |
| AC-M6 | The menu exposes valid size and add-on choices and preserves one consistent option set per item. | BR-M1, BR-C2, BR-C7, BR-P6 | SC-A4 | Required |
| AC-C1 | Add action updates cart count and total within 100 ms with visible feedback. | BR-C1, BR-C6 | SC-B3 | Required |
| AC-C2 | Repeated add for one item increments one line. | BR-C1 | SC-B3 | Required |
| AC-C3 | Per-item limit disables add and explains the cap. | BR-C1, BR-C2 | SC-B1 | Required |
| AC-C4 | Decrement at one removes the line and offers undo. | BR-C3 | SC-F6 | Required |
| AC-C5 | Clearing a larger cart requires confirmation. | BR-C3 | SC-F7 | Required |
| AC-C6 | Refresh restores planned cart state; idle reset clears it. | BR-C5, BR-K1 | SC-D6 | Required |
| AC-C7 | Cart line, unit, and total limits are explained before add. | BR-C2 | SC-B2 | Required |
| AC-R1 | Review requests an authoritative quote and displays its lines and total. | BR-M6, BR-C6 | SC-A3 | Required |
| AC-R2 | Quote stock problems offer a one-tap reduce/remove action and block payment until corrected and re-quoted. | BR-P3, BR-S1 | SC-C1 | Required |
| AC-R3 | Changed price requires explicit acceptance. | BR-P2 | SC-C3 | Required |
| AC-R4 | Review total, Pay button total, accepted quote, and charged total agree. | BR-P1, BR-Y8 | SC-A1 | Required |
| AC-R5 | Empty cart cannot be reviewed or submitted. | BR-C4 | SC-B9 | Required |
| AC-R6 | The server prices selected options and includes their names and prices in the paid order snapshot. | BR-P1, BR-P4, BR-P6 | SC-A4 | Required |
| AC-Y1 | Original plan: require valid card number, expiry, and CVC before checkout. | BR-Y1 | SC-B4 | Deviated: ADR-0002 |
| AC-Y2 | Original plan: format card fields and request numeric keyboards. | BR-Y1 | SC-B5 | Deviated: ADR-0002 |
| AC-Y3 | Submit locks immediately and creates at most one order. | BR-K4, BR-O3 | SC-D5 | Required |
| AC-Y4 | Approval reaches confirmation within 1 second in the simulated checkout. | BR-O5 | SC-A1 | Required |
| AC-Y5 | Definite decline explains no charge, retains the cart, and permits a new attempt. | BR-Y4, BR-O2 | SC-D1 | Required |
| AC-Y6 | Unknown payment has no second Pay action and remains resolving without claiming it was declined. | BR-Y5, BR-Y7 | SC-D3 | Required |
| AC-Y7 | Plan's repeated-decline limit locks payment temporarily. | BR-Y6 | SC-D9 | Required |
| AC-Y8 | Back from payment returns to review with cart intact. | BR-C5 | SC-A2 | Required |
| AC-O1 | A new paid order returns 201 with a public reference, pickup number, lines, total, and PAID status. | BR-O4, BR-O5 | SC-A1 | Required |
| AC-O2 | Same key and request replay without another order or charge. | BR-O1, BR-O3 | SC-D7 | Required |
| AC-O3 | Same key with a different request returns 422 `IDEMPOTENCY_KEY_REUSED`. | BR-O1 | SC-D7 | Required |
| AC-O4 | Concurrent orders receive unique contiguous numbers without oversell. | BR-O5, BR-S1 | SC-G6 | Required |
| AC-O5 | Confirmation shows the pickup number at 96 px or larger, item summary, charged amount, and countdown. | BR-K3 | SC-F4 | Required |
| AC-O6 | Orders and stock persist across API restart. | BR-O6 | SC-E3 | Required |
| AC-O7 | Stock is decremented once and released once after an authoritative decline. | BR-S1, BR-S2 | SC-C6 | Required |
| AC-O8 | After 30 seconds, reconciliation settles a durable ledger result; no ledger result remains pending with stock reserved. | BR-Y7 | SC-D10, SC-D11 | Required |
| AC-K1 | Idle warning can be dismissed; expiry clears the session. | BR-K1 | SC-F1 | Required |
| AC-K2 | Idle reset is suspended while processing or confirming. | BR-K2 | SC-F12 | Required |
| AC-K3 | Confirmation reset does not reveal a prior order with Back. | BR-K3 | SC-F5 | Required |
| AC-K4 | At 1280×800 and 768×1024, primary checkout controls remain in the viewport and reachable. | BR-K7 | SC-F9 | Required |
| AC-K5 | Accessibility checks cover labels, live announcements, focus order, and serious/critical violations. | BR-K5, BR-K6 | SC-F11 | Required |
| AC-D1 | Clean setup and dev commands run from README on Unix or Docker. | — | SC-E8 | Required |
| AC-D2 | Test, E2E, check, and trace targets execute their documented checks. | — | — | Required |
| AC-D3 | README and demo guide explain simulated payment and chaos demo paths. | — | SC-D1 | Required |
| AC-D4 | OpenAPI is committed as a drift-checked snapshot and generates browser contract types. | — | — | Required |
| AC-D5 | Production checkout hides the simulated outcome chooser and forces standard simulated approval in both client and server. | BR-X7 | SC-G8 | Required |
| AC-D6 | Expired quote cleanup retains a 24-hour window and deletes at most 500 stale quotes per batch. | BR-X8 | SC-G9 | Required |
| AC-D7 | Simulated checkout collects no payment details and lets the customer place a demo order. | BR-Y1, BR-Y2, BR-X3 | SC-B4, SC-B5 | Required |
| AC-U1 | Goodtable mark/favicon, hero, and every catalog item photo load from packaged same-origin assets. | BR-U1 | SC-H1 | Required |
| AC-G1 | Rejected request data containing a card-like value is absent from logs and error responses. | BR-X3 | SC-G4 | Required |

## Plan clauses kept out of scope

These plan clauses conflict with the repository's security and payment-state rules or describe unavailable hardware. They are not counted as covered acceptance criteria.

| Plan clause | Resolution | Record |
| --- | --- | --- |
| Original plan's `/payment-tokens` endpoint and single-use token on the order API | The demo renders no payment fields. It sends only quote ID, idempotency key, and simulated outcome; it creates no token or provider integration. | ADR-0002 |
| Original AC-Y1/AC-Y2 card entry and formatting | The demo has no payment fields or card-like test values. AC-D7 covers the revised behavior. | ADR-0002 |
| AC-D3: publish test-card numbers | The demo has no card processing; test-card values are not documented or introduced. Chaos paths remain documented and tested. | Deviated: ADR-0002 |
| AC-O1: internal order ID and masked-card field; AC-O5: card last four | The public reference and pickup number identify the demo receipt. No card data is fabricated or returned. | Deviated: ADR-0002 |
| AC-Y5's card-field clearing clause | No payment fields exist to clear. AC-Y5 covers decline messaging, retained cart, and fresh retry; AC-D7 proves credential-free submission. | ADR-0002
| AC-Y6: after 30 seconds claim “not charged” or direct the customer to staff | An absent ledger result remains unknown, so the UI keeps confirming and never says the customer was not charged. No staff workflow is assumed. | Deviated: ADR-0003 and ADR-0007 |
| AC-O7/O8: expire a pending attempt and release stock without a ledger result | Missing ledger data is not a decline. Keep the order pending and reservation held until an authoritative outcome exists. | Deviated: ADR-0003 |
| AC-K4: verify an operating-system on-screen keyboard on a physical tablet | Browser tests cover the plan's two viewport sizes and reachable controls; this host has no physical tablet or OS keyboard to verify. | Hardware verification unavailable |
| AC-D1: measure a clean Unix clone's setup-to-dev time | A fresh Ubuntu 24.04 WSL clone passed `make setup`, `make check`, and `make e2e`; the README development command returned HTTP 200 from Vite and ready from the API health endpoint. | Verified in WSL on 2026-10-21 |

Run `node scripts/traceability.mjs --strict` for live named-test links. Every `Required` row needs an AC-tagged test name. Named-test traceability is a gate, not a substitute for the assertions those tests perform.
