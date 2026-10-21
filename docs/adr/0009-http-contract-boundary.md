# ADR-0009: Keep HTTP contracts at the host boundary

- **Record date:** 2026-10-21
- **Status:** accepted
- **Supersedes:** ADR-0008's Application/Infrastructure references to HTTP Contracts
- **Deciders:** project owner and implementation team

## Context

Application workflows and SQLite adapters used the versioned HTTP request and response DTOs directly. That made transport shape part of their interfaces and let HTTP contract changes reach business workflows and persistence code.

## Decision

Reference `SelfServiceCheckout.Contracts` only from the HTTP host. The host maps validated request DTOs to Application commands and maps Application results to response DTOs. Application owns transport-neutral records and ports; SQLite implements those ports using Application and Domain types. Preserve the existing JSON schema and status codes.

## Alternatives considered

- **Keep sharing HTTP DTOs with Application and Infrastructure:** rejected because changes to the wire schema would continue to couple workflows and persistence to the web adapter.
- **Add another mapping or mediator package:** rejected because a few explicit host mappings handle the current API without another dependency or framework.

## Consequences

- Application and Infrastructure no longer reference the HTTP contract project; the architecture check enforces the boundary.
- HTTP mapping is explicit in the host. The existing OpenAPI snapshot and API integration tests protect the external contract.
- Some record shapes exist in both Application and Contracts, with conversion at the host boundary. This duplication is limited to the current API surface.
