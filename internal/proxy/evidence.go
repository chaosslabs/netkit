package proxy

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/biancarosa/netkit/internal/alerting"
)

// The incident boundary intentionally excludes URLs, headers, bodies and error text.
func (p *Proxy) handleEvidence(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		http.Error(w, "method not allowed", 405)
		return
	}
	from, err1 := time.Parse(time.RFC3339Nano, r.URL.Query().Get("from"))
	to, err2 := time.Parse(time.RFC3339Nano, r.URL.Query().Get("to"))
	signal := r.URL.Query().Get("signal")
	if err1 != nil || err2 != nil || to.Before(from) || (signal != "http5xx" && signal != "transport" && signal != "headers") {
		http.Error(w, "invalid evidence scope", 400)
		return
	}
	records := p.history.GetRecords()
	evidence := make([]alerting.Evidence, 0, 20)
	matching := 0
	for _, record := range records {
		if signal == "headers" && (record.UpstreamStartTime.IsZero() || record.UpstreamEndTime.IsZero() || record.UpstreamEndTime.Before(record.UpstreamStartTime)) {
			continue
		}
		e := alerting.Evidence{ID: record.ID, Timestamp: record.Timestamp, Method: metricMethod(record.Method), Outcome: record.Outcome, Status: record.ResponseStatus, Source: record.ResponseSource, HeadersUS: record.UpstreamLatencyUs, DurationUS: record.TotalDurationUs}
		if e.Valid() && e.Matches(signal) && !e.Timestamp.Before(from) && !e.Timestamp.After(to) {
			matching++
			if len(evidence) < 20 {
				evidence = append(evidence, e)
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(struct {
		Records  []alerting.Evidence `json:"records"`
		Matching int                 `json:"matching_retained"`
	}{evidence, matching})
}
