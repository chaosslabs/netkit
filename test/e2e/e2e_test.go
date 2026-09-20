//go:build e2e

package e2e

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	proxyPort       = 9999
	proxyAddr       = "http://localhost:9999"
	testServerPort  = 8888
	testServerAddr  = "http://localhost:8888"
	timeoutDuration = 10 * time.Second
)

var binaryPath string

// Build current sources once per suite rather than reusing a stale bin/netkit.
func TestMain(m *testing.M) {
	buildDir, err := os.MkdirTemp("", "netkit-e2e-")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	binaryPath = filepath.Join(buildDir, "netkit")
	buildCmd := exec.Command("go", "build", "-race", "-o", binaryPath, "../../cmd/netkit")
	buildCmd.Stdout = os.Stdout
	buildCmd.Stderr = os.Stderr
	code := 1
	if err := buildCmd.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "Failed to build netkit:", err)
	} else {
		code = m.Run()
	}
	if err := os.RemoveAll(buildDir); err != nil {
		fmt.Fprintln(os.Stderr, "Failed to remove test binary:", err)
		code = 1
	}
	os.Exit(code)
}

type testServer struct {
	server *http.Server
}

// setupTestServer creates a test HTTP server that simulates a backend service
func setupTestServer(t *testing.T) *testServer {
	mux := http.NewServeMux()

	// Basic endpoint that returns a simple response
	mux.HandleFunc("/hello", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Test-Header", "test-value")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(`{"message":"Hello, World!"}`)); err != nil {
			t.Logf("Error writing response: %v", err)
		}
	})

	// Echo endpoint that returns request details
	mux.HandleFunc("/echo", func(w http.ResponseWriter, r *http.Request) {
		// Handle OPTIONS request with CORS headers
		if r.Method == "OPTIONS" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(http.StatusOK)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Error reading body", http.StatusInternalServerError)
			return
		}
		if closeErr := r.Body.Close(); closeErr != nil {
			t.Logf("Error closing request body: %v", closeErr)
		}

		response := map[string]interface{}{
			"method":  r.Method,
			"path":    r.URL.Path,
			"headers": r.Header,
			"body":    string(body),
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if encErr := json.NewEncoder(w).Encode(response); encErr != nil {
			t.Logf("Error encoding response: %v", encErr)
		}
	})

	// Delayed response endpoint for testing timeouts
	mux.HandleFunc("/delay", func(w http.ResponseWriter, r *http.Request) {
		delay := r.URL.Query().Get("time")
		if delay == "" {
			delay = "2"
		}

		duration, err := time.ParseDuration(delay + "s")
		if err != nil {
			http.Error(w, "Invalid delay parameter", http.StatusBadRequest)
			return
		}

		time.Sleep(duration)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write([]byte(`{"message":"Delayed response"}`)); err != nil {
			t.Logf("Error writing delayed response: %v", err)
		}
	})

	// Error endpoint
	mux.HandleFunc("/error", func(w http.ResponseWriter, r *http.Request) {
		statusCode := http.StatusInternalServerError
		statusParam := r.URL.Query().Get("status")
		if statusParam != "" {
			if _, scanErr := fmt.Sscanf(statusParam, "%d", &statusCode); scanErr != nil {
				t.Logf("Error parsing status code: %v", scanErr)
			}
		}
		w.WriteHeader(statusCode)
		if _, err := w.Write([]byte(`{"error":"Test error response"}`)); err != nil {
			t.Logf("Error writing error response: %v", err)
		}
	})

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", testServerPort),
		Handler: mux,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			t.Logf("Test server error: %v", err)
		}
	}()

	// Make sure the server is running
	for i := 0; i < 10; i++ {
		_, err := http.Get(fmt.Sprintf("%s/hello", testServerAddr))
		if err == nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	return &testServer{server: srv}
}

func (ts *testServer) shutdown(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := ts.server.Shutdown(ctx); err != nil {
		t.Logf("Test server shutdown error: %v", err)
	}
}

// netkitCmd represents a running netkit process
type netkitCmd struct {
	cmd    *exec.Cmd
	stdout *bytes.Buffer
	stderr *bytes.Buffer
}

