# Rejected, deferred, and superseded choices

This log separates deliberate design choices from features that are simply unfinished. It is based on the latest supplied plan, retained review notes, and repository state; it is not a record of every idea discussed.

| Status | Choice | Reason / current treatment |
| --- | --- | --- |
| Superseded | Earlier Blazor scaffold | The latest supplied plan selects a .NET Minimal API and React/Vite client. The API/domain remain C#. |
| Rejected for this demo | Collect card details or send card values to a mock token endpoint | No payment fields are rendered; the demo selects a simulated outcome and creates no token. A future real-payment feature needs a separately reviewed provider boundary. See [ADR-0002](adr/0002-no-card-data-in-demo.md). |
| Rejected | Treat an absent payment-ledger row as proof that no charge occurred | Absence is ambiguous. Keep the order pending and reservation held until an authoritative outcome is available. See [ADR-0003](adr/0003-idempotency-and-unknown-outcomes.md). |
| Superseded | Hash raw request bytes and claim idempotency before validating the checkout | Raw serialization is unstable and a pre-claim could strand a key. The current fingerprint uses normalized quote/outcome data and writes the claim with order and reservation. See [ADR-0003](adr/0003-idempotency-and-unknown-outcomes.md). |
| Rejected for this product framing | Route unresolved kiosk orders to a cashier/staff desk | The brief does not establish staffed support. The app keeps the customer on a self-service status screen and does not invent a staff workflow. |
| Implemented with privacy limits | Restore cart contents after browser reload | Session storage keeps item IDs, selected option IDs, and quantities plus only key/quote/scenario for an unresolved attempt. Idle reset and paid completion clear the cart; no price or payment data is stored. |
| Implemented with guardrails | Repeated-decline lockout | Five definite declines per kiosk within ten minutes persist a 60-second lockout and return `Retry-After`; this does not rely on card-number identity. |
| Implemented with guardrails | Demo catalog/reset/chaos controls | Development only, opt-in, and protected by a configured 32+ character token. Disabled by default; not a production management workflow. |
| Implemented and verified | Domain/API/client/delivery and browser suites | Latest behavioral suite counts, typecheck/build results, strict trace, and environment limits are recorded in [plan-review.md](plan-review.md). |
| Implemented P2 | Cold-brew size/add-on options and receipt QR | The server validates option IDs and prices integer-cent surcharges, while order snapshots preserve selected names and prices. The offline QR encodes the visible receipt reference, pickup number, and total; it makes no network request. |
| Rejected after review | Five-minute idle warning plus one-minute reset | The latest plan's faster 60-second prompt and 15-second warning was kept to reduce the chance of exposing a previous customer's order at a kiosk. The prompt offers a continue action; test keyboard and screen-reader timing on the actual kiosk before deployment. |

“Deferred” means not in the current implementation; it does not imply that a future product decision has rejected it. Keep this list aligned with code and tests as scope changes.
