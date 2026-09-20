package proxy

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestCaptureRedactionBeforeStorage(t *testing.T) {
	h := NewRequestHistory(2)
	h.redactFields = []string{"custom_pin", "X-Custom-Pin"}
	original := map[string]string{"Authorization": "Bearer fixture-authorization", "Cookie": "session=fixture-cookie", "X-Custom-Pin": "fixture-pin", "Location": "https://user:fixture-userinfo@example.test/token/fixture-path?q=fixture-query", "X-Netkit-Destination": "https://example.test/bot123:fixture-bot/getUpdates"}
	h.AddRecord(RequestRecord{URL: "https://user:fixture-userinfo@example.test/bot123:fixture-bot/getUpdates?q=fixture-query#fixture-fragment", RequestHeaders: original, ResponseHeaders: original, RequestBody: `{"nested":[{"api_key":"fixture-key","custom_pin":"fixture-body-pin","ok":42}],"access_token":"fixture-access","link":"https://example.test/?q=fixture-json-query"}`, ResponseBody: "opaque fixture-response", Success: true})
	stored, err := json.Marshal(h.records)
	require.NoError(t, err)
	for _, secret := range []string{"fixture-authorization", "fixture-cookie", "fixture-pin", "fixture-userinfo", "fixture-path", "fixture-query", "fixture-bot", "fixture-fragment", "fixture-key", "fixture-body-pin", "fixture-access", "fixture-json-query", "fixture-response"} {
		require.NotContains(t, string(stored), secret)
	}
	require.Contains(t, h.records[0].RequestBody, `"ok":42`)
	require.Equal(t, omittedBody, h.records[0].ResponseBody)
	require.Equal(t, "Bearer fixture-authorization", original["Authorization"], "forwarded headers must not be mutated")
	records := h.GetRecords()
	records[0].RequestHeaders["Authorization"] = "modified"
	require.Equal(t, redacted, h.GetRecords()[0].RequestHeaders["Authorization"])
}

func TestSanitizationFormats(t *testing.T) {
	for _, input := range []string{`{"password":"fixture"`, "password=fixture", "data: fixture", strings.Repeat("x", maxCaptureBytes+1)} {
		require.Equal(t, omittedBody, redactBody(input, nil))
	}
	for _, raw := range []string{"https://example.test/%62ot123%3Afixture-token/getMe", "https://example.test/api_key/fixture-key", "https://example.test/?q=%zz"} {
		require.NotContains(t, redactURL(raw), "fixture")
	}
	require.Equal(t, `{"n":9007199254740993}`, redactBody(`{"n":9007199254740993}`, nil), "do not corrupt JSON integers")
}

func TestMetricsSurviveEvictionClearAndConcurrentAccess(t *testing.T) {
	h := NewRequestHistory(2)
	start := time.Now()
	var wg sync.WaitGroup
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			h.AddRecord(RequestRecord{Method: fmt.Sprintf("secret-method-%d", i), URL: "https://private.test/secret", Outcome: "complete", ResponseStatus: 200, ProxyStartTime: start, ProxyEndTime: start.Add(250 * time.Millisecond)})
			_ = h.Metrics()
			_ = h.GetRecords()
		}(i)
	}
	wg.Wait()
	require.Len(t, h.GetRecords(), 2)
	before := h.Metrics()
	require.Contains(t, before, "netkit_requests_total 30\n")
	require.Contains(t, before, `method="OTHER",outcome="complete",http_status_class="2xx"`)
	require.Contains(t, before, `le="0.25"} 30`)
	require.Contains(t, before, `le="0.1"} 0`)
	require.Contains(t, before, "} 7.5\n")
	require.NotContains(t, before, "secret")
	h.Clear()
	require.Contains(t, h.Metrics(), "netkit_requests_total 30\n")
	require.Contains(t, h.Metrics(), "netkit_history_records 0\n")
	require.Len(t, h.signals, 1, "untrusted methods must not grow label cardinality")
}

func TestMissingTimingAndOutcomeScope(t *testing.T) {
	h := NewRequestHistory(10)
	h.AddRecord(RequestRecord{Outcome: "blocked_by_inspection", ResponseStatus: 501, ResponseSource: "proxy", Error: "raw fixture-secret", ProxyStartTime: time.Now(), ProxyEndTime: time.Now()})
	record := h.GetRecords()[0]
	require.Zero(t, record.UpstreamLatencyUs)
	require.GreaterOrEqual(t, record.ProxyOverheadUs, int64(0))
	require.Equal(t, "Protocol upgrades are not supported in inspection mode", record.Error)
	require.Empty(t, h.GetStats()["status_codes"])
	require.Contains(t, h.Metrics(), `http_status_class="none"`)
	require.Equal(t, "retained_buffer", h.GetStats()["scope"])
}

