# Capture safety and signal semantics

Netkit sanitizes history **before retention and admin API serialization**. Forwarded requests and responses keep their original values. The dashboard sanitizes received captures and builder responses as defense in depth; response copies use the same sanitized value.

## Redaction policy

- Header and JSON field names containing authorization, cookie, password, passwd, secret, token, apikey, credential, or privatekey are masked, ignoring case, hyphens, underscores and spaces.
- `--redact-fields customer_pin,x-internal-key` adds exact normalized JSON/header field names. Matching applies recursively to JSON arrays and objects. This policy is exposed by health metadata so the builder applies it too.
- URL userinfo and all query values are masked; fragments are removed. Credential-shaped path segments (including Telegram bot tokens), segments following sensitive field names, colon-bearing segments, and segments longer than 32 characters are masked. Location, Referer, and X-Netkit-Destination headers and URL-valued JSON strings use the same policy.
- Bearer values, JWT-shaped strings and Telegram bot tokens are masked in retained strings.
- Only complete JSON bodies up to 64 KiB are retained after sanitization. Non-JSON, partial JSON, SSE, binary and larger bodies have an explicit omission marker. Streaming forwarding is unaffected; inspection capture buffers are bounded while byte counts track the full observed stream.
- Transport errors use controlled messages and bounded failure reasons (including TLS certificate and timeout), not raw exceptions containing target URLs.

This is a field/pattern policy, not a general secret detector. Custom credentials in ordinary path segments, arbitrary text fields or unrecognized headers require policy changes or additional `--redact-fields`. Inspect only trusted traffic and restrict access to the proxy/admin service. There is no raw-capture reveal/export option in this release.

Builder drafts remain in tab memory; no request state is written to browser storage. Existing `fetchr-request-store` saved drafts are discarded on dashboard load without hydration. A storage-access failure displays a cleanup notice. Values the user deliberately types in the composer are editable, and may be visible; this is distinct from sanitized captured evidence. Sending a draft containing redaction/omission markers is blocked until the missing values are replaced. Sanitized URLs are copied, not opened as if they were a replay.

## Outcomes and timing

`response_status` is accompanied by `response_source` (`upstream` or `proxy`) and `outcome`:

| Outcome | Meaning |
|---|---|
| complete | Transfer completed, including HTTP 4xx/5xx responses. This is not HTTP success. |
| interrupted | Transfer ended early; an already received upstream status is preserved. |
| client_canceled | The downstream request context was canceled. |
| blocked_by_inspection | A protocol upgrade was rejected by inspection mode; status belongs to Netkit. |
| upstream_error | Upstream connection/request failed before response headers. |
| proxy_error | Netkit could not process the request or establish a tunnel. |
| tunnel_only | Opaque CONNECT tunnel established. Encrypted inner requests and later tunnel lifetime are not observed. |
| unknown | Outcome is unavailable; do not infer success. |

The legacy `success` field means a completed transfer or established tunnel. The dashboard labels it **Transfer Completion**. HTTP status distribution includes upstream statuses only; its denominator is retained observations, which can also include proxy failures and tunnels.

`total_duration_us` measures the handler lifetime through forwarding completion/failure. CONNECT measures establishment only. `upstream_latency_us` is dispatch to response headers, or the end of a failed connection attempt. Missing phase timestamps yield zero rather than an overflowing duration. `proxy_overhead_us` is retained for compatibility but is labeled **Other elapsed time**: total minus the upstream phase, including body transfer and downstream waiting, not pure processing overhead. Polling and streaming can legitimately take much longer than ordinary requests.

History and statistics describe only the retained in-memory buffer, with capacity and oldest/newest timestamps. They are not lifetime totals. Health metadata exposes capture mode: HTTP with opaque HTTPS tunnels, or HTTP/HTTPS inspection. HTTPS inspection cannot handle protocol upgrades; exchanges appear when completed, not while still streaming. Inspection connection setup failures before an inner HTTP request are not currently individual history records or exchange metrics.

## Metrics

`/metrics` (also `/api/admin/metrics` under the dashboard base path) exports:

| Metric | Type | Scope |
|---|---|---|
| netkit_requests_total | Counter | Total observations since process start. |
| netkit_exchanges_total | Counter | Observations by bounded method, outcome and upstream status class. |
| netkit_exchange_duration_seconds | Histogram | Total handler lifetime / CONNECT establishment, same labels. |
| netkit_response_headers_seconds | Histogram | Dispatch to upstream response headers, excluding opaque tunnels and failed attempts. |
| netkit_history_records | Gauge | Current retained count. |

Counters/histograms survive history eviction and clear; they reset on process restart. They do not count dashboard/admin reads, CORS preflights, or encrypted requests inside opaque tunnels. Labels never include raw hosts, paths, URLs, IDs or credentials. Nonstandard methods map to OTHER, and missing/non-upstream statuses map to none. Host/route dimensions and alert rules are later roadmap deliverables.

The old constant `netkit_proxy_status` sample is removed. Use the external scraper's `up` signal for reachability; successful scraping does not prove traffic is arriving or that dependencies are healthy.

## Dashboard failure states

History and statistics fetch failures propagate to components rather than becoming empty arrays/null. The UI distinguishes initial loading, an empty successful capture, no filter matches, unavailable data and stale retained results after failed refresh. Last successful refresh remains visible. API reachability is distinct from traffic freshness; history refresh is manual in this release.

## Validation

Run `go test -race -tags=unit ./...`, `go test -race -tags=e2e ./test/e2e`, and `golangci-lint run`. In `dashboard`, run `npm run test:unit`, `npx tsc --noEmit`, `npx eslint src`, and `npm run build`.

Regression fixtures cover raw forwarding versus sanitized storage/API, nested/custom fields, encoded URL credentials, incomplete/oversized payloads, complete 200/401 responses, interrupted 200, inspection rejection, concurrent scrapes, bounded labels and counters surviving eviction/clear. Browser checks should additionally exercise failure-after-success, empty capture, request detail, sanitized copy and draft reset after reload.
