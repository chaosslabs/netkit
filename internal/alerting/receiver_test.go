package alerting

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const testToken = "synthetic-webhook-token-only"

func newTestReceiver(t *testing.T) (*Receiver, *int) {
	t.Helper()
	now := time.Date(2026, 9, 22, 12, 0, 0, 0, time.UTC)
	calls := new(int)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		*calls++
		if req.URL.Path != "/requests/evidence" {
			t.Errorf("unexpected evidence path: %s", req.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"matching_retained": 1, "records": []map[string]any{{"id": strings.Repeat("a", 32), "timestamp": now.Add(-time.Minute), "method": "GET", "outcome": "complete", "status": 503, "source": "upstream", "headers_us": 100, "duration_us": 200, "url": "https://secret.invalid/token/fixture-secret", "request_body": "fixture-secret"}}})
	}))
	t.Cleanup(upstream.Close)
	r, err := New(Config{Dir: filepath.Join(t.TempDir(), "incidents"), Token: testToken, Instance: "netkit-local", AdminURL: upstream.URL, DashboardURL: "https://dashboard.example.test/tools/netkit", Capacity: 2, TTL: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	r.now = func() time.Time { return now }
	return r, calls
}
func deliver(r *Receiver, status string, start time.Time, annotations map[string]string) *httptest.ResponseRecorder {
	alert := webhookAlert{Status: status, Labels: map[string]string{"alertname": "NetkitUpstreamFailureRate", "job": "netkit", "instance": "netkit-local", "secret": "fixture-secret"}, Annotations: annotations, StartsAt: start}
	if status == "resolved" {
		alert.EndsAt = r.now()
	}
	data, _ := json.Marshal(map[string]any{"alerts": []webhookAlert{alert}, "externalURL": "http://fixture-secret.invalid"})
	req := httptest.NewRequest("POST", "/webhook", bytes.NewReader(data))
	req.Header.Set("Authorization", "Bearer "+testToken)
	w := httptest.NewRecorder()
	r.Handler().ServeHTTP(w, req)
	return w
}
func TestIncidentEvidenceLifecycleAndSanitization(t *testing.T) {
	r, calls := newTestReceiver(t)
	start := r.now().Add(-3 * time.Minute)
	for i := 0; i < 2; i++ {
		w := deliver(r, "firing", start, map[string]string{"value": "0.5", "threshold": "0.1", "description": "fixture-secret"})
		if w.Code != 204 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	incidents, err := r.load()
	if err != nil || len(incidents) != 1 {
		t.Fatal(incidents, err)
	}
	original := incidents[0]
	if *calls != 1 || len(original.Evidence) != 1 || original.EvidenceState != "captured" {
		t.Fatal(original, *calls)
	}
	path := filepath.Join(r.config.Dir, original.ID+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte("fixture-secret")) || bytes.Contains(data, []byte("request_body")) {
		t.Fatalf("snapshot retained arbitrary content: %s", data)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal(info.Mode())
	}
	if w := deliver(r, "resolved", start, nil); w.Code != 204 {
		t.Fatal(w.Code)
	}
	if w := deliver(r, "firing", start, nil); w.Code != 204 {
		t.Fatal(w.Code)
	}
	incidents, _ = r.load()
	if incidents[0].Status != "resolved" || *calls != 1 || incidents[0].Observed == nil || *incidents[0].Observed != .5 {
		t.Fatal(incidents, *calls)
	}
	// Evidence survives a receiver restart, independently of proxy/history lifetime.
	restored, err := New(r.config)
	if err != nil {
		t.Fatal(err)
	}
	restored.now = r.now
	records, err := restored.load()
	if err != nil || len(records) != 1 || len(records[0].Evidence) != 1 {
		t.Fatal(records, err)
	}
	if !strings.Contains(r.investigate(original), "/tools/netkit/?") || !strings.Contains(r.investigate(original), "signal=http5xx") {
		t.Fatal(r.investigate(original))
	}
	w := httptest.NewRecorder()
	r.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/?id="+original.ID, nil))
	if w.Code != 200 || strings.Contains(w.Body.String(), "fixture-secret") || !strings.Contains(w.Body.String(), "resolved") {
		t.Fatal(w.Code, w.Body.String())
	}
}
func TestIncidentBoundsAndExpiry(t *testing.T) {
	r, _ := newTestReceiver(t)
	base := r.now()
	for i := 0; i < 3; i++ {
		now := base.Add(time.Duration(i) * time.Minute)
		r.now = func() time.Time { return now }
		if w := deliver(r, "firing", base.Add(time.Duration(i)*time.Second), nil); w.Code != 204 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	records, _ := r.load()
	if len(records) != 2 {
		t.Fatal(len(records))
	}
	id := records[0].ID
	r.now = func() time.Time { return base.Add(2 * time.Hour) }
	if err := r.Prune(); err != nil {
		t.Fatal(err)
	}
	records, _ = r.load()
	if len(records) != 0 {
		t.Fatal(records)
	}
	w := httptest.NewRecorder()
	r.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/?id="+id, nil))
	if w.Code != 404 || !strings.Contains(w.Body.String(), "expired") {
		t.Fatal(w.Code, w.Body.String())
	}
}
func TestRejectUnauthorizedUnboundedOrForeignInput(t *testing.T) {
	r, _ := newTestReceiver(t)
	for _, tc := range []struct {
		body, token string
		code        int
	}{{`{"alerts":[]}`, "", 401}, {strings.Repeat("x", (1<<20)+1), testToken, 400}, {`{"alerts":[{"status":"firing","startsAt":"2026-09-22T11:59:00Z","labels":{"alertname":"NetkitUpstreamFailureRate","job":"netkit","instance":"another-instance"}}]}`, testToken, 400}} {
		req := httptest.NewRequest("POST", "/webhook", strings.NewReader(tc.body))
		req.Header.Set("Authorization", "Bearer "+tc.token)
		w := httptest.NewRecorder()
		r.Handler().ServeHTTP(w, req)
		if w.Code != tc.code {
			t.Fatal(w.Code, tc.code)
		}
	}
	records, _ := r.load()
	if len(records) != 0 {
		t.Fatal(records)
	}
}
func TestUnavailableEvidenceDoesNotBecomeHealthy(t *testing.T) {
	r, _ := newTestReceiver(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer upstream.Close()
	r.config.AdminURL = upstream.URL
	if w := deliver(r, "firing", r.now().Add(-time.Minute), nil); w.Code != 204 {
		t.Fatal(w.Code)
	}
	records, _ := r.load()
	if records[0].EvidenceState != "unavailable" || records[0].Status != "firing" {
		t.Fatal(records)
	}
}
func TestConcurrentRetriesDeduplicate(t *testing.T) {
	r, calls := newTestReceiver(t)
	start := r.now().Add(-time.Minute)
	var group sync.WaitGroup
	for i := 0; i < 8; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			if w := deliver(r, "firing", start, nil); w.Code != 204 {
				t.Error(w.Code)
			}
		}()
	}
	group.Wait()
	records, _ := r.load()
	if len(records) != 1 || *calls != 1 {
		t.Fatal(len(records), *calls)
	}
}
func TestEvidenceValidationAndFixedURL(t *testing.T) {
	r, _ := newTestReceiver(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"matching_retained":1,"records":[{"id":"fixture-secret","method":"fixture-secret"}]}`)
	}))
	defer upstream.Close()
	r.config.AdminURL = upstream.URL
	if w := deliver(r, "firing", r.now().Add(-time.Minute), map[string]string{"generatorURL": "http://fixture-secret.invalid", "value": "NaN", "threshold": "Inf"}); w.Code != 204 {
		t.Fatal(w.Code)
	}
	records, _ := r.load()
	if records[0].EvidenceState != "unavailable" || records[0].Observed != nil || records[0].Threshold != nil {
		t.Fatal(records)
	}
	bad := r.config
	bad.DashboardURL = "https://user:password@example.test/"
	if _, err := New(bad); err == nil {
		t.Fatal("accepted credentials in dashboard URL")
	}
}
