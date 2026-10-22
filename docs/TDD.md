# Good Table Self-Service Checkout — Technical Design

- **Status:** Describes the current implementation
- **Last reviewed:** 2026-10-22
- **Audience:** Take-home reviewers, maintainers, and engineers changing checkout behavior

## Executive summary

Good Table is a single-location, self-service snack-bar checkout demo. A React and TypeScript client calls a .NET 10 API. The API owns the catalog, prices, quotes, stock reservations, order state, simulated payment outcomes, and pickup numbers. SQLite persists the workflow on one host.

The design prioritizes a trustworthy checkout over breadth: the customer sees a server-priced quote before submitting; repeated submissions use one idempotency key; finite stock is reserved atomically; and an unknown payment result stays pending rather than being called a decline. No card details or payment-provider credentials are collected because this assignment does not require real payment processing.

The backend is a layered modular monolith. Domain and application rules remain independent from HTTP and persistence, while one deployable host composes the API, SQLite adapter, and built frontend. This provides useful boundaries and test seams without the operational cost of multiple services for a small demo.

## Purpose, scope, and assumptions

The supplied exercise asks for a small web checkout that can show a menu, build an order, submit it, and persist orders through a backend. It leaves payment implementation and most product choices open; good user experience and sensible failure behavior matter. The selected C#/.NET backend is a deliberate stack choice recorded in [ADR-0001](adr/0001-dotnet-api-react-client.md).

### Included

- Browse a server-owned menu with availability and configurable options.
- Build a cart, review an authoritative quote, and explicitly accept a changed price.
- Place a simulated order and show its public reference and, when paid, a pickup number.
- Retry or look up the same attempt after a network interruption.
- Reserve finite stock and return it once after an authoritative decline.
- Use a Development-only admin page and protected API for catalog edits, reset, and simulated failure scenarios.
- Serve the production-built frontend from the API host; keep the development frontend and API on a Vite proxy path.

### Deliberately out of scope

- Real payment processing, card entry, payment tokens, refunds, and provider reconciliation.
- Customer accounts, cashier or kitchen workflow, fulfillment management, and multiple locations.
- A production staff administration surface or public customer identity system.
- Multi-host writes, a shared network filesystem, or a guarantee that SQLite supports horizontally scaled instances.
- Physical kiosk, printer, operating-system keyboard, and deployment-environment validation.

The original card-entry acceptance criteria are recorded as deviations under [ADR-0002](adr/0002-no-card-data-in-demo.md). These are scope choices, not unimplemented payment features. The [production kiosk runbook](production-kiosk-runbook.md) lists checks needed before a real deployment; this design does not claim those checks have been performed.

## Quality priorities

The architecture makes these guarantees more important than independent service scaling:

1. **Correct amounts and stock:** client values never decide an order price or stock balance.
2. **Safe retries:** a repeated checkout attempt resolves to the existing order.
3. **Honest uncertainty:** absence of an outcome is not proof of decline.
4. **Small deployable surface:** the demo can be built, run, and reviewed without operating several services.
5. **Understandable failures:** stale prices, stock changes, throttling, and interrupted requests produce recoverable customer actions.
6. **Reviewable boundaries:** business rules, transport contracts, and SQLite details have distinct owners.

## System architecture

The backend is a modular monolith with one ASP.NET Core host. The browser client and server communicate over JSON. In production the host also serves the frontend's static build, so the browser uses same-origin API requests.

~~~mermaid
flowchart LR
  Browser[React and TypeScript kiosk]
  subgraph Host["ASP.NET Core host and trust boundary"]
    Http[Minimal API endpoints and contract mapping]
    App[Application use cases and ports]
    Domain[Framework-free domain rules]
    Sqlite[SQLite infrastructure and mock outcome ledger]
    Db[(checkout.db)]
    Http -->|use case calls| App
    App -->|business rules| Domain
    App -->|outbound port calls| Sqlite
    Sqlite -. implements application ports .-> App
    Sqlite -. references domain rules .-> Domain
    Sqlite --> Db
  end
  Contracts[Versioned HTTP contracts]
  Browser -->|same-origin JSON| Http
  Http --> Contracts
