package proxy

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/biancarosa/netkit/internal/dashboard"
)

// Config holds the proxy configuration
type Config struct {
	RedactFields                    []string              // Additional case-insensitive JSON/header field names to redact
	InspectionResponseHeaderTimeout time.Duration         // Zero allows long polling without a proxy header deadline
	InspectionCA                    *CertificateAuthority // Non-nil enables inspection for every CONNECT destination
	Port                            int
	AdminPort                       int
	LogLevel                        string
	HistorySize                     int    // Maximum number of requests to keep in history
	Dashboard                       bool   // Enable dashboard serving
	DashboardPort                   int    // Port for dashboard (separate from admin port)
	DashboardDir                    string // Directory containing dashboard build files
	DashboardBasePath               string // Optional public URL prefix for path-based reverse proxies
}

// Proxy represents the HTTP proxy server
type Proxy struct {
	inspectionMu        sync.Mutex
	inspectionConns     map[net.Conn]struct{}
	inspectionStopped   bool
	inspectionTransport *http.Transport
	config              *Config
	server              *http.Server
	adminServer         *http.Server
	dashboardServer     *http.Server
	httpClient          *http.Client
	history             *RequestHistory
}

// New creates a new Proxy instance
func New(config *Config) *Proxy {
	// Set default history size if not specified
	historySize := config.HistorySize
	if historySize <= 0 {
		historySize = 1000 // Default to keeping 1000 requests
	}

	proxy := &Proxy{
		config: config,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		history: NewRequestHistory(historySize),
	}

	proxy.history.redactFields = append([]string(nil), config.RedactFields...)
	proxy.inspectionConns = make(map[net.Conn]struct{})
	proxy.inspectionTransport = http.DefaultTransport.(*http.Transport).Clone()
	proxy.inspectionTransport.ResponseHeaderTimeout = config.InspectionResponseHeaderTimeout
	proxy.inspectionTransport.Proxy = nil // Never route upstream connections back into this proxy.

	// Initialize the main HTTP proxy server
	proxy.server = &http.Server{
		Addr:    fmt.Sprintf(":%d", config.Port),
		Handler: proxy,
	}

	// Initialize the admin server if admin port is specified
	if config.AdminPort > 0 {
		adminMux := http.NewServeMux()

		// Always enable both health and metrics when admin port is specified
		adminMux.HandleFunc("/healthz", proxy.handleHealth)
		adminMux.HandleFunc("/metrics", proxy.handleMetrics)

		// Add request history endpoints
		adminMux.HandleFunc("/requests", proxy.handleRequestHistory)
		adminMux.HandleFunc("/requests/evidence", proxy.handleEvidence)
		adminMux.HandleFunc("/requests/stats", proxy.handleRequestStats)
		adminMux.HandleFunc("/requests/clear", proxy.handleClearHistory)

		proxy.adminServer = &http.Server{
			Addr:    fmt.Sprintf(":%d", config.AdminPort),
			Handler: adminMux,
		}
	}

	// Initialize the dashboard server if dashboard is enabled
	if config.Dashboard && config.DashboardPort > 0 {
		var dashboardHandler http.Handler
		dashboardBasePath := normalizeDashboardBasePath(config.DashboardBasePath)
		dashboardOptions := dashboard.Options{
			BasePath:     dashboardBasePath,
			ProxyBaseURL: joinDashboardPath(dashboardBasePath, "/api/proxy"),
			AdminBaseURL: joinDashboardPath(dashboardBasePath, "/api/admin"),
		}

		// Serve static files from dashboard directory or embedded dashboard
		if config.DashboardDir != "" {
			dashboardHandler = dashboard.DirectoryHandler(config.DashboardDir, dashboardOptions)
		} else {
			// Use embedded dashboard
			dashboardHandler = dashboard.Handler(dashboardOptions)
		}

		proxy.dashboardServer = &http.Server{
			Addr:    fmt.Sprintf(":%d", config.DashboardPort),
			Handler: proxy.dashboardRouter(dashboardHandler),
		}
	}

	return proxy
}

