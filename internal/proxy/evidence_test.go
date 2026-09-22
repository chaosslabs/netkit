package proxy

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/biancarosa/netkit/internal/alerting"
)

func TestEvidenceIsBoundedMetadataWithExactScope(t *testing.T) {
	p := New(&Config{HistorySize: 100})
	now := time.Now().UTC()
	for i := 0; i < 25; i++ {
		p.history.AddRecord(RequestRecord{ID: strings.Repeat("a", 32), Timestamp: now, Method: "GET", URL: "http://example.test/token/fixture-secret", RequestBody: "fixture-secret", ResponseBody: "fixture-secret", RequestHeaders: map[string]string{"Authorization": "fixture-secret"}, ResponseStatus: 503, ResponseSource: "upstream", Outcome: "complete", ProxyStartTime: now, ProxyEndTime: now.Add(time.Millisecond)})
	}
	p.history.AddRecord(RequestRecord{ID: strings.Repeat("b", 32), Timestamp: now, Method: "GET", ResponseStatus: 200, ResponseSource: "upstream", Outcome: "complete"})
	req := httptest.NewRequest("GET", "/requests/evidence?signal=http5xx&from="+now.Add(-time.Minute).Format(time.RFC3339Nano)+"&to="+now.Add(time.Minute).Format(time.RFC3339Nano), nil)
	w := httptest.NewRecorder()
	p.handleEvidence(w, req)
	if w.Code != 200 || strings.Contains(w.Body.String(), "fixture-secret") || strings.Contains(w.Body.String(), "request_body") {
		t.Fatal(w.Code, w.Body.String())
	}
	var data struct {
		Records  []alerting.Evidence `json:"records"`
		Matching int                 `json:"matching_retained"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Records) != 20 || data.Matching != 25 {
		t.Fatal(len(data.Records), data.Matching)
	}
	for _, e := range data.Records {
		if !e.Valid() || !e.Matches("http5xx") {
			t.Fatal(e)
		}
	}
	for _, method := range []string{"GET", "POST"} {
		w = httptest.NewRecorder()
		p.handleEvidence(w, httptest.NewRequest(method, "/requests/evidence", nil))
		if w.Code == 200 {
			t.Fatal("invalid request accepted")
		}
	}
}

func TestHeaderEvidenceRequiresObservedPhase(t *testing.T) {
	p := New(&Config{HistorySize: 10})
	now := time.Now().UTC()
	for _, observed := range []bool{false, true} {
		record := RequestRecord{ID: strings.Repeat("c", 32), Timestamp: now, Method: "GET", ResponseStatus: 200, ResponseSource: "upstream", Outcome: "complete"}
		if observed {
			record.UpstreamStartTime = now
			record.UpstreamEndTime = now.Add(time.Millisecond)
		}
		p.history.AddRecord(record)
	}
	w := httptest.NewRecorder()
	p.handleEvidence(w, httptest.NewRequest("GET", "/requests/evidence?signal=headers&from="+now.Add(-time.Minute).Format(time.RFC3339Nano)+"&to="+now.Add(time.Minute).Format(time.RFC3339Nano), nil))
	var data struct {
		Records  []alerting.Evidence `json:"records"`
		Matching int                 `json:"matching_retained"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || data.Matching != 1 || len(data.Records) != 1 {
		t.Fatal(w.Code, w.Body.String())
	}
}