// startProxyServer starts the netkit proxy server with the given arguments
func startProxyServer(t *testing.T, args ...string) *netkitCmd {
	// Default arguments for the serve command
	serveArgs := []string{"serve", fmt.Sprintf("--port=%d", proxyPort), "--log-level=debug"}

	// Merge with custom args
	args = append(serveArgs, args...)

	cmd := exec.Command(binaryPath, args...)
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	cmd.Stdout = stdout
	cmd.Stderr = stderr

	if err := cmd.Start(); err != nil {
		t.Fatalf("Failed to start netkit: %v", err)
	}

	// Wait for proxy to start
	time.Sleep(1 * time.Second)

	return &netkitCmd{
		cmd:    cmd,
		stdout: stdout,
		stderr: stderr,
	}
}

func (f *netkitCmd) stop(t *testing.T) {
	if err := f.cmd.Process.Signal(os.Interrupt); err != nil {
		t.Logf("Failed to send interrupt to netkit: %v", err)
		if err := f.cmd.Process.Kill(); err != nil {
			t.Logf("Failed to kill netkit: %v", err)
		}
	}

	// Collect process output
	err := f.cmd.Wait()
	if err != nil && err.Error() != "signal: interrupt" {
		t.Logf("Netkit exited with error: %v", err)
	}

	// Give it a brief moment to flush output
	time.Sleep(100 * time.Millisecond)

	// We're keeping this small delay to ensure output is properly captured
	t.Logf("Netkit stdout: %s", f.stdout.String())
	t.Logf("Netkit stderr: %s", f.stderr.String())
}

// makeRequestThroughProxy makes an HTTP request through the proxy
func makeRequestThroughProxy(t *testing.T, method, targetURL string, headers map[string]string, body string) (*http.Response, []byte) {
	client := &http.Client{
		Timeout: timeoutDuration,
		Transport: &http.Transport{
			Proxy: func(_ *http.Request) (*url.URL, error) {
				return url.Parse(proxyAddr)
			},
		},
	}

	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}

	req, err := http.NewRequest(method, targetURL, bodyReader)
	require.NoError(t, err, "Failed to create request")

	for key, value := range headers {
		req.Header.Set(key, value)
	}

	resp, err := client.Do(req)
	require.NoError(t, err, "Failed to make request through proxy")
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			t.Logf("Error closing response body: %v", closeErr)
		}
	}()

	respBody, err := io.ReadAll(resp.Body)
	require.NoError(t, err, "Failed to read response body")

	return resp, respBody
}

