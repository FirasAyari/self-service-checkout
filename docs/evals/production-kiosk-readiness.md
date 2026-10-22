# Production kiosk readiness evaluation

This product evaluation defines measurable release gates for the checkout demo and for a real single-location kiosk. It is an evaluation plan, not evidence that an unevaluated capability exists. A passing test name or trace entry alone does not prove the behavior; the named assertion must exercise it.

## Capability evaluations

| ID | Capability | Deterministic grader | Pass condition |
| --- | --- | --- | --- |
| EVAL-PROD-01 | Readiness reflects the checkout database; liveness reflects only process health. | ASP.NET integration tests against healthy and unavailable database states. | Liveness stays healthy while readiness returns unhealthy for a failed database check; no exception or connection detail is returned publicly. |
| EVAL-PROD-02 | The kiosk never presents a simulated outcome as a real charge and collects no payment details. | API and browser tests for configured payment mode and customer-facing copy. | The UI identifies demo checkout, renders no payment credential inputs, the API accepts no card credentials, the outcome chooser is absent from production builds, and the server forces the standard simulated approval outside Development. |
| EVAL-PROD-03 | Store time zone is valid before order processing starts. | Options validation tests. | Invalid or unavailable zone IDs fail startup with a safe configuration error; valid configured zone controls pickup business date. |
| EVAL-PROD-04 | Rate limits use the real client address only when forwarded by an explicitly trusted proxy. | Middleware integration tests for direct, trusted, and untrusted forwarded headers. | Spoofed headers from untrusted peers are ignored; configured proxy headers produce the intended client address. |
| EVAL-PROD-05 | Browser API types cannot silently drift from the committed OpenAPI snapshot. | `node scripts/generate-api-types.mjs --check` in CI. | CI fails when generated types differ and passes when they match. |
| EVAL-PROD-06 | Browser code passes static analysis with React and TypeScript rules enabled. | `npm run lint --prefix frontend` in CI. | ESLint exits with no errors or warnings for the browser source. |
| EVAL-PROD-07 | API and kiosk responses set baseline browser security and privacy headers. | ASP.NET integration test on API responses; production browser check confirms the rendered app has no inline style attributes. | `nosniff`, frame denial, no referrer, a restrictive CSP with no inline script/style allowances or data-URI image/font sources, and `no-store` for API responses are present. |

## Regression evaluations

| ID | Existing behavior | Grader | Pass condition |
| --- | --- | --- | --- |
| EVAL-REG-01 | Checkout acceptance behavior remains covered. | `node scripts/run-tests.mjs` | Domain, API, browser, and delivery suites pass. |
| EVAL-REG-02 | Browser checkout remains operable and accessible in supported layouts. | `node scripts/run-e2e.mjs` | Playwright suite passes at its configured viewport sizes with its accessibility assertions. |
| EVAL-REG-03 | Required acceptance criteria remain linked to named tests. | `node scripts/traceability.mjs --strict` | Every `Required` row is linked; documented deviations remain separate from coverage. |
| EVAL-REG-04 | Server and client remain buildable as release artifacts. | Release .NET build and frontend production build. | Both builds pass with zero compiler warnings promoted as errors. |
| EVAL-REG-05 | The documented Unix development entry point starts both services and releases them after the smoke. | `node scripts/dev-smoke.mjs` in the Ubuntu CI job. | The API health endpoint and Vite root both return success, and the smoke process group is stopped when the check ends. |
| EVAL-REG-06 | The published Docker image works with production defaults and persistent order state. | `node scripts/docker-smoke.mjs` in the frontend CI job. | Packaged assets load, oversized requests receive 413, production forces simulated approval, and the same order is replayed after a container restart. |

For payment, reservation, retry, and unknown-outcome regressions, this evaluation requires three consecutive successful CI runs (`pass^3`). The earlier run [39698542941](https://github.com/FirasAyari/self-service-checkout/actions/runs/39698542941) on `d5826fc` failed at Docker smoke and reset the streak. Since then, full runs [39700595632](https://github.com/FirasAyari/self-service-checkout/actions/runs/39700595632) on `6857b0f` and [39701601424](https://github.com/FirasAyari/self-service-checkout/actions/runs/39701601424) on `de010ee` passed all backend, frontend (including Docker smoke), and browser jobs. The current streak is two; one more full successful workflow is needed to satisfy this evaluation gate. Docker CLI is unavailable locally, so the hosted Docker runs verify the CI engine path but do not establish local-engine or physical-kiosk readiness.

## Human and environment gates

These gates cannot be satisfied by this repository's automated tests alone:

- Restore a recent production database backup in a clean environment and verify order, inventory, and payment reconciliation.
- Have the data owner approve order/idempotency retention and archive rules, including replay safety and authorized deletion.
- Verify TLS, trusted proxy and host settings, kiosk OS lockdown, printer/device behavior, touch input, on-screen keyboard, screen reader, zoom, and idle-session reset on the actual target hardware.
- Approve the operating runbook for ambiguous demo outcomes, stuck reservations, service outage, inventory mismatch, incident response, and rollback.

## Promotion rule

The demo may be promoted as a demo when all regression evaluations pass. A kiosk deployment is blocked until capability evaluations EVAL-PROD-01 through EVAL-PROD-07 pass and every human/environment gate has named evidence and an owner. Live payment processing is outside this product's requirements; the user interface and operating procedure must continue to identify simulated outcomes clearly.
