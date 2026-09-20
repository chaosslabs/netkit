package proxy

import (
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"sort"
	"strings"
	"time"
)

func outcomeDescription(outcome string) string {
	switch outcome {
	case "interrupted":
		return "Response transfer interrupted; HTTP status may already have been received"
	case "client_canceled":
		return "Client canceled the exchange"
	case "blocked_by_inspection":
		return "Protocol upgrades are not supported in inspection mode"
	case "upstream_error":
		return "Upstream connection or request failed"
	case "proxy_error":
		return "Proxy could not process the request"
	default:
		return "Exchange did not complete"
	}
}

func elapsedUS(start, end time.Time) int64 {
	if start.IsZero() || end.IsZero() || end.Before(start) {
		return 0
	}
	return end.Sub(start).Microseconds()
}

func normalizeRecord(r *RequestRecord) {
	r.TotalDurationUs = elapsedUS(r.ProxyStartTime, r.ProxyEndTime)
	r.UpstreamLatencyUs = elapsedUS(r.UpstreamStartTime, r.UpstreamEndTime)
	r.ProxyOverheadUs = max(int64(0), r.TotalDurationUs-r.UpstreamLatencyUs)
	if r.ResponseSource == "" && r.ResponseStatus != 0 {
		r.ResponseSource = "upstream"
	}
	if r.Outcome == "" {
		switch {
		case r.Method == "CONNECT" && r.Success:
			r.Outcome = "tunnel_only"
		case r.Success:
			r.Outcome = "complete"
		default:
			r.Outcome = "proxy_error"
		}
	}
	switch r.Outcome {
	case "complete", "tunnel_only", "interrupted", "client_canceled", "blocked_by_inspection", "upstream_error", "proxy_error":
	default:
		r.Outcome = "unknown"
	}
	r.Success = r.Outcome == "complete" || r.Outcome == "tunnel_only"
}

// No user-controlled values (host, route, IDs, URLs) become metric labels.
func metricMethod(method string) string {
	switch method {
	case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT":
		return method
	}
	return "OTHER"
}
func statusClass(r RequestRecord) string {
	if r.ResponseSource != "upstream" || r.ResponseStatus < 100 || r.ResponseStatus > 599 {
		return "none"
	}
	return fmt.Sprintf("%dxx", r.ResponseStatus/100)
}

var durationBounds = []float64{.001, .005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10, 30, 60}

type signalSeries struct {
	HeaderCount   uint64
	HeaderSum     float64
	HeaderBuckets [14]uint64
	Count         uint64
	Sum           float64
	Buckets       [14]uint64
}

func (h *RequestHistory) observe(r RequestRecord) {
	labels := fmt.Sprintf(`method=%q,outcome=%q,http_status_class=%q`, metricMethod(r.Method), r.Outcome, statusClass(r))
	series := h.signals[labels]
	if series == nil {
		series = &signalSeries{}
		h.signals[labels] = series
	}
	series.Count++
	seconds := float64(r.TotalDurationUs) / 1e6
	series.Sum += seconds
	for i, bound := range durationBounds {
		if seconds <= bound {
			series.Buckets[i]++
		}
	}
	if r.ResponseSource == "upstream" && !r.UpstreamStartTime.IsZero() && !r.UpstreamEndTime.IsZero() {
		seconds := float64(r.UpstreamLatencyUs) / 1e6
		series.HeaderCount++
		series.HeaderSum += seconds
		for i, bound := range durationBounds {
			if seconds <= bound {
				series.HeaderBuckets[i]++
			}
		}
	}
	h.observed++
}

// Metrics is cumulative since process start. Clear/eviction affect only history.
func (h *RequestHistory) Metrics() string {
	h.mutex.RLock()
	defer h.mutex.RUnlock()
	var out strings.Builder
	fmt.Fprintf(&out, "# HELP netkit_requests_total Completed observations since process start (includes failed exchanges and tunnel establishment).\n# TYPE netkit_requests_total counter\nnetkit_requests_total %d\n", h.observed)
	out.WriteString("# HELP netkit_exchanges_total Observations by bounded method, outcome, and upstream HTTP status class.\n# TYPE netkit_exchanges_total counter\n")
	keys := make([]string, 0, len(h.signals))
	for key := range h.signals {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		fmt.Fprintf(&out, "netkit_exchanges_total{%s} %d\n", key, h.signals[key].Count)
	}
	out.WriteString("# HELP netkit_exchange_duration_seconds Handler lifetime; CONNECT measures tunnel establishment, not encrypted requests. Includes streaming and polling lifetime.\n# TYPE netkit_exchange_duration_seconds histogram\n")
	for _, key := range keys {
		series := h.signals[key]
		for i, bound := range durationBounds {
			fmt.Fprintf(&out, "netkit_exchange_duration_seconds_bucket{%s,le=%q} %d\n", key, fmt.Sprint(bound), series.Buckets[i])
		}
		fmt.Fprintf(&out, "netkit_exchange_duration_seconds_bucket{%s,le=\"+Inf\"} %d\nnetkit_exchange_duration_seconds_sum{%s} %g\nnetkit_exchange_duration_seconds_count{%s} %d\n", key, series.Count, key, series.Sum, key, series.Count)
	}
	out.WriteString("# HELP netkit_response_headers_seconds Time from dispatch to upstream response headers; excludes failed attempts and opaque tunnels.\n# TYPE netkit_response_headers_seconds histogram\n")
	for _, key := range keys {
		series := h.signals[key]
		if series.HeaderCount == 0 {
			continue
		}
		for i, bound := range durationBounds {
			fmt.Fprintf(&out, "netkit_response_headers_seconds_bucket{%s,le=%q} %d\n", key, fmt.Sprint(bound), series.HeaderBuckets[i])
		}
		fmt.Fprintf(&out, "netkit_response_headers_seconds_bucket{%s,le=\"+Inf\"} %d\nnetkit_response_headers_seconds_sum{%s} %g\nnetkit_response_headers_seconds_count{%s} %d\n", key, series.HeaderCount, key, series.HeaderSum, key, series.HeaderCount)
	}
	fmt.Fprintf(&out, "# HELP netkit_history_records Retained records (not a lifetime counter).\n# TYPE netkit_history_records gauge\nnetkit_history_records %d\n", len(h.records))
	return out.String()
}

// Keep an actionable, bounded reason without retaining errors containing raw URLs.
func failureReason(err error) string {
	var cert x509.UnknownAuthorityError
	var host x509.HostnameError
	var invalid x509.CertificateInvalidError
	if errors.As(err, &cert) || errors.As(err, &host) || errors.As(err, &invalid) {
		return "tls_certificate"
	}
	var timeout net.Error
	if errors.As(err, &timeout) && timeout.Timeout() {
		return "timeout"
	}
	return "connection"
}
