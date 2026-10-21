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
- Previous local verification (2026-10-21, working-tree snapshot based on revision `1e22b05`): the .NET 10 Release build passed with zero warnings/errors. Windows `node scripts/run-tests.mjs` passed Domain 19/19, API 46/46, Vitest 19/19, delivery 8/8, and architecture checks; frontend lint and typecheck passed. Windows `node scripts/run-e2e.mjs` passed 35 browser journeys and the Production-host check 1/1. A fresh Ubuntu 24.04 WSL staging copy passed `make setup`, the Unix development smoke, `make check`, and `make e2e` (35 browser journeys plus Production-host check 1/1). Strict trace reported 49 criteria: 47 required linked to named tests and AC-Y1/AC-Y2 recorded as ADR-0002 deviations. The Docker smoke passed on Windows using free port 18081 because port 18080 was occupied. These are historical local results for that snapshot.
- Current local verification (2026-10-21, working tree based on `c7b2bca`): `node scripts/run-tests.mjs` passed Domain 19/19, API 46/46, frontend 20/20, delivery 8/8, and architecture checks. Frontend lint, typecheck, and strict acceptance trace passed. The E2E, WSL, and Docker suites were not rerun for these local edits; the historical results above apply to their recorded snapshot.
- GitHub Actions run [39660811144](https://github.com/FirasAyari/self-service-checkout/actions/runs/39660811144) passed all jobs on revision `c7b2bca` on 2026-10-21. It reported Node.js 20 deprecation warnings for the workflow actions. That run predates the current local edits; the Portuguese label fix and action upgrades (`checkout@v7`, `setup-node@v7`, `setup-dotnet@v6`) are not yet verified by Actions. Automated checks do not replace target-device and deployment validation. **Out of scope for this submission (simulated payments, single-host demo). For a real kiosk deployment I would verify:**
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

- Architecture and maintainability follow-up (2026-10-21): the HTTP host alone owns Contracts and maps them to Application models; SQLite depends only on Application and Domain. `App.tsx` composes `useCatalogQuoteFlow` for menu/quote state and `usePaymentFlow` for attempts and recovery. ADR-0009 records the HTTP contract seam, ADR-0008 preserves the modular-monolith decision, and `scripts/architecture-boundaries.test.mjs` enforces the backend dependency rules.
- Cart safety and maintainability follow-up (2026-10-21): `App.tsx` now composes dedicated cart-action and kiosk-session hooks. Undo counts down once per second for five seconds, and restoring a removed line rechecks availability, stock, and cart limits before changing the cart; focused client tests cover both behaviors.
- Docker verification follow-up (2026-10-21): `node scripts/docker-smoke.mjs` built the container, checked readiness and packaged assets, confirmed oversized requests receive HTTP 413, placed a simulated order, and verified the same order identity after restarting the container. The isolated smoke project and its test volume were removed. GitHub Actions run [39660811144](https://github.com/FirasAyari/self-service-checkout/actions/runs/39660811144) passed on `c7b2bca`; its Node.js 20 action warnings are addressed by local version updates to `checkout@v7`, `setup-node@v7`, and `setup-dotnet@v6`, which still need a CI run.