func (p *Proxy) dashboardRouter(staticHandler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		strippedPath := stripDashboardBasePath(r.URL.Path, p.config.DashboardBasePath)
		routedRequest := cloneRequestWithPath(r, strippedPath)

		switch {
		case strippedPath == "/api/proxy" || strings.HasPrefix(strippedPath, "/api/proxy/"):
			p.handleHTTP(w, routedRequest)
		case strippedPath == "/api/admin/healthz":
			p.handleHealth(w, routedRequest)
		case strippedPath == "/api/admin/metrics":
			p.handleMetrics(w, routedRequest)
		case strippedPath == "/api/admin/requests":
			p.handleRequestHistory(w, routedRequest)
		case strippedPath == "/api/admin/requests/stats":
			p.handleRequestStats(w, routedRequest)
		case strippedPath == "/api/admin/requests/clear":
			p.handleClearHistory(w, routedRequest)
		default:
			staticHandler.ServeHTTP(w, routedRequest)
		}
	})
}

func cloneRequestWithPath(r *http.Request, path string) *http.Request {
	clone := new(http.Request)
	*clone = *r
	urlCopy := *r.URL
	urlCopy.Path = path
	urlCopy.RawPath = ""
	clone.URL = &urlCopy
	return clone
}

func stripDashboardBasePath(requestPath, basePath string) string {
	basePath = normalizeDashboardBasePath(basePath)
	if basePath == "" {
		return requestPath
	}

	if requestPath == basePath {
		return "/"
	}

	if strings.HasPrefix(requestPath, basePath+"/") {
		stripped := strings.TrimPrefix(requestPath, basePath)
		if stripped == "" {
			return "/"
		}
		return stripped
	}

	return requestPath
}

func normalizeDashboardBasePath(basePath string) string {
	basePath = strings.TrimSpace(basePath)
	if basePath == "" || basePath == "/" {
		return ""
	}

	if !strings.HasPrefix(basePath, "/") {
		basePath = "/" + basePath
	}

	return strings.TrimRight(basePath, "/")
}

func joinDashboardPath(basePath, routePath string) string {
	basePath = normalizeDashboardBasePath(basePath)
	if routePath == "" || routePath == "/" {
		if basePath == "" {
			return "/"
		}
		return basePath
	}

	if !strings.HasPrefix(routePath, "/") {
		routePath = "/" + routePath
	}

	return basePath + routePath
}

// ServeHTTP implements the http.Handler interface for the proxy
func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Debug logging for received requests
	if p.config.LogLevel == "debug" {
		log.Printf("Received request: %s %s", metricMethod(r.Method), redactURL(r.URL.String()))
	}

	// For CONNECT method (HTTPS tunneling)
	if r.Method == http.MethodConnect {
		if p.config.InspectionCA != nil {
			p.handleInspectedConnect(w, r)
		} else {
			p.handleConnect(w, r)
		}
		return
	}

	// For regular HTTP requests
	p.handleHTTP(w, r)
}