~~~

The arrows show runtime calls and project dependencies at a high level. The host references the application, contracts, and infrastructure to compose the process. Infrastructure implements application ports; it does not make the domain depend on SQLite.

| Area | Responsibility | Why it is separate |
| --- | --- | --- |
| **backend/src/Checkout.Domain** | Cart normalization and limits, integer money, inclusive tax, order status transitions | These rules can be tested without ASP.NET Core, EF Core, or a database. |
| **backend/src/SelfServiceCheckout/SelfServiceCheckout.Application** | Menu and quote workflows, order-placement orchestration, application records, and ports | Use cases depend on capabilities such as reserving stock or settling an outcome, not on HTTP DTOs or EF entities. |
| **backend/src/SelfServiceCheckout/SelfServiceCheckout.Contracts** | Versioned HTTP request and response DTOs | The API shape is explicit and kept at the transport boundary. |
| **backend/src/SelfServiceCheckout/SelfServiceCheckout.Infrastructure.Sqlite** | EF Core model, migrations, catalog and reservation stores, simulated outcome ledger, settlement | Database-specific transaction and query behavior stays in its adapter. |
| **backend/src/SelfServiceCheckout/SelfServiceCheckout** | ASP.NET Core composition root, endpoints, mapping, error handling, security middleware, health checks, and hosted reconciliation | The host wires the layers together and translates protocol details without owning persistence rules. |
| **frontend/src/checkout** | Browser state, cart actions, quote/payment flows, kiosk-session behavior, and screens | UI state and interaction policy remain local to the browser and can be tested independently. |

Dependencies point inward from the host and infrastructure toward application/domain abstractions. The Contracts project is referenced by the HTTP host, not by application workflows or SQLite. Explicit mapping exists at that boundary because a few small mapping functions are cheaper to understand than adding a mediator or mapping framework. The architecture boundary check guards these project references.

### Why a modular monolith

The product has one checkout workflow, one data store, and one local deployment unit. Splitting menu, order, and payment simulation into separate services would require network failure handling, deployment coordination, and distributed consistency without an independent scaling or ownership need. The modular monolith still isolates the domain, workflows, HTTP, and storage so a future change can be localized. A service split should be considered only if the operational or scaling requirements change.

### Runtime modes

- **Development:** Vite serves the browser app on port 5173 and proxies /api to the API on port 5080. The API enables the simulated outcome selector. The `/admin` page exposes demo administration only when the API has `DemoMode:Enabled=true` and a token of at least 32 characters; both are disabled by default.
- **Production build:** Vite assets are copied into the ASP.NET host's web root. The host serves both the React app and API from one origin. Simulated payment must be explicitly enabled for a visibly labeled demo; production forces the standard simulated approval and does not let the customer choose an outcome.
- **Docker:** the composed app runs in one container with SQLite in a named volume. This is a convenient single-host demo deployment, not a multi-instance database design.

## Main checkout flow

~~~mermaid
sequenceDiagram
  actor Customer
  participant UI as React client
  participant API as ASP.NET Core API
  participant App as Application services
  participant DB as SQLite
  participant Mock as Simulated outcome adapter

  Customer->>UI: Browse menu and build cart
  UI->>API: GET /api/menu
  API->>App: Read active catalog
  App->>DB: Query catalog
  DB-->>UI: Menu with prices, options, and availability
  Customer->>UI: Review cart
  UI->>API: POST /api/quotes
  API->>App: Validate and price cart
  App->>DB: Save expiring quote snapshot
  DB-->>UI: Quote ID, line snapshots, total, tax, expiry
  Customer->>UI: Accept quote and submit
  UI->>API: POST /api/orders with quote ID and idempotency key
  API->>App: Place order
  App->>DB: Revalidate quote; atomically claim key and reserve stock
  DB-->>App: Pending order and payment attempt
  App->>Mock: Record simulated outcome
  Mock->>DB: Persist outcome ledger when one exists
  App->>DB: Settle approval or decline transactionally
  API-->>UI: Paid/declined response, or pending response
  UI->>API: POST /api/orders/status with the same key if uncertain
  API->>DB: Read and settle only if an outcome is durable
  DB-->>UI: Current attempt status
