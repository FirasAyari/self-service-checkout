# ADR-0001: .NET API and React client

- **Record date:** 2026-10-20 (reconstructed from the retained conversation and repository; original decision timestamp not preserved)
- **Status:** accepted
**Deciders:** project owner and implementation team

## Context

The checkout needs a small browser UI and a server-owned catalog, quote, stock, and order state. The latest supplied plan chooses a C# API with React/Vite. An earlier scaffold used Blazor, but that plan was superseded.

The take-home PDF prefers Python or Node for the API but explicitly says that preference is optional. The plan's C# choice is therefore a deliberate stack deviation, not a requirement mismatch.

## Decision

Use .NET 10 ASP.NET Core Minimal APIs with EF Core/SQLite and a React + Vite + TypeScript browser client. Keep domain rules in a framework-independent C# library.

## Alternatives considered

- **Blazor:** keeps the UI in C#, but does not match the latest plan's explicit React/Vite direction.
- **One client-owned application:** less setup, but cannot safely own prices, stock reservation, or payment state.

## Consequences

- The server owns money, catalog, reservations, and order transitions; the browser is a same-origin API client.
- The repository must support both .NET and npm toolchains and preserve a JSON boundary between them.
- SQLite is suitable for this single-location demo; production multi-instance deployment needs a database/concurrency review.
