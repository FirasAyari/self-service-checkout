# Development demo mode

The API has optional catalog edit, database reset, and mock-outcome override endpoints for local demonstrations. They are not a browser admin UI or a production administration system.

## Enable locally

The endpoints are enabled only when `DemoMode:Enabled` is `true` while ASP.NET Core runs in Development. Startup also requires `DemoMode:AdminToken` to be at least 32 characters. They are disabled by default, and enabling them in another environment fails configuration validation.

PowerShell example (the generated token remains only in this shell's environment):

```powershell
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:DemoMode__AdminToken = [Convert]::ToHexString($bytes)
$env:DemoMode__Enabled = 'true'
make dev
```

Use the `X-Admin-Token` request header with the same value. Requests without a valid token receive 404. The endpoints are rate-limited. Do not commit the token or expose a Development server to an untrusted network.

## Available endpoints

All paths are under `/api/admin`:

- `PATCH /items/{itemId}` accepts `priceCents`, `stock`, `isActive`, or `clearStock`. Example: `{"stock":0}`.
- `POST /reset` restores seeded catalog data and clears mock chaos state.
- `POST /chaos` selects `scenarioOverride` as `Approve`, `Decline`, `UnknownAfterApproval`, `StillUnknown`, or `null`. `mode` may be `Latency` (0–7000 ms), `DropResponse`, or `CrashAfterReservation`.
- `make chaos-latency`, `make chaos-decline`, `make chaos-timeout-after-charge`, `make chaos-timeout-no-charge`, `make chaos-drop-response`, and `make chaos-crash-after-reservation` set reusable presets; `make chaos-clear` restores client-selected outcomes. Set `DEMO_ADMIN_TOKEN` in the environment first. The crash preset returns a simulated 503 after reservation is committed and before a ledger result exists; the API host stays up. The order remains pending, stock remains reserved, and reconciliation cannot infer a decline. Retry only with the same idempotency key. `make chaos-clear` clears the preset; the protected demo reset also clears the pending order and restores stock.

For example, using PowerShell:

```powershell
$headers = @{ 'X-Admin-Token' = $env:DemoMode__AdminToken }
Invoke-RestMethod -Method Patch -Uri 'http://127.0.0.1:5080/api/admin/items/turkey-melt' `
  -Headers $headers -ContentType 'application/json' -Body '{"stock":0}'
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:5080/api/admin/chaos' `
  -Headers $headers -ContentType 'application/json' -Body '{"scenarioOverride":"StillUnknown"}'
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:5080/api/admin/reset' -Headers $headers
```

The decline lockout is separate from these controls: after five definite declines for a kiosk in a ten-minute window, the API stores a 60-second lockout and responds with 429 plus `Retry-After`. Resetting demo data clears that lockout.