~~~

### Menu and cart

The API returns active catalog items in category and sort order. A menu version is derived from the product IDs, prices, stock, active state, and option definitions so the browser can detect meaningful catalog changes. The browser may calculate a display estimate, but it does not send that amount as an authority.

The domain normalizes duplicate item lines only when they use the same option set. It rejects invalid IDs, quantities, duplicate options, and conflicting option sets. Current limits are 10 units per item line, 15 distinct lines, 30 units total, and $150.00 total. The limits protect a bounded kiosk order and keep the UI and API behavior consistent.

### Quote and consent

POST /api/quotes resolves each product and option against server-owned data. The server computes prices in cents with checked integer arithmetic, applies the configured inclusive-tax rate, stores an immutable quote snapshot, and returns an opaque random quote ID with an expiry. The default lifetime is 120 seconds; configuration allows 30 to 600 seconds.

The quote snapshot includes item names, selected options, quantities, unit and line prices, total, tax, currency, and expiry. The browser must display that quote. If the price changed since the previous review, the customer must explicitly accept the new amount before continuing. If a quote expires or catalog price/availability changes before reservation, submission fails and the UI requests a fresh review.

The total is the gross amount. Tax is extracted for display using basis points and rounded half-up; it is not added a second time to the total. Money is stored as integer cents, never floating point. The configured default is 800 basis points (8%); the operating location must set the correct rate and business time zone for any real trial.

### Order and simulated payment

The order endpoint receives only a quote ID, a 32-character GUID-format idempotency key, and a simulated outcome. It receives no amount, item description, card number, expiry, CVC, or payment token. The server checks the quote and catalog again and does not trust the browser's estimate.

The demo outcomes exercise different states:

| Development scenario | Durable outcome | Initial behavior |
| --- | --- | --- |
| **Approve** | Approved ledger row | Settles to PAID and assigns a pickup number. |
| **Decline** | Declined ledger row | Settles to PAYMENT_FAILED and restores finite stock once. |
| **UnknownAfterApproval** | Approved ledger row | Leaves the order pending for reconciliation to settle later, simulating a delayed confirmation. |
| **StillUnknown** | No ledger row | Remains pending and keeps its reservation; no automatic decline is inferred. |

Chaos controls can additionally model latency, a lost response, or interruption after reservation. They exist to test recovery, not to represent a live payment provider. The simulated gateway has no card-data interface and does not contact an external processor.

## Domain lifecycle and persistence

### State transitions

An order begins in PENDING_PAYMENT and may transition to PAID or PAYMENT_FAILED. The domain allows only these transitions. A paid order gets a pickup number; a failed order does not. The order and its line snapshots are retained so a retry can return the original result and a receipt remains stable if the catalog later changes.

Payment attempt status and the payment ledger are separate records. This is intentional: an attempt can exist without a durable outcome. A missing ledger row means “unknown”, not “declined”. PaymentReconciler periodically looks for pending attempts that now have a ledger result and settles them. If none exists, the attempt and stock reservation remain pending.

### Data model

SQLite stores money as integer cents and timestamps as UTC Unix milliseconds. EF Core migrations define and evolve the schema.