// handleHTTP handles regular HTTP requests
func (p *Proxy) handleHTTP(w http.ResponseWriter, r *http.Request) {
	// Always add CORS headers to allow any web application to use the proxy
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Netkit-Destination, Authorization, Accept, Origin, X-Requested-With, Cache-Control, Pragma, Expires")
	w.Header().Set("Access-Control-Expose-Headers", "*")

	// Handle preflight requests
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Start timing
	proxyStartTime := time.Now()

	// Generate request ID
	requestID := generateID()

	// Capture request data
	requestBody, requestSize, bodyReader := captureRequestBody(r)

	// Create request record
	record := RequestRecord{
		ID:             requestID,
		Timestamp:      proxyStartTime,
		Method:         r.Method,
		URL:            r.URL.String(),
		RequestHeaders: convertHeaders(r.Header),
		RequestBody:    requestBody,
		RequestSize:    requestSize,
		ProxyStartTime: proxyStartTime,
		Success:        false, // Will be updated based on outcome
		ResponseSource: "proxy",
	}

	// Check for X-Netkit-Destination header (for dashboard requests)
	var targetURL *url.URL
	var err error

	if destinationHeader := r.Header.Get("X-Netkit-Destination"); destinationHeader != "" {
		// Dashboard request - use the destination header as the target URL
		targetURL, err = url.Parse(destinationHeader)
		if err != nil {
			record.Error = "Invalid X-Netkit-Destination URL"
			record.ResponseStatus = http.StatusBadRequest
			record.ProxyEndTime = time.Now()
			p.history.AddRecord(record)
			http.Error(w, "Invalid X-Netkit-Destination URL", http.StatusBadRequest)
			return
		}
		// Update the record URL to reflect the actual destination
		record.URL = destinationHeader
	} else {
		// Regular proxy request - use the request URL
		targetURL, err = url.Parse(r.URL.String())
		if err != nil {
			record.Error = "Invalid URL"
			record.ResponseStatus = http.StatusBadRequest
			record.ProxyEndTime = time.Now()
			p.history.AddRecord(record)
			http.Error(w, "Invalid URL", http.StatusBadRequest)
			return
		}
	}

	// Create the proxied request
	proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL.String(), bodyReader)
	if err != nil {
		record.Error = "Failed to create proxy request"
		record.ResponseStatus = http.StatusInternalServerError
		record.ProxyEndTime = time.Now()
		p.history.AddRecord(record)
		http.Error(w, "Failed to create proxy request", http.StatusInternalServerError)
		return
	}

	// Copy headers from original request
	for key, values := range r.Header {
		// Skip the X-Netkit-Destination header - it's only for internal proxy routing
		if key == "X-Netkit-Destination" {
			continue
		}
		for _, value := range values {
			proxyReq.Header.Add(key, value)
		}
	}

	// Make the request to the target server (start upstream timing)
	record.UpstreamStartTime = time.Now()
	resp, err := p.httpClient.Do(proxyReq)
	record.UpstreamEndTime = time.Now()

	if err != nil {
		record.Error = "Failed to proxy request"
		record.ResponseStatus = http.StatusBadGateway
		record.Outcome = "upstream_error"
		record.FailureReason = failureReason(err)
		if r.Context().Err() != nil {
			record.Outcome = "client_canceled"
		}
		record.ProxyEndTime = time.Now()
		p.history.AddRecord(record)
		http.Error(w, "Failed to proxy request", http.StatusBadGateway)
		return
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			log.Printf("Error closing response body: %v", closeErr)
		}
	}()

	// Capture response data
	record.ResponseStatus = resp.StatusCode
	record.ResponseSource = "upstream"
	record.ResponseHeaders = convertHeaders(resp.Header)
	responseBody, responseSize, err := captureResponseBody(resp)
	if err != nil {
		record.Error = "Failed to read response body"
		record.Outcome = "interrupted"
		if r.Context().Err() != nil {
			record.Outcome = "client_canceled"
		}
		record.ProxyEndTime = time.Now()
		p.history.AddRecord(record)
		http.Error(w, "Failed to read response body", http.StatusInternalServerError)
		return
	}

	// Update record with response data
	record.ResponseStatus = resp.StatusCode
	record.ResponseHeaders = convertHeaders(resp.Header)
	record.ResponseBody = responseBody
	record.ResponseSize = responseSize
	record.Success = true
	record.Outcome = "complete"

	// End proxy processing timing here - before we start writing response to client
	record.ProxyEndTime = time.Now()

	// Copy response headers
	for key, values := range resp.Header {
		// Override any CORS headers we set earlier with the upstream response headers
		// This preserves the destination API's intended CORS policy
		for _, value := range values {
			if key == "Access-Control-Allow-Origin" ||
				key == "Access-Control-Allow-Methods" ||
				key == "Access-Control-Allow-Headers" ||
				key == "Access-Control-Expose-Headers" ||
				key == "Access-Control-Allow-Credentials" ||
				key == "Access-Control-Max-Age" {
				// For CORS headers, replace (not add) to avoid duplicates
				w.Header().Set(key, value)
			} else {
				// For other headers, add normally
				w.Header().Add(key, value)
			}
		}
	}

	// Copy status code
	w.WriteHeader(resp.StatusCode)

	// Copy response body
	if _, err := io.Copy(w, resp.Body); err != nil {
		log.Printf("Error copying response body: %v", err)
		record.Error = "Failed to copy response body"
		record.Outcome = "interrupted"
		if r.Context().Err() != nil {
			record.Outcome = "client_canceled"
		}
		record.Success = false
	}

	// Record the complete handler lifetime, including downstream transfer.
	record.ProxyEndTime = time.Now()
	p.history.AddRecord(record)

	// Debug logging for completed requests
	if p.config.LogLevel == "debug" {
		log.Printf("HTTP request completed: %s %s -> %d (%dus)",
			metricMethod(r.Method), redactURL(r.URL.String()), resp.StatusCode, elapsedUS(record.ProxyStartTime, record.ProxyEndTime))
	}
}

