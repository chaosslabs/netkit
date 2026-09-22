# Investigation workspace

Traffic is the dashboard landing page. Compose is available at `/compose/`; the existing `/requests-history/` and `/requests-statistics/` links remain available (Traffic and Overview respectively).

## Investigate without losing context

Select a host, method, outcome, UTC time range, or search captured URLs. Open a request to see its HTTP status and transfer outcome separately, followed by Request, Response, and Timing tabs. Previous/Next move within the current filtered result set. At desktop widths the inspection panel sits beside the table and its width is adjustable; smaller windows show the selected detail with Back to results.

Traffic and Overview share the current in-memory evidence snapshot, filters, search and selection during workspace navigation. Structured filters and request ID are encoded in the URL; arbitrary search text stays in memory. Captures are not persisted to browser storage. Reloading a link retrieves the current server buffer. Missing selected requests display an explicit unavailable/expired-evidence explanation. A link preserves scope, not an immutable incident snapshot.

## Live and freshness

Live checks the history API every five seconds while the workspace is mounted. New snapshots are buffered: Apply updates the displayed population deliberately, without rows shifting beneath an investigation. Pause stops scheduled checks; an already-started check may finish. Manual Refresh immediately applies the latest snapshot. Neither control affects proxy capture, server metrics, or external alert evaluation.

The workspace reports the displayed snapshot's retrieval time and the last check. API errors preserve the displayed evidence and show Retry. A pending snapshot is bounded by the server history capacity and replaced by each successful check. Requests that arrive and expire between checks cannot be recovered; this is not a lossless event stream.

## Overview populations

Overview groups the same filtered evidence by host and sanitized captured path, not inferred route templates. Investigate carries the scope into Traffic. Time trends use equal buckets across the matching retained window; bucket drill-downs use exact inclusive timestamp bounds. Counts are retained samples, not a complete traffic rate. Empty buckets mean no retained samples, not proven inactivity.

Failure counts include HTTP 4xx/5xx and explicit incomplete outcomes (interruption, client cancellation, inspection rejection, upstream failure, proxy error). Unknown outcomes without an HTTP failure are not inferred to be failures.

Latency is nearest-rank p95 **time to upstream response headers**, with the sample count shown. Tunnels and attempts without upstream responses are excluded. Streaming body lifetime is not included. Request types are not classified: long polling that delays headers can still affect latency, so the UI explicitly discloses this limitation and provides host/path/method scoping. Total duration remains available per request. These statistics are not SLOs, ordinary-request-only percentiles, or process-lifetime metrics.

## Validation

Unit tests verify grouping/drill-down population equality, time-bucket partition boundaries, empty samples, and latency exclusion of tunnels/failed attempts. Existing sanitization and prefix API tests remain in the dashboard safety suite. Browser acceptance includes filtering a host's failures, adjacent inspection, Traffic → Overview → Traffic context preservation, live arrival buffering, explicit missing evidence, and responsive inspection.

Focused alert rules, durable incident snapshots, protocol classification, and capture-to-draft reproduction remain separate roadmap work.
