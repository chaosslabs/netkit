import type { BackendRequestRecord as Record } from "../services/api";
export type Scope = {
  host: string;
  route: string;
  method: string;
  outcome: string;
  from: string;
  to: string;
};
export const emptyScope: Scope = {
  host: "",
  route: "",
  method: "",
  outcome: "",
  from: "",
  to: "",
};
export function endpoint(record: Record) {
  try {
    const url = new URL(record.url);
    return { host: url.host, route: url.pathname };
  } catch {
    return {
      host: record.method === "CONNECT" ? record.url : "Unknown",
      route: record.method === "CONNECT" ? "(tunnel)" : "(unavailable)",
    };
  }
}
export function failed(record: Record) {
  return (
    record.response_status >= 400 ||
    [
      "interrupted",
      "client_canceled",
      "blocked_by_inspection",
      "upstream_error",
      "proxy_error",
    ].includes(record.outcome)
  );
}
export function matches(record: Record, scope: Scope) {
  const target = endpoint(record);
  const time = Date.parse(record.timestamp);
  return (
    (!scope.host || scope.host === target.host) &&
    (!scope.route || scope.route === target.route) &&
    (!scope.method || scope.method === record.method) &&
    (!scope.outcome ||
      (scope.outcome === "failures"
        ? failed(record)
        : record.outcome === scope.outcome)) &&
    (!scope.from || time >= Date.parse(scope.from)) &&
    (!scope.to || time <= Date.parse(scope.to))
  );
}
export function headersEligible(record: Record) {
  return (
    record.response_source === "upstream" &&
    record.response_status > 0 &&
    record.method !== "CONNECT" &&
    record.upstream_latency_us >= 0
  );
}
export function percentile(values: number[], fraction = 0.95) {
  return values.length
    ? [...values].sort((a, b) => a - b)[
        Math.max(0, Math.ceil(values.length * fraction) - 1)
      ]
    : null;
}
export function summary(records: Record[]) {
  const eligible = records.filter(headersEligible);
  return {
    count: records.length,
    failures: records.filter(failed).length,
    p95: percentile(eligible.map((r) => r.upstream_latency_us)),
    latencyCount: eligible.length,
  };
}
export function groups(records: Record[]) {
  const map = new Map<
    string,
    { host: string; route: string; records: Record[] }
  >();
  for (const record of records) {
    const target = endpoint(record);
    const key = JSON.stringify(target);
    const group = map.get(key) || { ...target, records: [] };
    group.records.push(record);
    map.set(key, group);
  }
  return [...map.values()].sort((a, b) => b.records.length - a.records.length);
}
// Explicit bucket bounds are also the drill-down bounds, including the last millisecond.
export function buckets(records: Record[], count = 8) {
  if (!records.length) return [];
  const times = records.map((r) => Date.parse(r.timestamp));
  const start = Math.min(...times);
  const end = Math.max(...times);
  const width = Math.max(1, Math.ceil((end - start + 1) / count));
  return Array.from({ length: Math.min(count, end - start + 1) }, (_, i) => {
    const from = new Date(start + i * width).toISOString();
    const to = new Date(start + (i + 1) * width - 1).toISOString();
    return {
      from,
      to,
      ...summary(
        records.filter((r) => matches(r, { ...emptyScope, from, to })),
      ),
    };
  });
}
export function duration(us: number | null) {
  return us === null
    ? "—"
    : us < 1000
      ? `${Math.round(us)} μs`
      : us < 1e6
        ? `${(us / 1000).toFixed(1)} ms`
        : `${(us / 1e6).toFixed(2)} s`;
}