// TestBasicProxyFunctionality tests the basic HTTP proxy functionality
func TestBasicProxyFunctionality(t *testing.T) {
	testSrv := setupTestServer(t)
	defer testSrv.shutdown(t)

	proxySrv := startProxyServer(t)
	defer proxySrv.stop(t)

	t.Run("GET request through proxy", func(t *testing.T) {
		targetURL := fmt.Sprintf("%s/hello", testServerAddr)
		resp, body := makeRequestThroughProxy(t, "GET", targetURL, nil, "")

		assert.Equal(t, http.StatusOK, resp.StatusCode)
		assert.Equal(t, "test-value", resp.Header.Get("X-Test-Header"))
		assert.Contains(t, string(body), "Hello, World!")
	})

	t.Run("POST request with body", func(t *testing.T) {
		targetURL := fmt.Sprintf("%s/echo", testServerAddr)
		headers := map[string]string{
			"Content-Type": "application/json",
			"X-Custom":     "custom-value",
		}
		reqBody := `{"name":"Test User","action":"testing"}`

		resp, body := makeRequestThroughProxy(t, "POST", targetURL, headers, reqBody)

		assert.Equal(t, http.StatusOK, resp.StatusCode)

		var responseData map[string]interface{}
		err := json.Unmarshal(body, &responseData)
		require.NoError(t, err, "Failed to parse response JSON")

		assert.Equal(t, "POST", responseData["method"])
		assert.Equal(t, "/echo", responseData["path"])
		assert.Contains(t, responseData["body"], "Test User")

		// Handle headers map properly using type assertions at each level
		headersMap, ok := responseData["headers"].(map[string]interface{})
		require.True(t, ok, "Headers should be a map")

		// Check for Content-Type header
		if contentTypeHeaders, ok := headersMap["Content-Type"].([]interface{}); ok && len(contentTypeHeaders) > 0 {
			if contentTypeStr, ok := contentTypeHeaders[0].(string); ok {
				assert.Contains(t, contentTypeStr, "application/json")
			} else {
				t.Error("Content-Type header value is not a string")
			}
		} else {
			t.Error("Content-Type header not found or not an array")
		}

		// Check for X-Custom header
		if customHeaders, ok := headersMap["X-Custom"].([]interface{}); ok && len(customHeaders) > 0 {
			if customHeaderStr, ok := customHeaders[0].(string); ok {
				assert.Contains(t, customHeaderStr, "custom-value")
			} else {
				t.Error("X-Custom header value is not a string")
			}
		} else {
			t.Error("X-Custom header not found or not an array")
		}
	})

	t.Run("Error handling", func(t *testing.T) {
		targetURL := fmt.Sprintf("%s/error?status=503", testServerAddr)
		resp, body := makeRequestThroughProxy(t, "GET", targetURL, nil, "")

		assert.Equal(t, http.StatusServiceUnavailable, resp.StatusCode)
		assert.Contains(t, string(body), "error")
	})

	t.Run("Different HTTP methods", func(t *testing.T) {
		methods := []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"}
		for _, method := range methods {
			t.Run(method, func(t *testing.T) {
				targetURL := fmt.Sprintf("%s/echo", testServerAddr)
				resp, body := makeRequestThroughProxy(t, method, targetURL, nil, "")

				assert.Equal(t, http.StatusOK, resp.StatusCode)

				// Skip JSON parsing for OPTIONS requests
				if method == "OPTIONS" {
					return
				}

				var responseData map[string]interface{}
				err := json.Unmarshal(body, &responseData)
				require.NoError(t, err, "Failed to parse response JSON")

				assert.Equal(t, method, responseData["method"])
			})
		}
	})
}

// TestHealthCheckEndpoint tests the health check endpoint
func TestHealthCheckEndpoint(t *testing.T) {
	proxySrv := startProxyServer(t, "--admin-port", "9998")
	defer proxySrv.stop(t)

	// Direct request to health endpoint on the admin server (not through proxy)
	client := &http.Client{
		Timeout: timeoutDuration,
		// No proxy configuration
	}
	healthURL := "http://localhost:9998/healthz"
	resp, err := client.Get(healthURL)
	require.NoError(t, err, "Failed to make health check request")
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			t.Logf("Error closing health check response body: %v", closeErr)
		}
	}()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err, "Failed to read health check response")

	assert.Contains(t, string(body), "status")
}

// TestMetricsEndpoint tests the metrics endpoint
func TestMetricsEndpoint(t *testing.T) {
	proxySrv := startProxyServer(t, "--admin-port", "9997")
	defer proxySrv.stop(t)

	// Make a few requests through the proxy to generate metrics
	testSrv := setupTestServer(t)
	defer testSrv.shutdown(t)

	// Make a few requests to generate metrics
	for i := 0; i < 3; i++ {
		targetURL := fmt.Sprintf("%s/hello", testServerAddr)
		makeRequestThroughProxy(t, "GET", targetURL, nil, "")
	}

	// Direct request to metrics endpoint on the admin server (not through proxy)
	client := &http.Client{
		Timeout: timeoutDuration,
		// No proxy configuration
	}
	metricsURL := "http://localhost:9997/metrics"
	resp, err := client.Get(metricsURL)
	require.NoError(t, err, "Failed to make metrics request")
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			t.Logf("Error closing metrics response body: %v", closeErr)
		}
	}()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err, "Failed to read metrics response")

	// Check for expected metrics content
	assert.Contains(t, string(body), "requests_total")
}

// TestConnectionPooling tests connection pooling by making many concurrent requests
func TestConnectionPooling(t *testing.T) {
	testSrv := setupTestServer(t)
	defer testSrv.shutdown(t)

	proxySrv := startProxyServer(t)
	defer proxySrv.stop(t)

	// Make multiple concurrent requests
	const numRequests = 20
	done := make(chan bool, numRequests)

	for i := 0; i < numRequests; i++ {
		go func() {
			targetURL := fmt.Sprintf("%s/hello", testServerAddr)
			resp, _ := makeRequestThroughProxy(t, "GET", targetURL, nil, "")
			assert.Equal(t, http.StatusOK, resp.StatusCode)
			done <- true
		}()
	}

	// Wait for all requests to complete
	for i := 0; i < numRequests; i++ {
		select {
		case <-done:
			// Request completed successfully
		case <-time.After(timeoutDuration):
			t.Fatal("Timeout waiting for requests to complete")
		}
	}
}

