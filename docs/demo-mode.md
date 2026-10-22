# Development demo mode

The Development build includes a browser admin page at `http://127.0.0.1:5173/admin` for catalog edits, demo reset, and simulated checkout scenarios. The page and API endpoints are local demo tools, not a production administration system.

## Admin page design contract

- **Operator job:** prepare and reset a local demo, update catalog availability/price/stock, or reproduce checkout recovery behavior.
- **Action order:** authenticate to the Development API, edit catalog, configure a test scenario, then reset only after reviewing the deletion warning.
- **Targets:** 1440×900 desktop and 390×844 mobile. Catalog controls remain in a readable two-column layout on desktop and stack on narrow screens; primary actions stay full-width on mobile.
- **States:** connecting, loaded catalog, empty catalog, request/token error, and confirmed-reset success. Catalog and chaos state load together so the page never displays a mixed partial snapshot.
- **Safety and access:** the password input is cleared after submission, the token lives in page memory only, every form control has a visible label, status/errors are announced, and the reset uses a native confirmation dialog. The customer checkout is the only production UI.

## Enable locally

The endpoints are enabled only when `DemoMode:Enabled` is `true` while ASP.NET Core runs in Development. Startup also requires `DemoMode:AdminToken` to be at least 32 characters. They are disabled by default, and enabling them in another environment fails configuration validation.

PowerShell example (the generated token remains only in this shell's environment):

```powershell
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:DemoMode__AdminToken = [Convert]::ToHexString($bytes)
$env:DemoMode__Enabled = 'true'
npm run dev --prefix frontend
```

Use the `X-Admin-Token` request header with the same value. Requests without a valid token receive 404. The endpoints are rate-limited. Do not commit the token or expose a Development server to an untrusted network.

Open `/admin` in the Development browser app and paste the generated token into the password field. The page clears the field after connecting, keeps the token in memory only, sends it in the protected request header, and clears it when disconnected or refreshed. The admin page and its API client are excluded from the Production JavaScript bundle. The production route displays an unavailable message, and production API configuration cannot map the admin endpoints.

## Available endpoints

All paths are under `/api/admin`:

- `GET /items` returns every catalog item, including inactive items, for the admin page.
- `PATCH /items/{itemId}` accepts `priceCents`, `stock`, `isActive`, or `clearStock`. Example: `{"stock":0}`.
- `POST /reset` restores seeded catalog data and clears demo orders, quotes, payment attempts, ledger entries, decline lockouts, and mock chaos state.
- `GET /chaos` returns the current process-local scenario and chaos configuration.
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

The page shows inactive products so they can be re-enabled, parses displayed dollar amounts into integer cents without floating-point arithmetic, and asks for confirmation before reset. A chaos override affects new attempts handled by this API process. `StillUnknown` and `CrashAfterReservation` intentionally leave attempts pending and reserve stock; use reset only with disposable local demo data.
