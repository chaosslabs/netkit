# Focused alerting

Prometheus evaluates rules; Alertmanager groups, silences and delivers notifications. Netkit exports HTTP signals and provides investigation and bounded incident metadata. This example does not configure a real email/chat destination or deploy any service.

## Rules and populations

| Rule | Condition | Gate / hold | Interpretation |
| --- | --- | --- | --- |
| NetkitUpstreamFailureRate | Upstream HTTP 5xx / non-tunnel HTTP observations > 10% over 5m | At least 20 observations; 3m sustained | Does not call 401/429 or inspection rejection an upstream outage. |
| NetkitTransportFailureRate | Proxy errors or upstream connection failures / HTTP observations > 10% over 5m | At least 20 observations; 3m sustained | Client cancellation and inspection rejection are excluded from the numerator. |
| NetkitHeaderLatencyHigh | p95 upstream response-header latency > 1 second over 5m | At least 20 header samples; 5m sustained; **ordinary profile only** | Excludes response body lifetime, tunnels and failed attempts without headers. |
| NetkitUnavailable | External Prometheus scrape `up == 0` | 2m sustained | Reachability, not proof of capture completeness. |
| NetkitInsufficientSamples | Fewer than 20 HTTP observations over 5m | 5m sustained; informational | No data/low volume is unknown, not healthy or a missing-traffic failure. |

Thresholds are examples, not universal defaults. The sample `netkit_latency_profile: unclassified` deliberately disables the latency rule. Enable `ordinary` only on an isolated proxy serving a comparable ordinary HTTP workload. Netkit does not infer request types, dependencies or route templates. Never enable a blanket latency rule for mixed long-polling/streaming traffic. Existing metrics support instance-level scope, not host/route alerts; the UI must not imply otherwise.

Each rule includes a value, threshold, window and investigation link. Static `netkit_dashboard` and `netkit_incidents` external labels must contain public URLs without credentials or query secrets. Set the dashboard URL to include any deployment prefix, without a trailing slash. Metric/alert labels must never contain request URLs, credentials or arbitrary payload fields.

## Local setup

Use Prometheus 3.14.0 and Alertmanager 0.34.1 (the versions validated in CI), plus a current Netkit build. Start Netkit normally with admin port 8081 and dashboard port 3000. Run the incident receiver as a **separate process**, ideally on a different host or failure domain from the monitored proxy in a real deployment.

From this directory:

```sh
umask 077
openssl rand -hex 32 > webhook-token
mkdir -m 700 incidents
NETKIT_ALERT_TOKEN="$(cat webhook-token)" netkit alerts \
  --dir "$PWD/incidents" \
  --listen 127.0.0.1:8090 \
  --admin-url http://127.0.0.1:8081 \
  --dashboard-url http://localhost:3000 \
  --instance netkit-local
```

In separate terminals, from this same directory:

```sh
alertmanager --config.file=alertmanager.yml --storage.path=./alertmanager-data
prometheus --config.file=prometheus.yml --storage.tsdb.path=./prometheus-data
```

The webhook token is mandatory (at least 16 characters), provided only through the receiver environment and Alertmanager's credentials file. Keep it out of Git. The receiver binds loopback by default. Its read-only HTML interface has **no built-in authentication**: use authenticated private ingress before exposing it. The fixed admin URL is trusted configuration; redirects and alert-supplied target URLs are not followed. Keep the existing Netkit admin endpoint private as well.

The example expects one proxy with the safe Prometheus instance alias `netkit-local`. For multiple instances, use one receiver and directory per instance and route Alertmanager by instance; mismatched instances are rejected rather than snapshotting unrelated traffic.

Open Prometheus's Alerts page to see pending/firing evaluation, Alertmanager to manage silences, and `http://localhost:8090/` for received incident evidence. Absence of an incident is not a health signal: pending or silenced alerts may never notify this receiver.

## Notification routing

