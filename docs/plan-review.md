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
4. The simulated checkout collects no payment details. After reviewing the server quote, the customer can place a demo order; the API receives only quote ID, idempotency key, and selected simulated outcome. Original card-entry criteria AC-Y1 and AC-Y2 are deviations under ADR-0002. Unknown outcomes remain pending until an authoritative result exists.
5. The browser stores only cart item IDs, option IDs, and quantities in `sessionStorage`; an unresolved attempt stores its idempotency key, quote ID, and mock outcome. No payment details or prices are collected or persisted. The idle prompt appears after 60 seconds and resets after 15 additional seconds unless continued; paid confirmation resets after 30 seconds. Processing/unknown orders are not auto-cleared.
6. The OpenAPI document is committed as a drift-checked snapshot, and the browser DTO types are generated from its schemas. Runtime response-shape validation still runs at the network boundary; generated types do not replace it.
7. A definite decline lockout is persisted per kiosk: five declines in ten minutes lock payment for 60 seconds and return `Retry-After`. Optional catalog/reset/chaos endpoints are mapped only in Development, are off by default, and require an explicitly configured admin token of at least 32 characters. Chaos presets cover latency, decline, approval-then-unknown, no-ledger unknown, response loss, and the post-reservation crash boundary.
8. Low stock is announced at five or fewer remaining units, matching BR-S4.
9. Production hides demo outcome controls and the API forces the standard simulated approval. Expired quote records are retained for 24 hours, then cleaned in bounded batches of 500; the maintenance worker runs cleanup every 15 minutes.
10. The Goodtable brand mark, favicon, hero, and 12 menu photos are packaged as same-origin assets. The Production browser check runs the ASP.NET app in Production, checks its strict response CSP, decodes all 14 images without third-party hosts, and completes a simulated order against temporary SQLite data.

## Risks and remaining scope

- SQLite and the seeded single-location menu are appropriate for a local demo, not multi-instance production traffic.
- The `StillUnknown` demo scenario intentionally remains pending without a ledger result and can retain stock until an authorized Development demo reset or an authoritative result.
- Latest candidate verification (2026-10-21): .NET 10 Release build passes with zero warnings/errors; domain tests 18/18, API tests 29/29, Vitest 17/17, delivery-contract tests 8/8, Playwright/axe E2E 29/29, and the Production-host browser check 1/1 pass. Frontend typecheck, ESLint, generated API type check, strict trace, and architecture boundary check pass. Trace reports 49 criteria: 47 required linked to named tests and AC-Y1/AC-Y2 recorded as ADR-0002 deviations. CI commands and the browser suite were exercised locally on Windows; this is not a GitHub Actions result. GNU Make, a clean Unix run, and Docker smoke were unavailable in this session. **Out of scope for this submission (simulated payments, single-host demo). For a real kiosk deployment I would verify:**
  - The exact kiosk model and OS, touchscreen input, portrait/landscape layout, zoom, on-screen keyboard, keyboard and screen-reader navigation, focus visibility, and touch target reachability.
  - TLS certificate and HTTPS behavior, allowed host names, trusted proxy addresses, and forwarded-header handling at the deployment edge.
  - A SQLite-consistent backup and a successful restore to a clean host, including orders, inventory, and pending attempts with no ledger result.
  - Physical printer output, including legibility, itemization, pickup reference, and the simulated-payment wording.
  - Idle and completion resets, browser back/reload behavior, and confirmation that the next customer cannot see prior-session data while unresolved attempts remain recoverable.
  Automated viewport and axe checks are software evidence only and do not replace these deployment checks.
- P2 size/add-on choices are implemented for cold brew with server-side validation/pricing and immutable order snapshots. The paid receipt is printable and includes an offline QR containing the visible reference, pickup number, and total. The QR makes no network request. The crash-between-steps preset is implemented as an authenticated Development demo failpoint; it leaves a durable pending attempt and reserved stock without a ledger result. Timeout-after-charge and no-ledger unknown outcomes remain demoable.
- SQLite and the seeded single-location menu are appropriate for a single-host demo, not multi-instance production traffic. The product plan uses simulated payment outcomes; no real payment provider, hosted card fields, webhook verification, staff/cashier workflow, or reconciliation against an external processor is required or implemented. The checkout collects no payment details; the screen and printed receipt label the outcome as simulated and state that no money was charged.
- The business time zone defaults to UTC; configure it for the operating location before using daily pickup numbering. Build `frontend/dist` before publishing the API so the static client is included.
- Development-only admin/demo endpoints are implemented under the explicit guardrails above.
- [The kiosk deployment runbook](production-kiosk-runbook.md) defines single-host configuration, release, backup, recovery, and target-device verification steps. Physical deployment checks are deliberately outside this submission's scope; the checklist above and in the runbook applies before a real kiosk rollout. Repository test results describe software behavior and do not establish deployment readiness.

## Review observations

- The plan's raw-body idempotency pre-claim could create unstable hashes or stranded keys. The implementation uses a normalized request fingerprint and creates the idempotency row with the order and stock reservation.
- An absent ledger entry cannot prove that payment failed. Unknown attempts remain pending and do not release inventory.
- Payment status lookup uses a POST body, so the idempotency key does not appear in URLs.
- The client never says “not charged” for a network failure. It checks the same attempt, presents the pending state, and offers a retry with that same key.
- The plan's staff escalation assumption does not match a no-cashier counter. The demo gives self-service status guidance and does not invent an available staff workflow.
- Development-only demo controls support catalog edits, reset, mock outcome overrides, bounded latency, and dropped-response recovery. They are not available unless explicitly enabled with a valid token and are not intended to be deployed as a production administration surface.
- Kiosk privacy follows the plan's 60-second idle prompt, 15-second warning period, and 30-second paid confirmation reset. The prompt offers a clear continue action. Physical-device privacy, keyboard, zoom, screen-reader, and timing validation is out of scope here and is listed for a real deployment above.

- Architecture follow-up (2026-10-21): the backend now has separate Domain, Application, Contracts, SQLite Infrastructure, and HTTP host projects. The Application layer owns catalog and order-placement workflows behind ports; SQLite owns persistence and atomic reservation/settlement work; HTTP handlers use application interfaces. Checkout state, presentation helpers, and screen components are split under `frontend/src/checkout`. ADR-0008 records the dependency rules, and `scripts/architecture-boundaries.test.mjs` enforces them.
- Current candidate verification (2026-10-21): .NET 10 Release build passes with zero warnings/errors; domain tests 18/18, API tests 29/29, Vitest 17/17, delivery-contract tests 8/8, Playwright/axe E2E 29/29, and Production-host browser check 1/1 pass. Frontend typecheck and ESLint pass; generated API types are current; strict trace reports 49 criteria, all 47 required criteria linked to named tests, with AC-Y1/AC-Y2 separately recorded as ADR-0002 deviations. Architecture boundary check and `git diff --check` pass. This is local Windows evidence, not a GitHub Actions result. Docker smoke and a clean Unix run were unavailable in this session. Physical kiosk, TLS/proxy, backup-restore, printer, and cross-session privacy validation are out of scope for this simulated-payment, single-host submission; see the production checklist above and in the runbook before a real deployment.