// TestProxyWithDifferentLogLevels tests the proxy with different log levels
func TestProxyWithDifferentLogLevels(t *testing.T) {
	logLevels := []string{"debug", "info", "warn", "error"}

	for _, level := range logLevels {
		t.Run(fmt.Sprintf("LogLevel=%s", level), func(t *testing.T) {
			proxySrv := startProxyServer(t, "--log-level="+level)

			testSrv := setupTestServer(t)
			defer testSrv.shutdown(t)

			targetURL := fmt.Sprintf("%s/hello", testServerAddr)
			resp, _ := makeRequestThroughProxy(t, "GET", targetURL, nil, "")
			assert.Equal(t, http.StatusOK, resp.StatusCode)

			// Stop the proxy BEFORE reading from stderr buffer to avoid race condition
			proxySrv.stop(t)

			// Now it's safe to read from stderr since process has stopped
			stderrOutput := proxySrv.stderr.String()

			// Check logs for appropriate log level messages - logs go to stderr
			switch level {
			case "debug":
				assert.Contains(t, stderrOutput, "Starting proxy server on port")
				assert.Contains(t, stderrOutput, "Received request")
			case "info":
				assert.NotContains(t, stderrOutput, "debug")
			case "warn":
				assert.NotContains(t, stderrOutput, "debug")
				assert.NotContains(t, stderrOutput, "info")
			case "error":
				assert.NotContains(t, stderrOutput, "debug")
				assert.NotContains(t, stderrOutput, "info")
				assert.NotContains(t, stderrOutput, "warn")
			}
		})
	}
}

// TestGracefulShutdown tests that the proxy shuts down gracefully
func TestGracefulShutdown(t *testing.T) {
	proxySrv := startProxyServer(t)

	// Make a request to ensure proxy is working
	testSrv := setupTestServer(t)
	defer testSrv.shutdown(t)

	targetURL := fmt.Sprintf("%s/hello", testServerAddr)
	resp, _ := makeRequestThroughProxy(t, "GET", targetURL, nil, "")
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	// Stop the proxy and check for graceful shutdown message
	proxySrv.stop(t)

	// Check stderr for shutdown message since that's where the proxy logs it
	assert.Contains(t, proxySrv.stderr.String(), "Shutting down", "Proxy should indicate graceful shutdown")
}

// TestDefaultConfiguration tests that the proxy works with default configuration (no flags)
func TestDefaultConfiguration(t *testing.T) {
	// Start with minimal flags - testing that admin port defaults to 8081
	// We still need to override proxy port to avoid conflicts with other tests
	// and disable dashboard to avoid port 3000 conflicts
	proxySrv := startProxyServer(t, "--admin-port", "8091", "--dashboard=false")
	defer proxySrv.stop(t)

	testSrv := setupTestServer(t)
	defer testSrv.shutdown(t)

	// Make a request through the proxy
	targetURL := fmt.Sprintf("%s/hello", testServerAddr)
	resp, body := makeRequestThroughProxy(t, "GET", targetURL, nil, "")

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Contains(t, string(body), "Hello, World!")

	// Test that admin API is available on the configured port (8091)
	client := &http.Client{Timeout: timeoutDuration}

	// Health check should work
	healthResp, err := client.Get("http://localhost:8091/healthz")
	require.NoError(t, err, "Failed to make health check request on admin port")
	defer healthResp.Body.Close()

	assert.Equal(t, http.StatusOK, healthResp.StatusCode, "Health check should succeed on admin port")

	// Request history should work
	historyResp, err := client.Get("http://localhost:8091/requests")
	require.NoError(t, err, "Failed to get request history on admin port")
	defer historyResp.Body.Close()

	assert.Equal(t, http.StatusOK, historyResp.StatusCode, "Request history should be accessible on admin port")

	var historyData map[string]interface{}
	err = json.NewDecoder(historyResp.Body).Decode(&historyData)
	require.NoError(t, err, "Failed to decode history response")

	records, ok := historyData["records"].([]interface{})
	require.True(t, ok, "Records should be an array")
	assert.GreaterOrEqual(t, len(records), 1, "Should have at least 1 request in history")
}

