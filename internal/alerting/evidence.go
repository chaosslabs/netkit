// Package alerting provides an opt-in, separately operated incident receiver.
// Alert evaluation and notification ownership remain in Prometheus/Alertmanager.
package alerting

import (
	"regexp"
	"time"
)

type Evidence struct {
	ID         string    `json:"id"`
	Timestamp  time.Time `json:"timestamp"`
	Method     string    `json:"method"`
	Outcome    string    `json:"outcome"`
	Status     int       `json:"status"`
	Source     string    `json:"source"`
	HeadersUS  int64     `json:"headers_us"`
	DurationUS int64     `json:"duration_us"`
}

var recordID = regexp.MustCompile(`^[a-f0-9]{32}$`)

func (e Evidence) Valid() bool {
	if !recordID.MatchString(e.ID) || e.Timestamp.IsZero() || e.HeadersUS < 0 || e.DurationUS < 0 || e.Status < 0 || e.Status > 599 {
		return false
	}
	switch e.Method {
	case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "OTHER":
	default:
		return false
	}
	switch e.Outcome {
	case "complete", "interrupted", "client_canceled", "blocked_by_inspection", "upstream_error", "proxy_error", "tunnel_only", "unknown":
	default:
		return false
	}
	return e.Source == "upstream" || e.Source == "proxy" || e.Source == "unknown"
}
func (e Evidence) Matches(signal string) bool {
	switch signal {
	case "http5xx":
		return e.Source == "upstream" && e.Status >= 500 && e.Status <= 599
	case "transport":
		return e.Outcome == "upstream_error" || e.Outcome == "proxy_error"
	case "headers":
		return e.Source == "upstream" && e.Status > 0 && e.Method != "CONNECT"
	default:
		return false
	}
}