// handleConnect handles CONNECT method for HTTPS tunneling
func (p *Proxy) handleConnect(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	// CONNECT records describe tunnel establishment, not the encrypted requests
	// inside it. Record immediately so long-lived tunnels appear in history.
	record := RequestRecord{
		ID: generateID(), Timestamp: start, Method: http.MethodConnect,
		URL: r.Host, ProxyStartTime: start, UpstreamStartTime: start,
		RequestHeaders: map[string]string{}, ResponseHeaders: map[string]string{},
	}
	recordResult := func(status int, err error) {
		record.ResponseStatus = status
		record.ResponseSource = "proxy"
		record.Outcome = "tunnel_only"
		record.Success = err == nil
		if err != nil {
			record.Error = "Tunnel establishment failed"
			record.Outcome = "proxy_error"
		}
		record.ProxyEndTime = time.Now()
		if record.UpstreamEndTime.IsZero() {
			record.UpstreamEndTime = record.ProxyEndTime
		}
		p.history.AddRecord(record)
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		err := fmt.Errorf("hijacking not supported")
		recordResult(http.StatusInternalServerError, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	dest, err := net.DialTimeout("tcp", r.Host, 30*time.Second)
	record.UpstreamEndTime = time.Now()
	if err != nil {
		recordResult(http.StatusServiceUnavailable, err)
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	defer func() {
		if err := dest.Close(); err != nil {
			log.Printf("Error closing destination connection: %v", err)
		}
	}()

	clientConn, buffered, err := hijacker.Hijack()
	if err != nil {
		recordResult(http.StatusServiceUnavailable, err)
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	defer func() {
		if err := clientConn.Close(); err != nil {
			log.Printf("Error closing client connection: %v", err)
		}
	}()
	if _, err := buffered.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		recordResult(http.StatusServiceUnavailable, err)
		return
	}
	if err := buffered.Flush(); err != nil {
		recordResult(http.StatusServiceUnavailable, err)
		return
	}
	recordResult(http.StatusOK, nil)

	// Start copying data between client and destination
	go func() {
		if _, err := io.Copy(dest, buffered); err != nil {
			log.Printf("Error copying from client to destination: %v", err)
		}
	}()

	if _, err := io.Copy(clientConn, dest); err != nil {
		log.Printf("Error copying from destination to client: %v", err)
	}
}

// handleHealth handles health check requests
func (p *Proxy) handleHealth(w http.ResponseWriter, r *http.Request) {
	// Add CORS headers to allow requests from the dashboard
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma, Expires")

	// Handle preflight requests
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	mode := "http_and_connect_tunnels"
	if p.config.InspectionCA != nil {
		mode = "http_and_https_inspection"
	}
	if err := json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "healthy", "proxy": "netkit", "capture_mode": mode,
		"history_capacity": p.history.maxSize, "history_scope": "retained_buffer",
		"redaction": "structured_json", "redact_fields": p.config.RedactFields,
		"body_limit_bytes": maxCaptureBytes, "metrics_scope": "process_lifetime",
	}); err != nil {
		log.Printf("Error writing health response: %v", err)
	}

}

// handleMetrics handles metrics requests
func (p *Proxy) handleMetrics(w http.ResponseWriter, r *http.Request) {
	// Add CORS headers to allow requests from the dashboard
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma, Expires")

	// Handle preflight requests
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	metrics := p.history.Metrics()
	if _, err := w.Write([]byte(metrics)); err != nil {
		log.Printf("Error writing metrics response: %v", err)
	}
}

// handleRequestHistory handles request history requests
func (p *Proxy) handleRequestHistory(w http.ResponseWriter, r *http.Request) {
	// Add CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma, Expires")

	// Handle preflight requests
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	data, err := p.history.GetRecordsJSON()
	if err != nil {
		http.Error(w, "Failed to get request history", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(data); err != nil {
		log.Printf("Error writing request history response: %v", err)
	}
}

// handleRequestStats handles request stats requests
func (p *Proxy) handleRequestStats(w http.ResponseWriter, r *http.Request) {
	// Add CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma, Expires")

	// Handle preflight requests
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	stats := p.history.GetStats()
	data, err := json.Marshal(stats)
	if err != nil {
		http.Error(w, "Failed to get request stats", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(data); err != nil {
		log.Printf("Error writing request stats response: %v", err)
	}
}

// handleClearHistory handles request history clearing requests
func (p *Proxy) handleClearHistory(w http.ResponseWriter, r *http.Request) {
	// Add CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Pragma, Expires")

	// Handle preflight requests
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p.history.Clear()

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write([]byte(`{"success": true, "message": "Request history cleared"}`)); err != nil {
		log.Printf("Error writing clear history response: %v", err)
	}
}

// Start starts the proxy server and admin server (if configured)
func (p *Proxy) Start() error {
	if p.server == nil {
		return fmt.Errorf("server not initialized")
	}

	// Start admin server in background if configured
	if p.adminServer != nil {
		go func() {
			log.Printf("Starting admin server on port %d", p.config.AdminPort)
			if err := p.adminServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Printf("Admin server error: %v", err)
			}
		}()
	}

	// Start dashboard server in background if configured
	if p.dashboardServer != nil {
		go func() {
			log.Printf("Starting dashboard server on port %d", p.config.DashboardPort)
			if err := p.dashboardServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Printf("Dashboard server error: %v", err)
			}
		}()
	}

	log.Printf("Starting proxy server on port %d", p.config.Port)
	return p.server.ListenAndServe()
}

// Stop stops both the proxy server and admin server
func (p *Proxy) Stop() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	p.inspectionMu.Lock()
	p.inspectionStopped = true
	for conn := range p.inspectionConns {
		_ = conn.Close()
	}
	p.inspectionMu.Unlock()
	p.inspectionTransport.CloseIdleConnections()

	var proxyErr, adminErr, dashboardErr error

	if p.server != nil {
		proxyErr = p.server.Shutdown(ctx)
	}

	if p.adminServer != nil {
		adminErr = p.adminServer.Shutdown(ctx)
	}

	if p.dashboardServer != nil {
		dashboardErr = p.dashboardServer.Shutdown(ctx)
	}

	// Return the first error encountered
	if proxyErr != nil {
		return fmt.Errorf("proxy server shutdown error: %v", proxyErr)
	}
	if adminErr != nil {
		return fmt.Errorf("admin server shutdown error: %v", adminErr)
	}
	if dashboardErr != nil {
		return fmt.Errorf("dashboard server shutdown error: %v", dashboardErr)
	}

	return nil
}

// generateID generates a random ID for request tracking
func generateID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		// Fallback to timestamp-based ID if random fails
		return fmt.Sprintf("req_%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(bytes)
}

// captureRequestBody safely reads and captures the request body
func captureRequestBody(r *http.Request) (string, int64, io.Reader) {
	if r.Body == nil {
		return "", 0, nil
	}

	// Read the body
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		return "", 0, r.Body
	}

	// Close the original body
	if err := r.Body.Close(); err != nil {
		log.Printf("Error closing request body: %v", err)
	}

	// Create new readers for the proxy and for capture
	r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

	// Return captured data and size
	return string(bodyBytes), int64(len(bodyBytes)), io.NopCloser(bytes.NewReader(bodyBytes))
}

// captureResponseBody safely reads and captures the response body
func captureResponseBody(resp *http.Response) (string, int64, error) {
	if resp.Body == nil {
		return "", 0, nil
	}

	// Read the body
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", 0, err
	}

	// Close the original body
	if err := resp.Body.Close(); err != nil {
		log.Printf("Error closing response body: %v", err)
	}

	// Replace with a new reader for downstream consumption
	resp.Body = io.NopCloser(bytes.NewReader(bodyBytes))

	return string(bodyBytes), int64(len(bodyBytes)), nil
}

// convertHeaders converts http.Header to map[string]string for JSON serialization
func convertHeaders(headers http.Header) map[string]string {
	result := make(map[string]string)
	for key, values := range headers {
		if len(values) > 0 {
			result[key] = values[0] // Take first value if multiple
		}
	}
	return result
}