| Table | Purpose and important invariants |
| --- | --- |
| **catalog_items** | Server-owned product identity, text, price, optional finite stock, active flag, category, and sort order. Database checks require positive prices. |
| **quotes** | Opaque ID, creation and expiry times, total, tax, and serialized line snapshot. Quotes are temporary and cleaned after their expiry retention period. |
| **orders** | Internal identity, unique public reference, unique idempotency key, normalized request fingerprint, quote/kiosk identity, status, total/tax, timestamps, stock-release flag, and optional business-date pickup number. |
| **order_lines** | Item name, quantity, unit/line price, and whether the item had finite stock at reservation time. The snapshot is used for the receipt and decline restoration. |
| **payment_attempts** | One durable attempt per order, with attempt status and creation time. |
| **payment_ledger** | At most one authoritative simulated outcome per attempt, with a transaction reference and recorded time. |
| **pickup_counters** | Next pickup number per configured business date. |
| **payment_decline_lockouts** | Temporary payment lock per kiosk after repeated definite declines. |

Unique indexes prevent duplicate public references, idempotency keys, attempt/order links, and pickup numbers for one business date. Foreign keys and cascade rules keep order, line, attempt, and ledger records consistent. Query indexes support status reconciliation, kiosk lockout checks, quote expiry cleanup, and catalog ordering.

### Atomic reservation and settlement

Reservation is the critical concurrency boundary. The SQLite adapter opens a serializable database transaction, checks for an existing idempotency key, verifies that the quote is valid and current, and conditionally decrements finite stock. It creates the pending order, attempt, and line snapshots in that same transaction. If validation, a conditional stock update, or persistence fails, the transaction rolls back together; the key is not left claimed by a partial attempt.

Each finite stock update has its availability condition in the update itself. That prevents two concurrent submissions from both consuming the final unit after reading the same old stock count. SQLite serializes writes for this single database file. The adapter retries brief busy/locked errors a small bounded number of times with jitter, then returns a retryable unavailable response. This is useful contention handling, not a promise of high write throughput.

The mock gateway records an outcome outside the reservation transaction. This keeps simulated provider work out of the stock transaction and makes the ledger durable across an API restart. Settlement then uses a separate transaction to make the order state, payment attempt, stock release or pickup number, and decline lockout agree. Replaying settlement is safe because only a pending order/attempt with a ledger result can be changed, and the StockReleased flag prevents restoring stock twice.

Pickup counters are partitioned by the configured store business date, not the server's UTC date. The counter increment and paid transition commit together, and a filtered unique index prevents duplicate pickup numbers for that date. A deployment crossing midnight in its local time zone therefore starts a new sequence at 1.

## Idempotency and recovery semantics

The client creates and saves the attempt key before sending the order request. The server stores the key with a SHA-256 fingerprint over the canonical quote ID and simulated outcome. Reusing the same key and same request returns the existing order; reusing it for a different request returns an error. The unique database index is the final arbiter when two identical requests arrive concurrently.

The API returns:

- **201 Created** for a newly created terminal order.
- **200 OK** for a completed matching-attempt replay or a status lookup.
- **202 Accepted** whenever the order is still pending, including a pending replay.
- **409 Conflict** when the quote or current catalog/stock no longer matches the reviewed state.
- **422 Unprocessable Entity** when an idempotency key is reused for a different request.
- **429 Too Many Requests** with Retry-After for rate limits or the kiosk decline lockout.
- **503 Service Unavailable** for temporary database contention or unavailable simulated payment.

After a lost response, the client looks up status with the same idempotency key or retries the same order with that key. It does not create a second attempt just because the response was lost. Status lookup first tries to settle any ledger outcome, then returns the persisted order state. If the ledger is absent, it returns PENDING_PAYMENT and instructs the customer to keep the page open and not submit a new payment attempt.

The browser's same-attempt recovery and the database's unique key protect different boundaries: the browser prevents accidental new attempts during ordinary interaction; the database keeps duplicate HTTP requests from creating multiple reservations even when they race.

## HTTP and browser boundary

### API surface

