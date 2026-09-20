package proxy

import (
	"bufio"
	"crypto/tls"
	"crypto/x509"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func inspectionCA(t *testing.T) (*CertificateAuthority, *x509.CertPool) {
	t.Helper()
	cert, key, err := GenerateCA()
	require.NoError(t, err)
	dir := t.TempDir()
	cp, kp := filepath.Join(dir, "ca.pem"), filepath.Join(dir, "key.pem")
	require.NoError(t, os.WriteFile(cp, cert, 0600))
	require.NoError(t, os.WriteFile(kp, key, 0600))
	ca, err := LoadCA(cp, kp)
	require.NoError(t, err)
	roots := x509.NewCertPool()
	require.True(t, roots.AppendCertsFromPEM(cert))
	return ca, roots
}

func inspectionClient(t *testing.T, upstream *httptest.Server) (*Proxy, *http.Client, string) {
	t.Helper()
	ca, roots := inspectionCA(t)
	p := New(&Config{InspectionCA: ca})
	// Trust this test origin explicitly; real origins use the system roots.
	p.inspectionTransport.TLSClientConfig = &tls.Config{RootCAs: x509.NewCertPool(), MinVersion: tls.VersionTLS12}
	p.inspectionTransport.TLSClientConfig.RootCAs.AddCert(upstream.Certificate())
	server := httptest.NewServer(p)
	t.Cleanup(func() { require.NoError(t, p.Stop()); server.Close() })
	u, err := url.Parse(server.URL)
	require.NoError(t, err)
	tr := &http.Transport{Proxy: http.ProxyURL(u), TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}}
	t.Cleanup(tr.CloseIdleConnections)
	return p, &http.Client{Transport: tr, Timeout: 3 * time.Second}, server.URL
}

func waitRecords(t *testing.T, p *Proxy, count int) []RequestRecord {
	t.Helper()
	require.Eventually(t, func() bool { return len(p.history.GetRecords()) >= count }, time.Second, time.Millisecond)
	return p.history.GetRecords()
}

func TestInspectionCapturesHTTPSBodiesAndReusesConnection(t *testing.T) {
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		require.Equal(t, "secret-for-test", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(201)
		_, err = w.Write(append([]byte("response:"), b...))
		require.NoError(t, err)
	}))
	defer upstream.Close()
	p, c, _ := inspectionClient(t, upstream)
	for i := 0; i < 2; i++ {
		req, err := http.NewRequest(http.MethodPost, upstream.URL+"/body?q=test", strings.NewReader(`{"hello":"world"}`))
		require.NoError(t, err)
		req.Header.Set("Authorization", "secret-for-test")
		resp, err := c.Do(req)
		require.NoError(t, err)
		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		require.Equal(t, 201, resp.StatusCode)
		require.Equal(t, `response:{"hello":"world"}`, string(body))
	}
	records := waitRecords(t, p, 2)
	require.Len(t, records, 2)
	for _, r := range records {
		require.Equal(t, "POST", r.Method)
		require.Equal(t, redactURL(upstream.URL+"/body?q=test"), r.URL)
		require.Equal(t, `{"hello":"world"}`, r.RequestBody)
		require.Equal(t, omittedBody, r.ResponseBody)
		require.Equal(t, 201, r.ResponseStatus)
		require.True(t, r.Success)
	}
}

func TestInspectionStreamsBeforeResponseCompletes(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, err := io.WriteString(w, "data: first\n\n")
		require.NoError(t, err)
		w.(http.Flusher).Flush()
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer upstream.Close()
	p, c, _ := inspectionClient(t, upstream)
	resp, err := c.Get(upstream.URL + "/stream")
	require.NoError(t, err)
	line, err := bufio.NewReader(resp.Body).ReadString('\n')
	require.NoError(t, err)
	require.Equal(t, "data: first\n", line)
	// Closing the downstream stream must cancel the upstream and record capture.
	require.NoError(t, resp.Body.Close())
	r := waitRecords(t, p, 1)[0]
	require.Equal(t, omittedBody, r.ResponseBody)
}

func TestInspectionVerifiesOriginCertificate(t *testing.T) {
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("untrusted origin must not receive a request") }))
	defer upstream.Close()
	p, c, _ := inspectionClient(t, upstream)
	p.inspectionTransport.TLSClientConfig.RootCAs = x509.NewCertPool()
	resp, err := c.Get(upstream.URL)
	require.NoError(t, err)
	require.Equal(t, 502, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	r := waitRecords(t, p, 1)[0]
	require.False(t, r.Success)
	require.Contains(t, r.Error, "certificate")
}

func TestInspectionRequiresClientTrust(t *testing.T) {
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("untrusted client must not reach upstream") }))
	defer upstream.Close()
	_, c, _ := inspectionClient(t, upstream)
	c.Transport.(*http.Transport).TLSClientConfig.RootCAs = x509.NewCertPool()
	_, err := c.Get(upstream.URL)
	require.Error(t, err)
	require.Contains(t, err.Error(), "certificate")
}

