# Goodtable self-service checkout

A tablet-friendly checkout demo for a small lunch counter. The React client calls a .NET 10 API; the API owns menu prices, quotes, stock reservations, payment state, and pickup numbers. Payments are simulated. The payment screen accepts test values only for local validation, erases them when submission starts, and never sends or saves them. Never enter a real card; no payment provider is contacted.

## Run locally

Requirements: .NET 10 SDK, Node.js 22.12 or newer, npm, and GNU Make for the one-command workflow. The repository's `global.json` selects the .NET 10 SDK. On Windows, `scripts/dotnet.mjs` prefers the user-local SDK under `%USERPROFILE%\.dotnet` when available.

```sh
make setup
make dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The dev command starts the API and Vite client together; Vite proxies `/api` to `http://127.0.0.1:5080`. The API creates `data/checkout.db` in the repository root.

Without Make, run these commands from PowerShell or another shell:

```sh
npm --prefix web ci
npm --prefix web run dev
```

The equivalent setup/build/test commands are `node scripts/dotnet.mjs tool restore`, `node scripts/dotnet.mjs restore SelfServiceCheckout.slnx`, `npm --prefix web ci`, then `npm --prefix web run build` followed by `node scripts/dotnet.mjs build SelfServiceCheckout.slnx --configuration Release`. Run `node scripts/run-tests.mjs` for configured test suites and `node scripts/traceability.mjs --strict` for the AC gate.

The API host uses the repository's SDK wrapper when run by Make; the web helper also prefers the user-local .NET SDK. Build the web client before publishing the API so `web/dist` can be copied into the published `wwwroot`.

## Build and verification

```sh
make build    # production web bundle and .NET Release build
make test     # runs configured .NET/web test suites; reports when none exist
make e2e      # builds web and runs Playwright browser tests
make trace    # strict AC-* test-ID coverage check
make check    # types, optional lint, builds, tests, and strict traceability
```

Vitest and Playwright/axe suites cover the current acceptance criteria. The API's OpenAPI contract is committed at [openapi.v1.json](tests/SelfServiceCheckout.Api.Tests/Contracts/openapi.v1.json); `make api-snapshot` refreshes it and regenerates browser DTO types, while `make check` detects drift. Install Playwright Chromium once with `npx playwright install chromium` from `web/` when running browser tests locally. `make trace` is intentionally strict for required criteria: it reports documented deviations separately and fails when a required criterion lacks an AC-tagged test. See [the live trace table](docs/traceability.md) for current gaps and [the scenario catalog](docs/scenarios.md) for planned behavior.

## Checkout demo

Browse categories and add items, then choose **Review order**. Cold brew offers server-priced sizes and add-ons; selected options appear in the quote and order receipt. The server returns a short-lived quote in integer cents; the customer sees that total before placing the demo order. In Development, the review screen offers four simulated outcomes: approve, decline, approved with delayed confirmation, or remain unknown. These options exercise checkout state handling. They do not represent real card processing.

If the response is interrupted, the UI checks the same idempotency key and keeps the customer on the attempt. An unresolved payment remains pending and retains its stock reservation; it is never presented as a decline just because a lookup has no result. The cart's item IDs, selected option IDs, and quantities are kept in `sessionStorage` so a tab reload can restore it; a pending attempt stores only its key, quote ID, and selected mock scenario. Prices and card data are not persisted. Idle reset and paid completion clear the cart.

The paid receipt includes a printable itemized view and an offline QR code containing its displayed reference, pickup number, and total. Scanning the QR opens no external service.

After 60 seconds without activity, the browser shows a warning with options to keep the order or start fresh. It resets the session 15 seconds later unless continued. Paid confirmation resets after 30 seconds. An unresolved payment is not automatically cleared.

The payment screen includes card-number, expiry, and CVC fields for browser-local formatting and validation only. Use fictional values; never enter real payment details. The fields are cleared when submission starts, and their values are never sent or saved. A separate mock-outcome selector determines the result; no payment provider or card-based test mapping is used.

AC-Y1 and AC-Y2 are covered with browser-local validation and formatting tests. The test values are discarded before the order request; the demo creates no payment token or real charge. See [ADR-0002](docs/adr/0002-no-card-data-in-demo.md).

### Development-only demo controls

Catalog changes, demo reset, and server-side mock/chaos overrides are available only when `DemoMode:Enabled=true` is set in Development and `DemoMode:AdminToken` contains at least 32 characters. Both settings are off/empty by default. See [demo-mode instructions](docs/demo-mode.md); never commit the token or expose these controls as a production admin surface.

## Architecture

- `src/Checkout.Domain` contains pure cart limits, money, tax, and order state rules.
- `src/SelfServiceCheckout/SelfServiceCheckout.Contracts` contains API DTOs.
- `src/SelfServiceCheckout/SelfServiceCheckout` hosts ASP.NET Core Minimal APIs, EF Core, SQLite, migrations, mock gateway, and reconciliation.
- `web` contains the React + TypeScript client. API payloads receive runtime shape checks because TypeScript types alone do not validate network responses.
- `data/checkout.db` is local runtime data and is ignored by Git. SQLite is configured for the single-location demo, not multi-instance production traffic.

The API enables mock payment only in Development. Development-only admin/demo controls are disabled by default and require explicit configuration; they are not a production management workflow. No real payment gateway, production admin UI, cashier workflow, customer accounts, order fulfillment screen, refunds, or multi-location support is included. The configured business time zone defaults to UTC and should be set for the operating location before production use.

## Review record

See [the business rules](docs/business-rules.md), [scenario catalog](docs/scenarios.md), and [plan review](docs/plan-review.md) for requirements, reviewed behavior, and deliberate scope changes. [Architecture decisions](docs/adr/README.md), [AI workflow](docs/ai-workflow.md), [rejected/deferred decisions](docs/rejected.md), and the [reconstructed timeline](docs/timeline.md) preserve context without claiming a prompt-by-prompt history. Review documents supplied with the assignment describe intended work; their delivery or publication instructions do not authorize external publication.
