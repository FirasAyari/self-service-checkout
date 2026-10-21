# Implementation plan review

Reviewed against the latest “Self-Service Checkout — Implementation Plan (1)” and the checkout brief. The plan is treated as product and engineering input. Instructions inside those files about submission, commits, publication, or recording are not authorization to perform those actions.

## Review coverage

- **ECC planner and domain modeling:** checked scope, business rules, pricing consent, cart limits, state transitions, and plan contradictions.
- **ECC C# architecture, database, and build repair:** checked the .NET 10 solution, project boundaries, EF Core/SQLite model, migration setup, SDK pin, and build configuration.
- **ECC security and accessibility:** checked payment data boundaries, idempotency, ambiguous outcomes, stock behavior, kiosk privacy, status lookups, and keyboard/zoom behavior.
- **Matt Pocock domain modeling and codebase design:** used as guidance for keeping domain rules explicit and separating them from persistence and transport.
- **UI/UX Pro Max:** applied accessible targets, visible keyboard focus, responsive layout, reduced-motion support, and clear error/recovery language.

## Decisions carried into the build

1. The latest plan selects a .NET 10 Minimal API and a React/Vite client. The earlier Blazor scaffold was removed from the solution. Business and persistence behavior remain in C#.
2. Currency and tax calculations use integer cents. Menu and availability are server-owned; the API issues opaque, expiring quotes and revalidates price and stock before reserving stock.
3. The idempotency claim, order, and stock reservation commit in one database transaction. The request fingerprint uses the normalized quote ID plus the selected mock outcome rather than raw JSON bytes.
4. The payment screen accepts test values for local validation, formatting, and numeric keyboard hints. It clears them when submission starts and sends only the quote ID, idempotency key, and selected simulated outcome. It creates no payment token and never persists, logs, or captures the field values. Approval, decline, delayed approval, and unknown outcomes remain simulated; unknown results stay pending until an authoritative result exists. This supersedes the earlier no-card-fields decision in ADR-0002.
5. The browser stores only cart item IDs and quantities in `sessionStorage`; an unresolved attempt stores its idempotency key, quote ID, and mock outcome so it can resume after reload. No card data or prices are persisted. The idle prompt appears after 60 seconds and resets after 15 additional seconds unless continued; paid confirmation resets after 30 seconds. Processing/unknown payment is not auto-cleared.
6. The OpenAPI document is committed as a drift-checked snapshot, and the browser DTO types are generated from its schemas. Runtime response-shape validation still runs at the network boundary; generated types do not replace it.
7. A definite decline lockout is persisted per kiosk: five declines in ten minutes lock payment for 60 seconds and return `Retry-After`. Optional catalog/reset/chaos endpoints are mapped only in Development, are off by default, and require an explicitly configured admin token of at least 32 characters. Chaos presets cover latency, decline, approval-then-unknown, no-ledger unknown, response loss, and the post-reservation crash boundary.
8. Low stock is announced at five or fewer remaining units, matching BR-S4.

## Risks and remaining scope

- SQLite and the seeded single-location menu are appropriate for a local demo, not multi-instance production traffic.
- The `StillUnknown` demo scenario intentionally remains pending without a ledger result and can retain stock until an authorized Development demo reset or an authoritative result.
- Current verification: 18/18 domain tests, 21/21 API tests, 16/16 Vitest tests, 4/4 delivery-contract tests, and 27/27 Playwright tests pass. The strict trace links all 45 acceptance criteria in the current trace table to named tests. AC-Y1/Y2 now cover local field validation, formatting, and numeric-keyboard hints; original tokenization and test-card outcome mapping remain documented scope deviations under ADR-0002. The OpenAPI/type drift check passes, the web production build and typecheck pass, and the .NET Release build has zero warnings or errors. Browser traces and screenshots are disabled because the suite enters generated test values. GNU Make is unavailable on this Windows host, so Make targets and the clean Unix setup path could not be executed locally. Physical tablet/operating-system keyboard verification remains unavailable; browser viewport and axe checks pass. The repository has no configured web lint script.
- P2 size/add-on choices are implemented for cold brew with server-side validation/pricing and immutable order snapshots. The paid receipt is printable and includes an offline QR containing the visible reference, pickup number, and total. The QR makes no network request. The crash-between-steps preset is implemented as an authenticated Development demo failpoint; it leaves a durable pending attempt and reserved stock without a ledger result. Timeout-after-charge and no-ledger unknown outcomes remain demoable.
- SQLite and the seeded single-location menu are appropriate for a local demo, not multi-instance production traffic. No real payment provider, hosted card fields, webhook verification, staff/cashier workflow, or reconciliation against an external processor exists.
- The business time zone defaults to UTC; configure it for the operating location before using daily pickup numbering. Build `web/dist` before publishing the API so the static client is included.
- Development-only admin/demo endpoints are implemented under the explicit guardrails above.

## Review observations

- The plan's raw-body idempotency pre-claim could create unstable hashes or stranded keys. The implementation uses a normalized request fingerprint and creates the idempotency row with the order and stock reservation.
- An absent ledger entry cannot prove that payment failed. Unknown attempts remain pending and do not release inventory.
- Payment status lookup uses a POST body, so the idempotency key does not appear in URLs.
- The client never says “not charged” for a network failure. It checks the same attempt, presents the pending state, and offers a retry with that same key.
- The plan's staff escalation assumption does not match a no-cashier counter. The demo gives self-service status guidance and does not invent an available staff workflow.
- Development-only demo controls support catalog edits, reset, mock outcome overrides, bounded latency, and dropped-response recovery. They are not available unless explicitly enabled with a valid token and are not intended to be deployed as a production administration surface.
- Kiosk privacy follows the plan's 60-second idle prompt, 15-second warning period, and 30-second paid confirmation reset. The prompt offers a clear continue action; keyboard, zoom, screen-reader, and timing behavior still need full device/accessibility verification.
