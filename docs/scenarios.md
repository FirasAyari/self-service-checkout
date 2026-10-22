# Checkout scenario catalog

These scenarios preserve the latest plan's test ideas and IDs. They are coverage targets, not a claim that every path is implemented or automated. Their expected counter-behavior comes from the plan; intentional security changes are called out in [plan-review.md](plan-review.md). Automated acceptance-criteria coverage is reported by [traceability.md](traceability.md).

Tags: **U** unit, **I** API/integration, **E** browser end-to-end.

## A. Happy paths

| ID | Situation | Expected counter | Type |
| --- | --- | --- | --- |
| SC-A1 | Browse, add items, complete checkout | Show pickup number and then cleanly reset. | E |
| SC-A2 | Edit cart, go back, then pay | Changed cart uses a new key; one order is created. | E |
| SC-A3 | Review long after menu load with no catalog change | Quote matches the displayed total without extra consent. | I |
| SC-A4 | Choose a required drink size and optional add-ons | The UI sends option IDs; the server validates and prices them, then snapshots the option names and amount. | U/I/E |

## B. Input and cart abuse

| ID | Situation | Expected counter | Type |
| --- | --- | --- | --- |
| SC-B1 | Tap add repeatedly | Quantity caps at ten with an explanation. | E |
| SC-B2 | Exceed line, unit, or total cap | UI explains the limit; API rejects a bypass. | I |
| SC-B3 | Rapidly tap the same item | Each action is counted once. | U |
| SC-B4 | Continue from the reviewed quote without entering payment details | The demo-order action is available without card fields. | E |
| SC-B5 | Inspect simulated checkout inputs | No card number, expiry, security code, or token input is rendered. | E |
| SC-B6 | Send malformed quantities, unknown IDs, missing or extra fields | Reject invalid input without persisting an order or reserving stock. | I |
| SC-B7 | Submit a client-invented price or total | Ignore client pricing and reject changed consent. | I |
| SC-B8 | Repeat an item on multiple cart lines | Normalize/merge before validating limits. | I |
| SC-B9 | Submit an empty cart | Reject; UI cannot proceed to payment. | I |

## C. Catalog changes

| ID | Situation | Expected counter | Type |
| --- | --- | --- | --- |
| SC-C1 | Item sells out while in the cart | Review flags the line and requires reduce/remove. | E |
| SC-C2 | Item sells out between review and submit | Reject without charging; preserve a safe recovery path. | E |
| SC-C3 | Price changes after review | Require explicit acceptance of the new total. | E |
| SC-C4 | Item becomes inactive | Reject it and let the customer resolve the cart. | I |
| SC-C5 | Menu changes during browse | Refresh the grid and flag unavailable cart lines at review. | E |
| SC-C6 | Two kiosks compete for the last unit | Exactly one reservation succeeds; stock never goes negative. | I |
| SC-C7 | Catalog changes after order reservation | Preserve the price snapshot used for that order. | I |

## D. Payment and ambiguous outcomes

| ID | Situation | Expected counter | Type |
| --- | --- | --- | --- |
| SC-D1 | Definite decline | Keep cart; state no charge only when decline is authoritative. | E |
| SC-D2 | Specific card decline reason | The demo outcome selector controls the simulated result; card values do not select a decline reason. | — |
| SC-D3 | Timeout after payment approval | Stay confirming, then reconcile to paid with one order. | I/E |
| SC-D4 | Timeout without a payment result | Remain pending until an authoritative result; do not release stock on absence alone. Show the order reference and configured venue help link. | I/E |
| SC-D5 | Double tap Pay | Disable client control and create at most one order by key. | E/I |
| SC-D6 | Reload while processing | Restore only cart IDs/quantities and the unresolved attempt identifiers, then resolve with the same key; no prices/card data are stored. | E |
| SC-D7 | Connection drops after request reaches server | Same key resolves/replays the original attempt. | I |
| SC-D8 | Connection drops before request reaches server | Explain connection failure and resolve against the same attempt when uncertain. | E |
| SC-D9 | Five definite declines within ten minutes | Persist a 60-second kiosk lockout and return 429 with `Retry-After`. | I |
| SC-D10 | Process stops after approval before order settles | Durable ledger lets reconciliation settle after restart. | I |
| SC-D11 | Process stops after reservation before gateway call | Keep the order pending and stock reserved; retrying the same key records one authoritative simulated result and settles the existing order once. | I/E |
| SC-D12 | Reuse a payment token | **Not applicable; the demo creates no card tokens.** | — |
| SC-D13 | Payment provider is slow | **No external provider exists in this demo.** | — |
| SC-D14 | Customer tries to pay again while confirming | No new attempt can be created; the customer can retry only the same idempotent attempt. | E |