| Method and path | Purpose |
| --- | --- |
| GET /api/menu | Return active menu, availability, and option definitions. |
| POST /api/quotes | Validate cart and produce an expiring, authoritative quote. |
| POST /api/orders | Create or replay an order using the quote and idempotency key. |
| POST /api/orders/status | Resolve the current state for the same attempt key. |
| GET /healthz | Readiness check; returns ready only when the checkout database can be queried. |
| GET /health/live | Process liveness without requiring the database to be healthy. |
| GET /health/ready | Readiness alias for deployment probes. |
| GET /api/admin/items | Protected Development-only full catalog listing, including inactive products; unmapped by default. |
| PATCH /api/admin/items/{itemId} | Protected Development-only price, stock, and availability update. |
| GET /api/admin/chaos and POST /api/admin/chaos | Read or configure process-local simulated payment and failure behavior. |
| POST /api/admin/reset | Protected Development-only restore of seeded catalog and deletion of demo checkout records. |

Malformed requests return 400; missing attempts return 404; stale quotes and state conflicts return 409; failed business validation can return 422; rate limits use 429; temporary store/provider unavailability uses 503; unexpected failures use a generic 500 message with a request identifier. Error responses follow ASP.NET Problem Details with a stable application error code. Sensitive request bodies are not echoed into errors.

The host rejects unmapped JSON members, caps the request body at 16 KiB, and declares the versioned DTOs in OpenAPI. The OpenAPI snapshot is checked into backend/tests/SelfServiceCheckout.Api.Tests/Contracts/openapi.v1.json; frontend/src/api.generated.ts is generated from it. Runtime validators in frontend/src/api.ts check successful API response bodies because JSON is untrusted at runtime; generated TypeScript types alone cannot validate received data.

The app does not enable cross-origin API access. Vite proxies /api during local development and the production host serves the static UI and API on the same origin. This avoids broad CORS configuration for the current deployment model.

### Browser state and shared-kiosk privacy

The React app composes separate hooks for catalog/quote requests, cart actions, payment recovery, and idle-session behavior. A reducer owns screen and checkout state; presentation helpers derive localized labels and estimates. English and Brazilian Portuguese copy are supported.

sessionStorage holds only:

- Cart item IDs, option IDs, and integer quantities.
- While unresolved, the idempotency key, quote ID, and mock scenario needed to recover the same attempt.
- Language selection and a short payment retry cooldown.

Prices, names, customer data, and payment credentials are not persisted by the browser. On reload, the cart is repriced by requesting a new quote; a pending attempt is recovered by its key. Paid completion and explicit session reset clear the cart. Idle warning begins after 60 seconds; the session resets after another 15 seconds unless continued. Processing and unresolved attempts are exempt from automatic clearing, so privacy reset does not discard an uncertain order. Paid confirmation resets after 30 seconds.

The UI has loading, empty, sold-out, quote-change, out-of-stock, decline, rate-limit, pending, and network-recovery states. Focus moves with screen changes, modal dialogs constrain focus, and the accessibility and browser checks exercise keyboard and responsive behavior. Real hardware behavior still needs target-device verification.

## Security and privacy controls

The app is a bounded demo, not a public production payment system. Current safeguards are:

- No collection, transmission, persistence, or logging of PAN, expiry, CVC, or payment tokens.
- No client-supplied amount is used to create an order.
- Strict JSON field handling, request-size limit, server-side cart/quote checks, parameterized EF Core data access, and unique database constraints.
- Response headers include CSP, frame denial, MIME sniffing protection, referrer and permissions policies; API responses are no-store. HSTS is enabled outside Development.
- Forwarded headers are ignored unless trusted proxy IPs are explicitly configured.
- Fixed-window per-IP API rate limits and a persisted per-kiosk cooldown after five definite declines in ten minutes.
- Optional administration requires Development mode and a configured token of at least 32 characters. Both settings are off by default, and admin routes are only mapped when enabled.
- The admin page keeps its token in memory, sends it only as `X-Admin-Token`, and clears it on disconnect or reload. It has no browser-storage persistence. Reset requires a confirmation dialog because it removes demo order and payment records. The page and its API adapter are dynamically loaded only by a Development build; Production serves the unavailable message without shipping the admin controls or `/api/admin` client methods.
- Logs use generic error responses; tests verify rejected sensitive input does not appear in application logs.