The supplied receiver writes local evidence only. Add your operator-owned notification integration to the same Alertmanager receiver, using its documented email/chat/webhook schema. For a generic endpoint that accepts Alertmanager's webhook JSON, add another entry under `webhook_configs`:

```yaml
- url: https://notifications.example.invalid/alertmanager
  send_resolved: true
  http_config:
    authorization:
      credentials_file: ./notification-token
```

Replace the `.invalid` placeholder and create the private token file before enabling it. Keep grouping by alertname/job/instance, 30s initial group delay, 5m group interval and 4h repeat interval unless your response policy calls for different values. A NetkitUnavailable alert inhibits the traffic rules for the same job/instance. Alertmanager silences affect both evidence delivery and other integrations; snapshots therefore reflect **delivered notifications**, not an exhaustive incident history. Monitor Prometheus, Alertmanager notification failures, and the receiver independently; Netkit cannot report its own total monitoring-stack failure.

## Evidence contract and retention

`GET /requests/evidence?signal=http5xx|transport|headers&from=<RFC3339>&to=<RFC3339>` is an admin-only metadata boundary. It returns at most 20 matching retained records and the total matching retained count. It excludes URLs, host/path names, headers, bodies and error text entirely. The receiver validates a fixed schema and discards all arbitrary alert annotations/labels, storing only known rule identity, lifecycle timestamps, finite numeric value/threshold and typed evidence.

The first delivered notification snapshots the available evidence from five minutes before condition onset through delivery. This contextual window includes evaluation and pending time; it is not an immutable copy of every metric sample. Later retries and recovery update lifecycle metadata without replacing the initial evidence. An out-of-order firing retry cannot reopen a resolved incident with the same start time. A resolved notification received without an earlier firing delivery is recorded as such, with whatever evidence is available at delivery.

Snapshots are atomic mode-0600 JSON files in a required private mode-0700 directory. Defaults are 100 incidents and seven days, configurable with `--capacity` (1–1000) and `--retention` (1m–30d). TTL is measured from snapshot creation, not renewed on each retry. Pruning runs on reads/writes and once per minute while the process is running; offline expiry is enforced on restart. The receiver never deletes files outside its incident naming convention. Disk errors return non-success so Alertmanager can retry.

Evidence states distinguish captured, no retained matches, unavailable (including failed fetch or invalid schema), and not applicable (availability/insufficient-sample alerts). A snapshot can survive request-history clearing, eviction and proxy/receiver restarts. Incident links return explicit 404/expired state after retention. Investigation links apply the signal and snapshot time bounds to the **current** Traffic buffer; that buffer may no longer contain the saved evidence. Resolved means the alert expression stopped firing, not proof of health—scrape failure and insufficient data have separate signals.

The receiver preserves metadata only. Payload reproduction, durable full traffic storage, per-route metrics, rate-limiting/stream-interruption rules and native monitor editing remain later work.

## Validation

```sh
promtool check config prometheus.yml
promtool check rules rules.yml
promtool test rules rules.test.yml
amtool check-config alertmanager.yml
# From repository root, with real binaries available:
go test -race ./internal/alerting ./internal/proxy
go build -o /tmp/netkit-alert-test ./cmd/netkit
python3 scripts/test-alerting-integration.py \
  --netkit /tmp/netkit-alert-test --alertmanager /path/to/alertmanager
```

Rule tests use synthetic clocks/series to verify brief spikes, sustained failures, sample gates, low/no-data, external downtime/recovery, cancellation/inspection exclusions and latency profile gating. The integration test runs a real Alertmanager and real receiver on disposable loopback ports, verifying grouping, repeat delivery, silence suppression, recovery, deduplication and safe evidence persistence. It sends no external notifications.

A scrape target removed from configuration produces no `up` series; `NetkitUnavailable` monitors configured targets, not inventory deletion. Maintain target inventory and independently monitor the monitoring stack. Missing expected traffic requires an explicit cadence policy and is not inferred from ordinary silence.

References: [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/), [rule unit tests](https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/), [Alertmanager configuration](https://prometheus.io/docs/alerting/latest/configuration/).
