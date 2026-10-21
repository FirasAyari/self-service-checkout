# Work timeline (reconstructed)

This is a coarse reconstruction from the retained conversation and repository contents on 2026-10-20. Exact timestamps, every prompt, and intermediate experiments were not preserved, so this is not a complete activity log.

1. The checkout brief and an initial implementation plan were reviewed. The workspace had no product implementation at the start of the recorded work.
2. The updated implementation plan selected a .NET 10 Minimal API, EF Core/SQLite, and a React/Vite client. The project was aligned to that newer plan while keeping checkout/domain behavior in C#.
3. ECC review passes covered business/domain rules, .NET architecture and build repair, payment/security boundaries, and accessibility. The resulting decisions and caveats were recorded in `plan-review.md`.
4. The .NET solution, API contracts, domain library, SQLite persistence/migration, quote/order/status API, mock outcome flow, and React client were implemented. An SDK was installed in the user's profile because the machine's default SDK was older than the project target.
5. .NET Release and frontend production builds were reported passing. Automated domain/API tests were then added in a follow-up pass; their current coverage is measured by `make trace`, not inferred from this timeline.
6. Delivery docs, Make/CI orchestration, strict AC traceability, browser/axe journeys, and a protected Development demo mode were added.
7. The OpenAPI snapshot/type generation and drift checks were added. Demo chaos now covers bounded latency and lost-response recovery alongside decline and ambiguous outcomes. Cold-brew size/add-on pricing and an offline QR receipt were then completed from the P2 scope. Remaining verification and device limitations are recorded in `plan-review.md` and `rejected.md`.

For exact present-state evidence, inspect source, test output, `docs/traceability.md`, and `git` history. This reconstructed timeline should not be extended with guessed timestamps or red-green claims.

8. The post-review cleanup removed all simulated card-entry fields, moved checkout copy and the order placement screen into focused React modules, and recorded AC-Y1/AC-Y2 as intentional scope deviations. Manual kiosk and CI release evidence remains outstanding.
9. The checkout quote/menu and order responsibilities were split into separate application services. Delivery-contract checks were aligned with the no-credential flow, and the final local domain, API, browser, E2E, Production-browser, build, lint, and strict trace checks passed; see `plan-review.md` for counts and environment limits.
10. A further security pass removed inline-style and data-URI allowances from the CSP. The Production browser check now launches the ASP.NET app with an isolated SQLite database, verifies the actual response policy and packaged images, and completes a simulated order; the parent runner removes its temporary database after the host stops.
11. The backend was reorganized into Domain, Application, Contracts, SQLite Infrastructure, and HTTP host projects. Catalog and order-placement workflows now use application-owned ports, settlement/reservation transactions remain behind SQLite adapters, frontend state/presentation/screens were extracted into focused modules, and an architecture-boundary check was added. Current local verification and deployment evidence gaps are listed in `plan-review.md`.