## E. Network and infrastructure

| ID | Situation | Expected counter | Type |
| --- | --- | --- | --- |
| SC-E1 | API is unavailable on initial load | Recoverable error with retry; never show an empty menu as success. | E |
| SC-E2 | API is slow | Show progress, prevent duplicate submit, and resolve uncertain payment by the same key. | E |
| SC-E3 | API restarts mid-session | Persisted order and idempotency state remain usable. | I |
| SC-E4 | SQLite is busy | Short transactions and busy timeout; return a retryable error safely. | I |
| SC-E5 | Database write fails | Roll back reservation/order changes and return a generic traceable error. | I |
| SC-E6 | Business day rolls over during an order | Assign pickup number using the business day at settlement. | U |
| SC-E7 | Response has malformed JSON | Client reports a recoverable error, not a blank page. | U |
| SC-E8 | Reviewer has port or origin differences | Document ports and proxy so the local flow stays same-origin. | — |

## F. Kiosk and accessibility

| ID | Situation | Expected counter | Type |
| --- | --- | --- | --- |
| SC-F1 | Customer walks away mid-cart | Idle prompt/reset protects the next customer. | E |
| SC-F2 | Customer walks away during checkout | No payment credentials are collected; idle reset clears the active cart and order state. | E |
| SC-F3 | Customer walks away on confirmation | Reset after a suitable confirmation period. | E |
| SC-F4 | Customer needs to record pickup number | Keep the number prominent and readable. | — |
| SC-F5 | Next customer arrives immediately | Start a clean order with no previous cart or reference. | E |
| SC-F6 | Random taps hit destructive controls | Provide undo or confirmation and a path forward. | — |
| SC-F7 | Customer taps clear accidentally | Confirm clearing larger carts. | E |
| SC-F8 | Bright light, low vision, or gloves | High contrast, large touch targets, readable type. | — |
| SC-F9 | On-screen keyboard opens | Keep active field and primary action reachable. | E |
| SC-F10 | Customer attempts zoom/long press | Preserve browser zoom and standard accessibility behavior. | — |
| SC-F11 | Screen-reader or switch user | Labels, logical focus, and announced totals/errors. | E |
| SC-F12 | Customer leaves while payment is confirming | Do not reset the unresolved attempt. | E |

## G. Integrity and security

| ID | Situation | Expected counter | Type |
| --- | --- | --- | --- |
| SC-G1 | Replay after quote cleanup (orders and idempotency keys have no expiry policy) | Return the stored order once; do not reserve or settle it again. | I |
| SC-G2 | SQL-looking string in item ID | Parameterized data access and validation prevent injection. | I |
| SC-G3 | Call admin route outside enabled Development demo mode | No admin route is exposed. | I |
| SC-G4 | Search API requests, logs, and browser state for payment credentials | The checkout has no credential inputs and its order request contains only the simulated-order contract. | I/E |
| SC-G5 | Submit oversized body | Reject at the request boundary. | I |
| SC-G6 | Submit many concurrent orders | Unique pickup numbers, nonnegative stock, one order per key. | I |
| SC-G7 | Flood requests | Rate limits reject excess traffic with a retryable response. | I |
| SC-G8 | Production build is used for customer checkout | No simulated outcome chooser appears and a non-approval request is normalized to the standard simulated outcome. | I/E |
| SC-G9 | Quote traffic leaves expired records behind | Maintenance retains records for 24 hours after expiry and deletes at most 500 stale quotes per batch. | I |

## H. Visual content

| ID | Situation | Expected counter | Type |
| --- | --- | --- | --- |
| SC-H1 | Customer opens the menu on desktop or mobile | Good Table branding, a food hero, and a matching photo for every catalog item load from same-origin assets; assistive technology gets the item name from the adjacent heading without redundant image text. | E |