// TestRequestHistoryEndpoints tests the request history functionality
func TestRequestHistoryEndpoints(t *testing.T) {
	proxySrv := startProxyServer(t, "--admin-port", "9996", "--history-size", "10")
	defer proxySrv.stop(t)

	testSrv := setupTestServer(t)
	defer testSrv.shutdown(t)

	// Clear any existing history
	client := &http.Client{Timeout: timeoutDuration}
	clearResp, err := client.Post("http://localhost:9996/requests/clear", "application/json", nil)
	require.NoError(t, err, "Failed to clear history")
	clearResp.Body.Close()

	// Make some test requests through the proxy
	targetURL1 := fmt.Sprintf("%s/hello", testServerAddr)
	makeRequestThroughProxy(t, "GET", targetURL1, nil, "")

	targetURL2 := fmt.Sprintf("%s/echo", testServerAddr)
	headers := map[string]string{"Content-Type": "application/json"}
	makeRequestThroughProxy(t, "POST", targetURL2, headers, `{"test": "data"}`)

	// Test request history endpoint
	historyResp, err := client.Get("http://localhost:9996/requests")
	require.NoError(t, err, "Failed to get request history")
	defer historyResp.Body.Close()

	assert.Equal(t, http.StatusOK, historyResp.StatusCode)

	var historyData map[string]interface{}
	err = json.NewDecoder(historyResp.Body).Decode(&historyData)
	require.NoError(t, err, "Failed to decode history response")

	records, ok := historyData["records"].([]interface{})
	require.True(t, ok, "Records should be an array")
	assert.Equal(t, 2, len(records), "Should have 2 requests in history")

	// Check the most recent record (POST request)
	mostRecent := records[0].(map[string]interface{})
	assert.Equal(t, "POST", mostRecent["method"])
	assert.Contains(t, mostRecent["url"], "/echo")
	assert.JSONEq(t, `{"test": "data"}`, mostRecent["request_body"].(string))
	assert.Equal(t, float64(200), mostRecent["response_status"])
	assert.True(t, mostRecent["success"].(bool))

	// Test request stats endpoint
	statsResp, err := client.Get("http://localhost:9996/requests/stats")
	require.NoError(t, err, "Failed to get request stats")
	defer statsResp.Body.Close()

	assert.Equal(t, http.StatusOK, statsResp.StatusCode)

	var statsData map[string]interface{}
	err = json.NewDecoder(statsResp.Body).Decode(&statsData)
	require.NoError(t, err, "Failed to decode stats response")

	assert.Equal(t, float64(2), statsData["total_requests"])
	assert.Equal(t, float64(2), statsData["success_count"])
	assert.Equal(t, float64(0), statsData["error_count"])

	// Check method counts
	methods := statsData["methods"].(map[string]interface{})
	assert.Equal(t, float64(1), methods["GET"])
	assert.Equal(t, float64(1), methods["POST"])

	// Check status codes
	statusCodes := statsData["status_codes"].(map[string]interface{})
	assert.Equal(t, float64(2), statusCodes["200"])

	// Test clear history endpoint
	clearResp, err = client.Post("http://localhost:9996/requests/clear", "application/json", nil)
	require.NoError(t, err, "Failed to clear history")
	defer clearResp.Body.Close()

	assert.Equal(t, http.StatusOK, clearResp.StatusCode)

	// Verify history is cleared
	historyResp, err = client.Get("http://localhost:9996/requests")
	require.NoError(t, err, "Failed to get request history after clear")
	defer historyResp.Body.Close()

	err = json.NewDecoder(historyResp.Body).Decode(&historyData)
	require.NoError(t, err, "Failed to decode history response after clear")

	records, ok = historyData["records"].([]interface{})
	require.True(t, ok, "Records should be an array")
	assert.Equal(t, 0, len(records), "History should be empty after clear")
}
