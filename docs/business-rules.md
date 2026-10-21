# Checkout business rules

This is a compact, ID-preserving index of the rules from the latest implementation plan. It describes intended product behavior; it is not proof that each rule is implemented. Current implementation decisions and deliberate scope changes are recorded in [the plan review](plan-review.md). The rule IDs are used by acceptance criteria, scenarios, and tests.

## Menu and availability

| ID | Rule |
| --- | --- |
| BR-M1 | The seeded menu has at least three categories and twelve items, including sold-out and low-stock examples. |
| BR-M2 | An item can be ordered only when active and sufficiently stocked. Sold-out items remain visible, marked unavailable. |
| BR-M3 | The menu version is opaque and changes when relevant price, active, or availability data changes. |
| BR-M4 | Prices are positive integer minor units; formatting uses the deployment currency. |
| BR-M5 | Menu prices are tax-inclusive; tax is informational and rounded half-up. |
| BR-M6 | Refresh the menu at startup, on return, while browsing, and when review requests an authoritative quote. |

## Cart

| ID | Rule |
| --- | --- |
| BR-C1 | A line is one item with quantity 1–10; adding an existing item increments its quantity. |
| BR-C2 | Limit a cart to 15 distinct lines, 30 total units, and $150; explain limits in the UI and enforce them on the server. |
| BR-C3 | Decrementing quantity one removes the line with a five-second undo. Clearing two or more units requires confirmation. |
| BR-C4 | An empty cart cannot be reviewed or submitted. |
| BR-C5 | Store only item IDs, selected option IDs, and quantities for cart recovery in `sessionStorage`; clear the cart on reset or paid completion. Store only the attempt key, quote ID, and mock scenario while resolving a payment. |
| BR-C6 | Browsing totals are estimates; review uses the server quote and submit uses server state. |
| BR-C7 | Persist item IDs, quantities, and selected option IDs for cart recovery; never persist client prices. |

## Pricing and stock

| ID | Rule |
| --- | --- |
| BR-P1 | The server calculates all order amounts from catalog data; client totals are only a consent check. |
| BR-P2 | Any total change requires explicit customer consent before payment; no amount is reserved or charged before consent. |
| BR-P3 | Unavailable or insufficient lines reject the whole order; partial orders are not silently created. |
| BR-P4 | Order lines snapshot the sold item name and unit price. |
| BR-P5 | Only the informational tax display rounds; item and order totals use integer sums. |
| BR-P6 | The server owns option availability, required selections, limits, and integer-cent surcharges; quote and order snapshots retain selected option IDs and names. |
| BR-S1 | Decrement finite stock atomically during reservation so competing orders cannot oversell. |
| BR-S2 | Restore reserved stock exactly once after an authoritative failure or expiry. |
| BR-S3 | Null stock means unlimited stock and is not decremented. |
| BR-S4 | (P2) Show a low-stock message when five or fewer units remain. |

## Orders and payment

| ID | Rule |
| --- | --- |
| BR-O1 | Each submit uses an idempotency key; a replay with the same request returns the same result, while key reuse for a different request is rejected. |
| BR-O2 | Keep the same key after timeout or unknown result. Generate a new attempt only after cart/consent changes or a definite decline. |
| BR-O3 | At most one order is created per idempotency key, including concurrent and double-tapped requests. |
| BR-O4 | Orders move forward from pending to paid or failed; paid is terminal. |
| BR-O5 | Allocate pickup numbers only when paid, per business day and configured business time zone. |
| BR-O6 | Keep failed orders for audit; only paid orders count as sales. |
| BR-Y1 | The simulated checkout requests no card number, expiry, security code, or payment token; a demo order can be placed after quote review. |
| BR-Y2 | The order request contains only the quote ID, idempotency key, and selected simulated outcome; the browser never collects payment credentials. See ADR-0002. |
| BR-Y3 | The original plan uses deterministic mock-card cases. The current demo selects simulated outcomes instead of asking for card numbers. |
| BR-Y4 | Definite declines use plain language, preserve the cart, and never expose gateway codes. |
| BR-Y5 | Unknown payment status stays “confirming”; never offer another payment attempt while unresolved. |
| BR-Y6 | After five definite declines for a kiosk within ten minutes, persist a 60-second lockout and return 429 with `Retry-After`. |
| BR-Y7 | Gateway calls have a timeout and a reconciler checks durable outcomes. The demo reconciles its local mock ledger. |
| BR-Y8 | The settled amount must equal the server quote the customer accepted. |

## Kiosk experience and security

| ID | Rule |
| --- | --- |
| BR-K1 | After 60 seconds of inactivity, show a prompt; reset after 15 more seconds unless the customer chooses to continue. Clear the session on reset. |
| BR-K2 | Idle reset is suspended while a payment is unresolved or processing. |
| BR-K3 | Confirmation can start a clean order without exposing a prior customer's flow. |
| BR-K4 | Lock the submit control while the request is in flight; server idempotency remains the safety backstop. |
| BR-K5 | Use large touch targets, readable text, AA contrast, labelled controls, visible focus, and preserve browser zoom/accessibility functions. |
| BR-K6 | Errors explain what happened and the safe next action; unknown money state is never described as a decline. |
| BR-K7 | Support the planned landscape and portrait tablet sizes; keep active content reachable when the on-screen keyboard opens. |
| BR-K8 | Keep customer-facing copy in a central, localization-ready source; the plan's v1 language is English. |
| BR-X1 | Validate request shape at the API boundary, reject unknown JSON properties, and cap request size. |
| BR-X2 | Avoid free-text fields in the kiosk checkout. |
| BR-X3 | Logs must not contain payment credentials or other sensitive data. |
| BR-X4 | Demo catalog/reset/chaos endpoints are mapped only in Development when explicitly enabled, and require an admin token of at least 32 characters. They are disabled by default. |
| BR-X5 | Limit cross-origin access and rate-limit public endpoints. |
| BR-X6 | The plan's payment tokens are single-use and short-lived; the current demo issues no payment token. |
| BR-X7 | Simulated outcome controls are available only in local development and automated test builds. Outside Development, the server forces the standard simulated approval; the product continues to identify it as a demo. |
| BR-X8 | Expired quotes are retained for 24 hours after expiration, then removed in batches of at most 500. |
| BR-U1 | Package local same-origin photos for the brand, landing hero, and every catalog item; render them with descriptive layout and empty alt text when adjacent item text already names the food. |

The current demo has no order or idempotency-key cleanup policy. Those records remain in SQLite indefinitely, including after the source quote is cleaned up; plan database retention before using this implementation beyond a bounded demo.

## Status boundary

The plan's requirement text and this index do not change implementation scope by themselves. For checked behavior and deliberate omissions, use [plan-review.md](plan-review.md), the executable tests, and the code. AC-to-test links are tracked in [traceability.md](traceability.md); `make trace` enforces that each listed AC appears in test source.