Checkout and order-status endpoints do not have customer authentication because the exercise is a kiosk demo. A real deployment needs a reviewed network boundary, staff/operator identity and authorization where appropriate, data-retention policy, secure secret provisioning, and an owned recovery process before customers use physical kiosks.

## Operations and maintenance

At startup, migrations are applied and the catalog is initialized. /healthz checks the database; liveness remains independent so an orchestrator can distinguish a live process from a ready checkout. The hosted PaymentReconciler runs every five seconds, settling pending attempts only when a durable ledger row exists. It also removes quotes more than 24 hours past expiry in batches of up to 500, every 15 minutes. Orders, attempts, ledger records, and idempotency keys are intentionally retained so same-key retries keep working.

The database defaults to data/checkout.db under the repository root and can be configured with Checkout:DatabasePath. SQLite uses foreign keys, WAL mode, connection pooling, a five-second command timeout, and a five-second busy timeout. Its single-writer design is appropriate for a local, single-host demo. Do not put the database on a shared network filesystem or run multiple app replicas against it as if it were a server database.

The [production kiosk runbook](production-kiosk-runbook.md) documents configuration, release, backup, restore, and unresolved-attempt handling. It describes a procedure to follow; it is not proof that a target installation, restore, TLS proxy, printer, or physical kiosk has been validated. For a demo, use the documented startup and verification commands in the [README](../README.md).

## Testing and evidence

The test layout mirrors the architecture and the failure boundaries:

| Suite | Evidence focus |
| --- | --- |
| backend/tests/Checkout.Domain.Tests | Cart normalization and limits, money/tax, and legal order transitions without a database or web host. |
| backend/tests/SelfServiceCheckout.Api.Tests | API and SQLite integration: contracts, quote consent, atomic stock reservation, order/idempotency races, settlement, decline stock restoration, pickup numbering, security controls, and recovery. |
| frontend/src/**/*.test.tsx | Reducer/presentation/UI behavior, response validation, accessibility semantics, storage cleanup, interrupted-attempt recovery, and Development admin interactions. |
| frontend/e2e and production-host checks | Full browser checkout journeys and the built ASP.NET host serving its packaged UI. |
| scripts/architecture-boundaries.test.mjs | Prevents persistence/framework dependencies from crossing inward project boundaries. |
| scripts/traceability.mjs --strict | Ensures each required plan criterion has a named AC-tagged test; documented deviations remain deviations, not coverage. |

Run node scripts/run-tests.mjs for backend, frontend, delivery, and architecture checks; run node scripts/run-e2e.mjs for browser and production-host journeys. The README lists setup, build, audit, Docker, and local development commands. CI runs backend, frontend, traceability, Docker smoke, and browser jobs on pushes and pull requests. A passing automated suite does not substitute for physical-kiosk and deployment validation.

## Important design choices and alternatives

