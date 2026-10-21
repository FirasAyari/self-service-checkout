# Single-kiosk deployment and operations

This runbook covers a kiosk running the simulated-payment product in ASP.NET Core's `Production` environment. It does not turn simulated outcomes into charges. Keep the kiosk and customer-facing materials visibly labeled as a demo. Do not use it to take money or present a simulated approval as proof of payment.

## Deployment boundary

- Run one API process on one host with its SQLite database on that host's persistent local disk. Do not place the database on a network share or run multiple API instances against it.
- Serve the built React client from the API's published static files. `make build` must pass before publishing.
- Terminate TLS at a reverse proxy on the kiosk host or a controlled network edge. Configure that proxy to reject unknown host names and redirect HTTP to HTTPS. The API emits HSTS outside Development but does not terminate TLS or perform the HTTP-to-HTTPS redirect itself.
- Use a dedicated kiosk OS account and browser kiosk mode. Restrict administration of the host and database to named operators. The application has no staff login, remote catalog administration, or production admin UI.
- Keep the database and its backup outside the application publish directory. Restrict file access to the service identity and backup operator.

## Required configuration

Set these values through the service environment or deployment configuration, not by editing a deployed binary:

```text
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://127.0.0.1:5080
AllowedHosts=kiosk.example.internal
Checkout__DatabasePath=C:\ProgramData\SelfServiceCheckout\checkout.db
Checkout__KioskId=store-001-kiosk-01
Checkout__BusinessTimeZone=America/Sao_Paulo
Checkout__MockPaymentsEnabled=true
DemoMode__Enabled=false
ReverseProxy__KnownProxies__0=127.0.0.1
```

Replace the host name, kiosk ID, time zone, and proxy address with values for the installation. If the proxy runs on another host, set its exact IP address as a known proxy. With no configured proxy address, forwarded headers are ignored. Do not clear the trusted-proxy lists to make a proxy work; an empty list permits untrusted forwarded headers. The server validates the time-zone ID at startup.

`Checkout__MockPaymentsEnabled=true` enables only the local simulation. In Production, the customer does not choose the outcome; every new attempt uses the standard simulated approval, the API enforces that outcome, and the screen and receipt state that no money was charged. Keep the demo label visible. `DemoMode__Enabled` must remain false in Production; attempts to enable the administration endpoints outside Development fail startup validation. The application has no customer payment-detail fields. Do not add real payment credentials to its configuration.

## Release procedure

1. Run `make check`, `make e2e`, `make docker-smoke`, and `make trace` against the release candidate. The Production browser check starts the ASP.NET app in Production against a temporary SQLite database, verifies the response CSP and packaged brand/menu photos, and completes a simulated order with no customer payment fields. The Docker smoke builds and starts the container, verifies its packaged photos and disabled admin routes, completes a simulated order, restarts the container, and verifies the same order replays from its persistent volume. Confirm the API contract snapshot is current and acceptance-criteria traceability passes.
2. Build/publish from the reviewed source and retain the prior application artifact for rollback. Do not deploy a Development build.
3. Stop the service before replacing the application files. Make a SQLite-consistent backup before starting a version that applies migrations automatically during startup.
4. Start the service, then require `GET /health/live` and `GET /health/ready` to return `200`. Readiness checks the checkout database. Check that the browser loads from the same origin and that its API requests succeed.
5. Run one staff-supervised demo order, verify the receipt says the result is simulated, and confirm a fresh order starts without previous customer data.
6. Record the application version, database backup identifier, kiosk identifier, proxy/TLS check, test order reference, operator, and outcome in the deployment record.

## Backup and recovery

Back up the SQLite database on a schedule and before every release. Prefer SQLite's online backup command while the service is running:

```powershell
sqlite3 "C:\ProgramData\SelfServiceCheckout\checkout.db" ".backup 'D:\CheckoutBackups\checkout-2026-10-21.db'"
```

Alternatively, stop the service cleanly before copying the database file. Keep backups access-controlled and off the kiosk disk. Do not delete `-wal` or `-shm` files while the service is running.

At least once before any kiosk trial, restore a recent backup to a clean host, start the same application release against it, confirm readiness, inspect orders and inventory, and verify pending payment attempts remain pending until a ledger result exists. A backup that has not been restored is not a proven recovery plan.

For an outage, stop accepting new orders, retain the database and logs, and do not clear pending attempts or reserved stock based only on a missing payment ledger result. Restore only from a verified backup with an operator recording which version and backup were used. Start the service and confirm readiness before returning the kiosk to the demo.

## Pending simulated order

Production mode forces the local simulated approval and never charges money. If an order remains pending beyond the 30-second reconciliation window:

1. Take the kiosk out of customer service and keep the current checkout tab open. Do not start a second order with a new idempotency key.
2. Check `/health/live` and `/health/ready`. Keep the service and database available so reconciliation can finish if a durable result exists.
3. Record the kiosk ID, order reference, time, health status, and application logs. The checkout does not collect card credentials.
4. Preserve the database and logs. Do not run Development demo-reset commands or edit order, ledger, or stock rows directly.
5. Return the kiosk to service only after the order has a terminal status and a named operator records the recovery.

The application has no Production operator screen or safe manual settlement endpoint. If the order has no authoritative result, leave it pending and escalate to the application maintainer; repository policy does not allow guessing an outcome or releasing the reservation.

## Kiosk acceptance before use

Automated browser tests do not replace testing the actual touchscreen, orientation, on-screen keyboard, printer, OS kiosk controls, network loss, and screen-reader behavior. Before allowing customers to use a device, record a supervised check of the required portrait and landscape layouts, zoom, keyboard reachability, focus, contrast, touch targets, idle reset, completion reset, outage recovery, printer output, privacy between sessions, and the exact demo-payment wording.

## Current limitation

The application is a single-host, SQLite-backed checkout demo. The repository can test software behavior, but it cannot prove the deployment's TLS/proxy configuration, backup restoration, hardware behavior, or local operating procedure. Production kiosk readiness stays unverified until the manual evidence above is recorded.
