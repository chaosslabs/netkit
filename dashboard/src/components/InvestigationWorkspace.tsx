"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiService, type BackendRequestRecord } from "../services/api";
import { useInvestigation } from "../hooks/useInvestigation";
import {
  buckets,
  duration,
  emptyScope,
  endpoint,
  groups,
  matches,
  summary,
  type Scope,
} from "../lib/investigation";
import { outcomeLabel } from "../lib/inspection";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { CaptureNotice } from "./CaptureNotice";

const control = "h-9 min-w-0 rounded-md border bg-background px-2 text-sm";
export function InvestigationWorkspace({
  overview = false,
}: {
  overview?: boolean;
}) {
  const state = useInvestigation();
  const [overviewMode, setOverviewMode] = useState(overview);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const busy = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  useEffect(() => {
    if (state.selected && !overviewMode) panelRef.current?.focus();
  }, [state.selected, overviewMode]);
  const [panelWidth, setPanelWidth] = useState(40);
  const fetchRecords = useCallback(async (apply = false) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const records = await apiService.getRequestHistory();
      const current = useInvestigation.getState();
      // Do not move rows beneath an active investigation. Applying arrivals is deliberate.
      setCheckedAt(new Date());
      const changed =
        records.length !== current.records.length ||
        records.some((r, i) => r.id !== current.records[i]?.id);
      current.set(
        apply || !current.lastRefresh
          ? { records, pending: null, lastRefresh: new Date() }
          : { pending: changed ? records : null, pendingAt: new Date() },
      );
      setError(false);
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(window.location.search);
      setOverviewMode(
        window.location.pathname
          .replace(/\/$/, "")
          .endsWith("/requests-statistics"),
      );
      const scope = { ...emptyScope };
      for (const key of Object.keys(scope) as (keyof Scope)[])
        scope[key] = (params.get(key) || "").slice(0, 2048);
      for (const key of ["from", "to"] as const) {
        if (scope[key])
          scope[key] = Number.isFinite(Date.parse(scope[key]))
            ? new Date(scope[key]).toISOString()
            : "";
      }
      useInvestigation
        .getState()
        .set({ scope, selected: params.get("request") || "" });
    };
    read();
    setReady(true);
    void fetchRecords(!useInvestigation.getState().lastRefresh);
    window.addEventListener("popstate", read);
    window.addEventListener("netkit-navigation", read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener("netkit-navigation", read);
    };
  }, [fetchRecords]);
  useEffect(() => {
    if (!state.live) return;
    const id = setInterval(() => void fetchRecords(), 5000);
    return () => clearInterval(id);
  }, [state.live, fetchRecords]);
  // Only structured filters from sanitized captures enter the URL. Free text stays in memory.
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(state.scope))
      if (value) params.set(key, value);
    if (state.selected) params.set("request", state.selected);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${params.size ? `?${params}` : ""}`,
    );
  }, [ready, state.scope, state.selected]);
  const scoped = useMemo(
    () => state.records.filter((r) => matches(r, state.scope)),
    [state.records, state.scope],
  );
  const visible = useMemo(
    () =>
      scoped.filter((r) =>
        `${r.method} ${r.url}`
          .toLowerCase()
          .includes(state.search.toLowerCase()),
      ),
    [scoped, state.search],
  );
  const metrics = summary(visible);
  const selected = state.records.find((r) => r.id === state.selected);
  const selectedIndex = visible.findIndex((r) => r.id === state.selected);
  const pendingCount =
    state.pending?.filter((r) => !state.records.some((old) => old.id === r.id))
      .length || 0;
  const setScope = (patch: Partial<Scope>) =>
    state.set({ scope: { ...state.scope, ...patch } });
  const drill = (patch: Partial<Scope>) => {
    state.set({ scope: { ...state.scope, ...patch }, selected: "" });
    setOverviewMode(false);
    const path = window.location.pathname.replace(
      /\/requests-statistics\/?$/,
      "/",
    );
    window.history.pushState(window.history.state, "", path);
  };
  const select = (request: BackendRequestRecord) =>
    state.set({ selected: request.id });
  const hosts = [...new Set(state.records.map((r) => endpoint(r).host))].sort();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {overviewMode ? "Overview" : "Traffic"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Retained evidence · {state.records.length} records
            {state.lastRefresh
              ? ` · applied ${state.lastRefresh.toLocaleTimeString()}`
              : " · not loaded"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/compose" className="rounded-md border px-3 py-2 text-sm">
            Compose
          </Link>
          <Button
            variant="outline"
            aria-pressed={state.live}
            onClick={() => state.set({ live: !state.live })}
          >
            {state.live ? "Pause" : "Live"}
          </Button>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void fetchRecords(true)}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>
      {error && (
        <CaptureNotice
          lastRefresh={state.lastRefresh}
          loading={loading}
          onRetry={() => void fetchRecords(true)}
        />
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          {state.live
            ? "Live · checks every 5s; arrivals buffered"
            : "Paused · manual refresh"}
        </span>
        {state.pending && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              state.set({
                records: state.pending!,
                pending: null,
                lastRefresh: state.pendingAt,
              })
            }
          >
            {pendingCount
              ? `${pendingCount} new request${pendingCount === 1 ? "" : "s"} · Apply`
              : "Apply latest snapshot"}
          </Button>
        )}
        <span>
          {checkedAt ? `Last checked ${checkedAt.toLocaleTimeString()}. ` : ""}
          Only retained records contribute; eviction and restart limit the
          evidence.
        </span>
      </div>
      {state.records.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Captured window:{" "}
          {new Date(
            Math.min(...state.records.map((r) => Date.parse(r.timestamp))),
          ).toLocaleString()}{" "}
          –{" "}
          {new Date(
            Math.max(...state.records.map((r) => Date.parse(r.timestamp))),
          ).toLocaleString()}
        </p>
      )}
      <section
        aria-label="Traffic filters"
        className="flex flex-wrap gap-2 rounded-lg border bg-muted/20 p-3"
      >
        <Input
          aria-label="Search captured URLs"
          placeholder="Search captured URLs…"
          value={state.search}
          onChange={(e) => state.set({ search: e.target.value })}
          className="w-full sm:w-60"
        />
        <select
          aria-label="Host"
          className={control}
          value={state.scope.host}
          onChange={(e) => setScope({ host: e.target.value, route: "" })}
        >
          <option value="">All hosts</option>
          {hosts.map((host) => (
            <option key={host}>{host}</option>
          ))}
          {state.scope.host && !hosts.includes(state.scope.host) && (
            <option>{state.scope.host}</option>
          )}
        </select>
        <select
          aria-label="Method"
          className={control}
          value={state.scope.method}
          onChange={(e) => setScope({ method: e.target.value })}
        >
          <option value="">All methods</option>
          {[
            ...new Set(
              state.records
                .map((r) => r.method)
                .concat(state.scope.method ? [state.scope.method] : []),
            ),
          ]
            .sort()
            .map((method) => (
              <option key={method}>{method}</option>
            ))}
        </select>
        <select
          aria-label="Outcome"
          className={control}
          value={state.scope.outcome}
          onChange={(e) => setScope({ outcome: e.target.value })}
        >
          <option value="">All outcomes</option>
          <option value="failures">HTTP or transfer failures</option>
          {[
            "complete",
            "interrupted",
            "client_canceled",
            "blocked_by_inspection",
            "upstream_error",
            "proxy_error",
            "tunnel_only",
            "unknown",
          ].map((outcome) => (
            <option key={outcome} value={outcome}>
              {outcome.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => state.set({ scope: { ...emptyScope }, search: "" })}
        >
          Clear filters
        </Button>
        {(state.scope.route || state.scope.from || state.scope.to) && (
          <p className="w-full break-all text-xs">
            {state.scope.route && `Route: ${state.scope.route} · `}
            {state.scope.from &&
              `From ${new Date(state.scope.from).toLocaleString()} `}
            {state.scope.to &&
              `to ${new Date(state.scope.to).toLocaleString()}`}{" "}
            <button
              className="underline"
              onClick={() => setScope({ route: "", from: "", to: "" })}
            >
              Remove route/time scope
            </button>
          </p>
        )}
        <details className="w-full text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Time range (UTC)
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["from", "to"] as const).map((key) => (
              <label key={key} className="flex items-center gap-2">
                {key === "from" ? "From" : "To"}
                <input
                  type="datetime-local"
                  className={control}
                  value={state.scope[key].slice(0, 16)}
                  onChange={(e) =>
                    setScope({
                      [key]: e.target.value
                        ? new Date(e.target.value + "Z").toISOString()
                        : "",
                    })
                  }
                />
              </label>
            ))}
          </div>
        </details>
      </section>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric
          label="Matching requests"
          value={state.lastRefresh ? String(metrics.count) : "—"}
        />
        <button
          className="text-left"
          onClick={() =>
            overviewMode
              ? drill({ outcome: "failures" })
              : setScope({ outcome: "failures" })
          }
        >
          <Metric
            label="HTTP or transfer failures"
            value={
              state.lastRefresh ? `${metrics.failures} / ${metrics.count}` : "—"
            }
          />
        </button>
        <Metric label="p95 time to headers" value={duration(metrics.p95)} />
        <Metric
          label="Latency sample count"
          value={state.lastRefresh ? String(metrics.latencyCount) : "—"}
        />
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          Latency scope: unclassified request types · retained evidence only
        </summary>{" "}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Latency covers upstream HTTP responses only, excluding tunnels and
          attempts without a response. Request types are not classified: delayed
          headers from long polling can affect this population. Filter to a
          comparable host, route and method. Total duration includes streaming
          and is available in request details. Free-text search is kept in this
          tab, not shared in links.
        </p>
      </details>
      {overviewMode ? (
        <>
          <section className="rounded-lg border">
            <h2 className="p-4 font-semibold">Host and route breakdown</h2>
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    {[
                      "Host / captured path",
                      "Requests",
                      "Failures",
                      "p95 headers",
                      "Evidence",
                    ].map((h) => (
                      <th className="p-3" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups(visible).map((group) => {
                    const stats = summary(group.records);
                    return (
                      <tr
                        key={JSON.stringify([group.host, group.route])}
                        className="border-t"
                      >
                        <td className="p-3">
                          <div>{group.host}</div>
                          <div className="max-w-md break-all font-mono text-xs text-muted-foreground">
                            {group.route}
                          </div>
                        </td>
                        <td className="p-3">{stats.count}</td>
                        <td className="p-3">{stats.failures}</td>
                        <td className="p-3">
                          {duration(stats.p95)}
                          <span className="block text-xs text-muted-foreground">
                            n={stats.latencyCount}
                          </span>
                        </td>
                        <td className="p-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              drill({ host: group.host, route: group.route })
                            }
                          >
                            Investigate
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="p-4 text-xs text-muted-foreground">
              Paths are sanitized captured paths, not inferred route templates.
            </p>
          </section>
          <section className="rounded-lg border">
            <h2 className="p-4 font-semibold">
              Trend across matching evidence
            </h2>
            <p className="px-4 pb-3 text-xs text-muted-foreground">
              Equal time buckets across retained matches. Counts are observed
              records, not a complete traffic rate. An empty bucket does not
              prove no traffic occurred.
            </p>
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    {[
                      "Window start",
                      "Requests",
                      "Failure share",
                      "p95 headers",
                      "Evidence",
                    ].map((h) => (
                      <th key={h} className="p-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {buckets(visible).map((bucket) => (
                    <tr key={bucket.from} className="border-t">
                      <td
                        className="p-3"
                        title={`${bucket.from} – ${bucket.to}`}
                      >
                        {new Date(bucket.from).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          fractionalSecondDigits: 3,
                        })}
                      </td>
                      <td className="p-3">
                        <span
                          className="inline-block h-2 rounded bg-slate-500"
                          style={{
                            width: `${Math.max(0, (bucket.count / Math.max(1, metrics.count)) * 100)}px`,
                          }}
                        />{" "}
                        {bucket.count}
                      </td>
                      <td className="p-3">
                        {bucket.count
                          ? `${((bucket.failures / bucket.count) * 100).toFixed(0)}% (${bucket.failures}/${bucket.count})`
                          : "No samples"}
                      </td>
                      <td className="p-3">
                        {duration(bucket.p95)}{" "}
                        <span className="text-xs text-muted-foreground">
                          n={bucket.latencyCount}
                        </span>
                      </td>
                      <td className="p-3">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!bucket.count}
                          onClick={() =>
                            drill({ from: bucket.from, to: bucket.to })
                          }
                        >
                          Investigate
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <section
            className={`${state.selected ? "hidden lg:block" : ""} min-w-0 flex-1 rounded-lg border`}
            ref={resultsRef}
            tabIndex={-1}
            aria-label="Captured traffic"
          >
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    {[
                      "Time",
                      "Method / endpoint",
                      "HTTP / outcome",
                      "Duration",
                      "Bytes",
                    ].map((h) => (
                      <th key={h} className="whitespace-nowrap p-3 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((record) => {
                    const target = endpoint(record);
                    return (
                      <tr
                        key={record.id}
                        className={`border-t ${record.id === state.selected ? "bg-muted" : "hover:bg-muted/40"}`}
                      >
                        <td className="whitespace-nowrap p-3 text-xs tabular-nums">
                          {new Date(record.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() => select(record)}
                            className="max-w-md text-left focus-visible:outline-2 focus-visible:outline-offset-4"
                          >
                            <span className="mr-2 font-mono text-xs">
                              {record.method}
                            </span>
                            <span className="font-medium">{target.host}</span>
                            <span className="mt-1 block break-all font-mono text-xs text-muted-foreground">
                              {target.route}
                            </span>
                            <span className="sr-only">Inspect request</span>
                          </button>
                        </td>
                        <td className="p-3">
                          <span
                            className={
                              record.response_status >= 400
                                ? "font-semibold text-amber-700"
                                : "font-medium"
                            }
                          >
                            {record.response_status || "—"}
                          </span>
                          <span className="block whitespace-nowrap text-xs">
                            {outcomeLabel(record)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap p-3 tabular-nums">
                          {duration(record.total_duration_us)}
                        </td>
                        <td className="p-3 tabular-nums">
                          {(
                            record.request_size + record.response_size
                          ).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          {state.selected && (
            <aside
              ref={panelRef}
              tabIndex={-1}
              aria-label="Request inspection"
              className="w-full min-w-0 rounded-lg border lg:w-[var(--panel-width)]"
              style={
                { "--panel-width": `${panelWidth}%` } as React.CSSProperties
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    state.set({ selected: "" });
                    requestAnimationFrame(() => resultsRef.current?.focus());
                  }}
                >
                  Back to results
                </Button>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedIndex <= 0}
                    onClick={() => select(visible[selectedIndex - 1])}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      selectedIndex < 0 || selectedIndex >= visible.length - 1
                    }
                    onClick={() => select(visible[selectedIndex + 1])}
                  >
                    Next
                  </Button>
                </div>
                <label className="hidden items-center gap-2 text-xs lg:flex">
                  Panel width
                  <input
                    aria-label="Inspection panel width"
                    type="range"
                    min="30"
                    max="65"
                    value={panelWidth}
                    onChange={(e) => setPanelWidth(Number(e.target.value))}
                  />
                </label>
              </div>
              {selected && selectedIndex < 0 && (
                <p className="border-b p-3 text-xs text-muted-foreground">
                  Selected request is outside the current filters. Clear filters
                  to navigate adjacent requests.
                </p>
              )}
              {!state.lastRefresh ? (
                <p className="p-6 text-sm text-muted-foreground">
                  {loading
                    ? "Loading selected request…"
                    : "Request evidence unavailable. Retry the connection."}
                </p>
              ) : selected ? (
                <Inspection key={selected.id} record={selected} />
              ) : (
                <div className="p-6">
                  <h2 className="font-semibold">Request no longer retained</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    This request is absent from the loaded evidence. It may have
                    expired, been cleared, or belonged to an earlier process.
                    Refresh to check the current buffer; your filters are
                    preserved.
                  </p>
                </div>
              )}
            </aside>
          )}
        </div>
      )}
      {!visible.length && (
        <div role="status" className="rounded-lg border p-10 text-center">
          <h2 className="font-medium">
            {!state.lastRefresh
              ? loading
                ? "Loading captured traffic…"
                : "Capture data unavailable"
              : state.records.length
                ? "No requests match this view"
                : "No captured requests yet"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {state.records.length
              ? "Adjust the filters or refresh the retained evidence."
              : "Send traffic through the proxy, then refresh."}
          </p>
        </div>
      )}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="h-full rounded-lg border px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
function Inspection({ record }: { record: BackendRequestRecord }) {
  const [feedback, setFeedback] = useState("");
  const target = endpoint(record);
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback("Copied sanitized content");
    } catch {
      setFeedback("Copy unavailable");
    }
  };
  return (
    <div className="max-h-[75vh] overflow-auto p-4">
      <h2 className="break-all font-medium">
        {record.method} {target.host}
        <span className="mt-1 block font-mono text-xs text-muted-foreground">
          {target.route}
        </span>
      </h2>
      <p className="mt-3 text-sm font-semibold">
        {record.response_status ? `HTTP ${record.response_status} · ` : ""}
        {outcomeLabel(record)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {new Date(record.timestamp).toLocaleString()} · response from{" "}
        {record.response_source || "unknown"}
      </p>
      {record.error && (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          {record.error}
          {record.failure_reason
            ? ` (${record.failure_reason.replaceAll("_", " ")})`
            : ""}
        </p>
      )}
      <div className="my-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void copy(record.url)}
        >
          Copy sanitized URL
        </Button>
        <span role="status" className="text-xs">
          {feedback}
        </span>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Values masked by capture policy. Omitted bodies cannot be recovered.
      </p>
      <Tabs defaultValue="response">
        <TabsList>
          <TabsTrigger value="request">Request</TabsTrigger>
          <TabsTrigger value="response">Response</TabsTrigger>
          <TabsTrigger value="timing">Timing</TabsTrigger>
        </TabsList>
        {(["request", "response"] as const).map((side) => (
          <TabsContent key={side} value={side} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Headers</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void copy(JSON.stringify(record[`${side}_headers`], null, 2))
                }
              >
                Copy {side} headers
              </Button>
            </div>
            <pre className="whitespace-pre-wrap break-all rounded bg-muted/40 p-3 text-xs leading-relaxed">
              {JSON.stringify(record[`${side}_headers`], null, 2)}
            </pre>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Body</h3>
              <Button
                variant="ghost"
                size="sm"
                disabled={!record[`${side}_body`]}
                onClick={() => void copy(record[`${side}_body`] || "")}
              >
                Copy {side} body
              </Button>
            </div>
            <pre className="whitespace-pre-wrap break-all rounded bg-muted/40 p-3 text-xs leading-relaxed">
              {record[`${side}_body`] || "No body captured"}
            </pre>
          </TabsContent>
        ))}
        <TabsContent value="timing">
          <dl className="space-y-3 py-3 text-sm">
            {[
              ["Total exchange", duration(record.total_duration_us)],
              [
                "Time to response headers",
                record.response_source === "upstream"
                  ? duration(record.upstream_latency_us)
                  : "Not observed",
              ],
              ["Other elapsed time", duration(record.proxy_overhead_us)],
              ["Request bytes", String(record.request_size)],
              ["Response bytes", String(record.response_size)],
            ].map(([key, value]) => (
              <div key={key} className="flex justify-between gap-2">
                <dt>{key}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            Total duration includes body transfer and streaming lifetime. Other
            elapsed time is not CPU overhead. CONNECT records describe tunnel
            establishment only.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