| Choice | Why it fits this exercise | Alternative and cost |
| --- | --- | --- |
| .NET 10 API with React/Vite/TypeScript | Matches the implementation plan and separates a browser kiosk from server-owned checkout decisions. | Blazor would keep UI code in C#, but departs from the plan; a client-only app cannot safely own price, stock, or order state. |
| Modular monolith, not microservices | One workflow and one local deployment do not need separate scaling or deployment. Layer boundaries still permit isolated testing. | Services would add network calls, deployment coordination, and distributed failure modes before there is an operational need. |
| SQLite for one host | Simple local persistence, transactional constraints, and no database service to operate for the take-home. | A server database is needed for multi-instance writes, higher write concurrency, and managed backup/availability. SQLite is not treated as horizontally scalable. |
| Server-owned quote, expiring snapshot, and explicit repricing consent | Prevents edited client prices and ensures the customer sees a changed total before submission. | Trusting browser totals is unsafe; silently charging current prices after review breaks consent. |
| Atomic stock reservation with order and key | Prevents overselling and partial orders when requests compete or validation fails. | Read-then-decrement races; holding the transaction open for a provider call would couple database locks to network latency. |
| Durable mock ledger and separate settlement | Simulates delayed/unknown payment outcomes and allows the reconciler to resume after restart without ever guessing from missing evidence. | Immediate in-memory success is simpler but cannot test recovery; a real PSP requires provider-specific authorization, idempotency, timeout, and reconciliation design. |
| Same-key replay and pending status instead of new retry | Gives the client a stable way to discover whether an interrupted request committed. | A new key can create a second order and reservation; releasing stock on “no result” can contradict a late approval. |
| React sessionStorage for minimal kiosk state | Survives a tab reload without retaining prices, customer records, or payment data beyond the browser session. | Memory-only loses recovery state; persistent local storage keeps shared-kiosk data longer than needed. |
| Explicit HTTP mapping and runtime client validation | Keeps wire DTOs stable while application types remain transport-neutral; runtime validation guards the actual JSON boundary. | Sharing DTOs throughout backend layers couples business workflows to API changes; compile-time TypeScript alone cannot validate server JSON. |

The accepted decisions are recorded in [ADRs 0001–0009](adr/README.md). This table explains the current system at a glance; the ADRs remain the decision history and include fuller consequences.

## Known limits and decisions required before real kiosk use

These limits are deliberate or unverified within the assignment:

1. **No real payment provider.** The demo can exercise approval, decline, delayed confirmation, and unknown outcomes, but it does not take money. Any real processor needs a separately reviewed integration and compliance boundary.
2. **Single-host SQLite.** Writer serialization bounds concurrency and a local file is not shared multi-instance storage. Revisit the database and deployment model if the service needs multiple replicas or locations.
3. **Unresolved mock attempts can remain pending.** StillUnknown has no ledger result, so it holds stock until an authoritative result or a deliberate Development reset. A production operator resolution capability is not provided.
4. **No authenticated customer or staff roles.** The demo assumes a restricted kiosk/network. A reachable public deployment would expose order status and mutation surfaces beyond the intended scope.
5. **No automated retention/archive policy for orders.** Records remain so idempotency works; a real service needs a data owner to define retention, privacy, and deletion.
6. **Physical and deployment validation is outstanding by scope.** Verify target hardware, TLS/proxy settings, backup restoration, printer path if introduced, session separation, and operational recovery before a real trial.
7. **No cashier, kitchen, fulfillment, refund, or multi-location workflow.** Add these only after those actors and state transitions are specified.

See [plan review](plan-review.md), [business rules](business-rules.md), [scenario catalog](scenarios.md), [submission requirements matrix](submission-requirements-matrix.md), and the [production kiosk runbook](production-kiosk-runbook.md) for detailed criteria, evidence, and operational checklists.

## Source map

- Composition and host policy: backend/src/SelfServiceCheckout/SelfServiceCheckout/Program.cs
- Domain constraints and transitions: backend/src/Checkout.Domain/CheckoutRules.cs
- Quote and order application workflows: backend/src/SelfServiceCheckout/SelfServiceCheckout.Application/
- Database schema and migrations: backend/src/SelfServiceCheckout/SelfServiceCheckout.Infrastructure.Sqlite/Data/
- Atomic reservation and settlement: backend/src/SelfServiceCheckout/SelfServiceCheckout.Infrastructure.Sqlite/Services/
- HTTP routes, DTO mapping, and exceptions: backend/src/SelfServiceCheckout/SelfServiceCheckout/Api/
- Browser API validation and UI flows: frontend/src/api.ts, frontend/src/App.tsx, frontend/src/DemoAdminApp.tsx, and frontend/src/checkout/
- Acceptance test links: docs/traceability.md
