# ADR-0008: Layered modular monolith boundaries

- **Record date:** 2026-10-21
- **Status:** superseded in part by ADR-0009
- **Deciders:** project owner and implementation team

## Context

The first backend layout put the HTTP host, checkout workflows, EF Core, and SQLite in one project. That made endpoint and application changes depend directly on persistence details, weakened test seams, and encouraged large services to own unrelated work. The product is a single-kiosk demo, so splitting it into separately deployed services would add operational work without solving a current need.

## Decision

Keep one deployable ASP.NET Core host and organize the backend as a modular monolith:

- `Checkout.Domain` contains framework-free cart, money, tax, and order-transition rules.
- `SelfServiceCheckout.Application` contains checkout workflows, application records, failure kinds, and narrow ports. It depends only on Domain.
- `SelfServiceCheckout.Infrastructure.Sqlite` implements storage and demo-provider ports, owns EF Core and migrations, and performs atomic SQLite operations. It depends on Application and Domain.
- `SelfServiceCheckout.Contracts` owns the HTTP DTOs shared with the browser and is referenced only by the HTTP host.
- `SelfServiceCheckout` is the composition root and HTTP adapter. It maps contract DTOs to application commands and results, depends on application interfaces, and registers persistence through the infrastructure extension.
- The React client separates checkout state, presentation helpers, and screen components under `frontend/src/checkout`.

Dependencies point inward: Application depends on Domain; Infrastructure depends on Application and Domain; the host composes those projects and owns the HTTP contract mapping. Domain and Application do not reference HTTP contracts, ASP.NET Core, EF Core, or SQLite. HTTP status codes are mapped from application failure kinds in the host.

Keep catalog validation and quote creation in Application. Keep inventory reservation and payment-outcome settlement transactions in the SQLite adapter because they require atomic database updates. The application coordinates those operations through ports. Unknown payment outcomes remain pending and retain their reservation.

## Alternatives considered

- **Keep all backend code in the web project:** rejected because persistence and HTTP details would continue leaking through the checkout boundary.
- **Introduce microservices or a generic repository framework:** rejected because this single-kiosk demo has no independent deployment or storage requirements that justify the added operational and abstraction cost.

## Consequences

- Domain and Application workflows can be tested without starting ASP.NET or opening a SQLite database.
- Database/provider changes are concentrated in infrastructure adapters and their composition; transport changes are mapped in the HTTP host; transaction behavior remains covered by API integration tests.
- A static architecture test checks project references and prevents persistence dependencies from entering the host, Domain, or Application.
- SQLite remains a single-host deployment choice. This decision does not make the demo a multi-instance production checkout or add real payment processing.
