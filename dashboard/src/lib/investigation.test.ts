import assert from "node:assert/strict";
import { test } from "node:test";
import type { BackendRequestRecord } from "../services/api";
import {
  buckets,
  emptyScope,
  failed,
  groups,
  matches,
  summary,
} from "./investigation";
const record = (
  id: string,
  overrides: Partial<BackendRequestRecord> = {},
): BackendRequestRecord =>
  ({
    id,
    timestamp: "2026-09-22T12:00:00Z",
    method: "GET",
    url: "https://example.test/api/tasks?token=%5BREDACTED%5D",
    response_status: 200,
    outcome: "complete",
    success: true,
    response_source: "upstream",
    upstream_start_time: "2026-09-22T12:00:00Z",
    upstream_end_time: "2026-09-22T12:00:00.001Z",
    upstream_latency_us: 1000,
    total_duration_us: 30000000,
    ...overrides,
  }) as BackendRequestRecord;

test("latency excludes opaque tunnels and failed attempts; streaming lifetime does not become header latency", () => {
  const stats = summary([
    record("stream"),
    record("tunnel", {
      method: "CONNECT",
      response_source: "proxy",
      upstream_latency_us: 0,
      outcome: "tunnel_only",
    }),
    record("failed", {
      outcome: "upstream_error",
      response_source: "proxy",
      response_status: 502,
      upstream_latency_us: 999999,
    }),
  ]);
  assert.equal(stats.p95, 1000);
  assert.equal(stats.latencyCount, 1);
  assert.equal(stats.failures, 1);
  assert.equal(
    failed(
      record("unknown", {
        outcome: "unknown",
        success: false,
        response_status: 0,
      }),
    ),
    false,
  );
  assert.equal(
    failed(record("partial", { outcome: "interrupted", success: false })),
    true,
  );
  assert.equal(failed(record("401", { response_status: 401 })), true);
});
test("host and path groups drill into exactly their captured population without query values", () => {
  const records = [
    record("1"),
    record("2", { url: "https://example.test/api/tasks?different=yes" }),
    record("3", { url: "https://other.test/api/tasks" }),
  ];
  for (const group of groups(records))
    assert.deepEqual(
      records
        .filter((r) =>
          matches(r, { ...emptyScope, host: group.host, route: group.route }),
        )
        .map((r) => r.id),
      group.records.map((r) => r.id),
    );
  assert.equal(groups(records).length, 2);
});
test("trend bucket boundaries partition records exactly and produce matching drill-down counts", () => {
  const records = Array.from({ length: 17 }, (_, i) =>
    record(String(i), {
      timestamp: new Date(Date.UTC(2026, 8, 22, 12, 0, 0, i)).toISOString(),
      response_status: i % 3 ? 200 : 500,
    }),
  );
  const trend = buckets(records);
  assert.equal(
    trend.reduce((n, b) => n + b.count, 0),
    records.length,
  );
  for (const bucket of trend) {
    const evidence = records.filter((r) =>
      matches(r, { ...emptyScope, from: bucket.from, to: bucket.to }),
    );
    assert.equal(evidence.length, bucket.count);
    assert.equal(evidence.filter(failed).length, bucket.failures);
  }
  assert.equal(buckets([record("a"), record("b")]).length, 1);
  assert.equal(summary([]).p95, null);
});

test("alert links use exact signal populations and exclude unrelated failures", () => {
  const records = [
    record("http5xx", { response_status: 503 }),
    record("401", { response_status: 401 }),
    record("transport", {
      outcome: "upstream_error",
      response_status: 502,
      response_source: "proxy",
    }),
    record("canceled", {
      outcome: "client_canceled",
      response_status: 0,
      response_source: "proxy",
    }),
  ];
  assert.deepEqual(
    records
      .filter((r) => matches(r, { ...emptyScope, signal: "http5xx" }))
      .map((r) => r.id),
    ["http5xx"],
  );
  assert.deepEqual(
    records
      .filter((r) => matches(r, { ...emptyScope, signal: "transport" }))
      .map((r) => r.id),
    ["transport"],
  );
  assert.deepEqual(
    records
      .filter((r) => matches(r, { ...emptyScope, signal: "headers" }))
      .map((r) => r.id),
    ["http5xx", "401"],
  );
  assert.equal(
    records.filter((r) => matches(r, { ...emptyScope, signal: "unknown" }))
      .length,
    0,
  );
});