func TestInspectionPlaintextCONNECT(t *testing.T) {
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer upstream.Close()
	p, _, proxyURL := inspectionClient(t, upstream)
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := io.WriteString(w, "plain-body")
		require.NoError(t, err)
	}))
	defer plain.Close()
	origin, err := url.Parse(plain.URL)
	require.NoError(t, err)
	proxyAddr := strings.TrimPrefix(proxyURL, "http://")
	conn, err := net.Dial("tcp", proxyAddr)
	require.NoError(t, err)
	defer func() { require.NoError(t, conn.Close()) }()
	require.NoError(t, conn.SetDeadline(time.Now().Add(3*time.Second)))
	// Pipeline the request with CONNECT to verify buffered bytes are preserved.
	_, err = io.WriteString(conn, "CONNECT "+origin.Host+" HTTP/1.1\r\nHost: "+origin.Host+"\r\n\r\nGET /plain HTTP/1.1\r\nHost: "+origin.Host+"\r\nConnection: close\r\n\r\n")
	require.NoError(t, err)
	reader := bufio.NewReader(conn)
	connect, err := http.ReadResponse(reader, &http.Request{Method: "CONNECT"})
	require.NoError(t, err)
	require.Equal(t, 200, connect.StatusCode)
	resp, err := http.ReadResponse(reader, &http.Request{Method: "GET"})
	require.NoError(t, err)
	b, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, "plain-body", string(b))
	r := waitRecords(t, p, 1)[0]
	require.Equal(t, plain.URL+"/plain", r.URL)
	require.Equal(t, omittedBody, r.ResponseBody)
}

func TestInspectionPreservesRedirectsAndOptions(t *testing.T) {
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		w.Header().Set("Location", "/next")
		w.WriteHeader(302)
	}))
	defer upstream.Close()
	p, c, _ := inspectionClient(t, upstream)
	c.CheckRedirect = func(r *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := c.Get(upstream.URL)
	require.NoError(t, err)
	require.Equal(t, 302, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	req, err := http.NewRequest("OPTIONS", upstream.URL, nil)
	require.NoError(t, err)
	resp, err = c.Do(req)
	require.NoError(t, err)
	require.Equal(t, 204, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	require.Len(t, waitRecords(t, p, 2), 2)
}

func TestInspectionCertificateDNSAndIP(t *testing.T) {
	ca, roots := inspectionCA(t)
	for _, host := range []string{"api.example.com", "127.0.0.1", "::1"} {
		cert, err := ca.certificate(host)
		require.NoError(t, err)
		leaf, err := x509.ParseCertificate(cert.Certificate[0])
		require.NoError(t, err)
		_, err = leaf.Verify(x509.VerifyOptions{Roots: roots, DNSName: host})
		require.NoError(t, err)
	}
	ca.cert.NotAfter = time.Now().Add(-time.Second)
	_, err := ca.certificate("example.com")
	require.Error(t, err)
}

func TestInspectionStopClosesIdleTunnels(t *testing.T) {
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	defer upstream.Close()
	p, c, _ := inspectionClient(t, upstream)
	resp, err := c.Get(upstream.URL)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	require.NoError(t, p.Stop())
	require.Eventually(t, func() bool { p.inspectionMu.Lock(); defer p.inspectionMu.Unlock(); return len(p.inspectionConns) == 0 }, time.Second, time.Millisecond)
}

func TestInspectionLongPolling(t *testing.T) {
	pollDelay := 100 * time.Millisecond
	if os.Getenv("NETKIT_LONG_POLL_TEST") == "1" {
		pollDelay = 31 * time.Second
	}
	for _, tc := range []struct {
		name    string
		timeout time.Duration
		status  int
	}{
		{"default permits delayed headers", 0, 200},
		{"explicit deadline is enforced", 20 * time.Millisecond, 502},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				select {
				case <-time.After(pollDelay):
					_, err := io.WriteString(w, "poll-result")
					require.NoError(t, err)
				case <-r.Context().Done():
				}
			}))
			defer upstream.Close()
			p, c, _ := inspectionClient(t, upstream)
			c.Timeout = 40 * time.Second
			// Check the default separately so a fixed deadline regression cannot pass
			// merely because this test uses a short simulated polling interval.
			require.Zero(t, p.inspectionTransport.ResponseHeaderTimeout)
			p.inspectionTransport.ResponseHeaderTimeout = tc.timeout
			resp, err := c.Get(upstream.URL + "/poll")
			require.NoError(t, err)
			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)
			require.NoError(t, resp.Body.Close())
			require.Equal(t, tc.status, resp.StatusCode)
			record := waitRecords(t, p, 1)[0]
			if tc.status == 200 {
				require.Equal(t, "poll-result", string(body))
				require.Equal(t, omittedBody, record.ResponseBody)
			} else {
				require.False(t, record.Success)
				require.Contains(t, record.Error, "timeout")
			}
		})
	}
}

func TestInspectionTimeoutConfiguration(t *testing.T) {
	p := New(&Config{InspectionResponseHeaderTimeout: 90 * time.Second})
	require.Equal(t, 90*time.Second, p.inspectionTransport.ResponseHeaderTimeout)
	require.NoError(t, p.Stop())
}