func TestHTTPOutcomesAndSanitizedAdminAPI(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "fixture-forwarded", r.Header.Get("Authorization"))
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		require.Contains(t, string(body), "fixture-body")
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/unauthorized":
			w.WriteHeader(401)
		case "/interrupted":
			w.Header().Set("Content-Length", "999")
		}
		_, err = io.WriteString(w, `{"token":"fixture-response","ok":true}`)
		require.NoError(t, err)
	}))
	defer origin.Close()
	p := New(&Config{})
	for _, tc := range []struct {
		path, outcome string
		status        int
	}{{"/ok", "complete", 200}, {"/unauthorized", "complete", 401}, {"/interrupted", "interrupted", 200}} {
		t.Run(tc.path, func(t *testing.T) {
			req := httptest.NewRequest("POST", origin.URL+tc.path+"?key=fixture-query", strings.NewReader(`{"password":"fixture-body"}`))
			req.Header.Set("Authorization", "fixture-forwarded")
			response := httptest.NewRecorder()
			p.ServeHTTP(response, req)
			record := p.history.GetRecords()[0]
			require.Equal(t, tc.outcome, record.Outcome)
			require.Equal(t, tc.status, record.ResponseStatus)
			require.Equal(t, "upstream", record.ResponseSource)
			if tc.outcome == "complete" {
				require.Contains(t, response.Body.String(), "fixture-response", "redaction must not change forwarded response")
			}
			admin := httptest.NewRecorder()
			p.handleRequestHistory(admin, httptest.NewRequest("GET", "/requests", nil))
			require.NotContains(t, admin.Body.String(), "fixture-")
			require.Equal(t, "no-store", admin.Header().Get("Cache-Control"))
		})
	}
}

func TestInspectionOutcomes(t *testing.T) {
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/broken" {
			w.Header().Set("Content-Length", "999")
		}
		w.Header().Set("Content-Type", "application/json")
		_, err := io.WriteString(w, `{"ok":true}`)
		require.NoError(t, err)
	}))
	defer upstream.Close()
	p, client, _ := inspectionClient(t, upstream)
	resp, err := client.Get(upstream.URL + "/broken")
	if err == nil {
		_, _ = io.ReadAll(resp.Body)
		require.NoError(t, resp.Body.Close())
	}
	record := waitRecords(t, p, 1)[0]
	require.Equal(t, "interrupted", record.Outcome)
	require.Equal(t, 200, record.ResponseStatus)
	require.Equal(t, "upstream", record.ResponseSource)
	req, err := http.NewRequest("GET", upstream.URL+"/upgrade", nil)
	require.NoError(t, err)
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "Upgrade")
	resp, err = client.Do(req)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	record = waitRecords(t, p, 2)[0]
	require.Equal(t, "blocked_by_inspection", record.Outcome)
	require.Equal(t, "proxy", record.ResponseSource)
	require.Equal(t, 501, record.ResponseStatus)
}

func TestHeaderHistogramExcludesFailedAttemptsAndTunnels(t *testing.T) {
	h := NewRequestHistory(3)
	start := time.Now()
	for _, tc := range []struct{ outcome, source, method string }{{"complete", "upstream", "GET"}, {"upstream_error", "proxy", "GET"}, {"tunnel_only", "proxy", "CONNECT"}} {
		h.AddRecord(RequestRecord{Method: tc.method, Outcome: tc.outcome, ResponseSource: tc.source, ResponseStatus: 200, ProxyStartTime: start, ProxyEndTime: start.Add(time.Second), UpstreamStartTime: start, UpstreamEndTime: start.Add(50 * time.Millisecond)})
	}
	metrics := h.Metrics()
	require.Contains(t, metrics, `netkit_response_headers_seconds_count{method="GET",outcome="complete",http_status_class="2xx"} 1`)
	require.NotContains(t, metrics, `netkit_response_headers_seconds_count{method="CONNECT"`)
	require.NotContains(t, metrics, `netkit_response_headers_seconds_count{method="GET",outcome="upstream_error"`)
}

func TestCanceledHTTPExchangeHasBoundedOutcome(t *testing.T) {
	p := New(&Config{})
	req := httptest.NewRequest("GET", "http://127.0.0.1:1/?token=fixture-secret", nil)
	ctx, cancel := context.WithCancel(req.Context())
	cancel()
	response := httptest.NewRecorder()
	p.ServeHTTP(response, req.WithContext(ctx))
	record := p.history.GetRecords()[0]
	require.Equal(t, "client_canceled", record.Outcome)
	require.Equal(t, "proxy", record.ResponseSource)
	require.Equal(t, 502, record.ResponseStatus)
	require.NotContains(t, record.URL, "fixture-secret")
	require.NotContains(t, record.Error, "fixture-secret")
}
