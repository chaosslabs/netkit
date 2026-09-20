package proxy

import (
	"bufio"
	"bytes"
	"crypto/tls"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"sync"
	"time"
)

// bufferedConn preserves bytes already read by the outer CONNECT HTTP server.
type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *bufferedConn) Read(b []byte) (int, error) { return c.reader.Read(b) }

type inspectionConn struct {
	net.Conn
	done chan struct{}
	once sync.Once
}

func (c *inspectionConn) Close() error {
	err := c.Conn.Close()
	c.once.Do(func() { close(c.done) })
	return err
}

type singleConnListener struct {
	conn     net.Conn
	done     <-chan struct{}
	accepted bool
}

func (l *singleConnListener) Accept() (net.Conn, error) {
	if !l.accepted {
		l.accepted = true
		return l.conn, nil
	}
	<-l.done
	return nil, net.ErrClosed
}
func (l *singleConnListener) Close() error   { return l.conn.Close() }
func (l *singleConnListener) Addr() net.Addr { return l.conn.LocalAddr() }

func (p *Proxy) handleInspectedConnect(w http.ResponseWriter, r *http.Request) {
	host, _, err := net.SplitHostPort(r.Host)
	if err != nil || host == "" {
		http.Error(w, "CONNECT requires host:port", http.StatusBadRequest)
		return
	}
	cert, err := p.config.InspectionCA.certificate(host)
	if err != nil {
		http.Error(w, "Cannot create inspection certificate", http.StatusBadGateway)
		return
	}
	h, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "Hijacking unavailable", http.StatusInternalServerError)
		return
	}
	conn, rw, err := h.Hijack()
	if err != nil {
		return
	}
	defer func() {
		if err := conn.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			log.Printf("Inspection connection close: %v", err)
		}
	}()
	p.inspectionMu.Lock()
	if p.inspectionStopped {
		p.inspectionMu.Unlock()
		return
	}
	p.inspectionConns[conn] = struct{}{}
	p.inspectionMu.Unlock()
	defer func() { p.inspectionMu.Lock(); delete(p.inspectionConns, conn); p.inspectionMu.Unlock() }()
	if _, err = rw.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		return
	}
	if err = rw.Flush(); err != nil {
		return
	}
	// Node fetch also uses CONNECT for plain HTTP. Preserve that behavior.
	if err = conn.SetReadDeadline(time.Now().Add(15 * time.Second)); err != nil {
		return
	}
	first, err := rw.Peek(1)
	if err != nil {
		return
	}
	if err = conn.SetReadDeadline(time.Time{}); err != nil {
		return
	}
	tracked := &inspectionConn{Conn: &bufferedConn{Conn: conn, reader: rw.Reader}, done: make(chan struct{})}
	var inner net.Conn = tracked
	scheme := "http"
	if first[0] == 22 {
		scheme = "https"
		inner = tls.Server(tracked, &tls.Config{Certificates: []tls.Certificate{*cert}, MinVersion: tls.VersionTLS12, NextProtos: []string{"http/1.1"}})
	}
	server := &http.Server{ReadHeaderTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, innerReq *http.Request) {
		if innerReq.Method == http.MethodConnect {
			http.Error(w, "Nested CONNECT unsupported", http.StatusBadRequest)
			return
		}
		p.inspectHTTP(w, innerReq, scheme, r.Host)
	})}
	listener := &singleConnListener{conn: inner, done: tracked.done}
	if err := server.Serve(listener); err != nil && err != net.ErrClosed && err != http.ErrServerClosed {
		log.Printf("Inspection server: %v", err)
	}
}

// synchronizedCapture records bytes as the transport consumes them. Response data
// is forwarded immediately (including SSE), and the completed exchange is saved
// when the handler returns. Upload reads may run in a transport goroutine.
type synchronizedCapture struct {
	mu    sync.Mutex
	data  bytes.Buffer
	total int64
}

func (c *synchronizedCapture) Write(b []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.total += int64(len(b))
	if remaining := maxCaptureBytes + 1 - c.data.Len(); remaining > 0 {
		_, _ = c.data.Write(b[:min(len(b), remaining)])
	}
	return len(b), nil
}
func (c *synchronizedCapture) snapshot() (string, int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.data.String(), c.total
}

type captureReadCloser struct {
	io.Reader
	io.Closer
}

func (p *Proxy) inspectHTTP(w http.ResponseWriter, r *http.Request, scheme, authority string) {
	start := time.Now()
	record := RequestRecord{ID: generateID(), Timestamp: start, ProxyStartTime: start, Method: r.Method, RequestHeaders: convertHeaders(r.Header)}
	target := *r.URL
	target.Scheme = scheme
	target.Host = authority
	record.URL = target.String()
	var requestBody, responseBody synchronizedCapture
	defer func() {
		record.RequestBody, record.RequestSize = requestBody.snapshot()
		record.ResponseBody, record.ResponseSize = responseBody.snapshot()
		record.ProxyEndTime = time.Now()
		p.history.AddRecord(record)
	}()
	if r.Header.Get("Upgrade") != "" {
		record.Error = "Protocol upgrades are not supported in inspection mode"
		record.Outcome = "blocked_by_inspection"
		record.ResponseSource = "proxy"
		record.ResponseStatus = http.StatusNotImplemented
		http.Error(w, record.Error, record.ResponseStatus)
		return
	}
	if r.Body != nil {
		r.Body = &captureReadCloser{Reader: io.TeeReader(r.Body, &requestBody), Closer: r.Body}
	}
	forward := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.Out.URL.Scheme = scheme
			pr.Out.URL.Host = authority
			pr.Out.Host = authority
			pr.Out.Header.Del("Proxy-Authorization")
			pr.Out.Header.Del("Proxy-Connection")
			record.UpstreamStartTime = time.Now()
		},
		Transport:     p.inspectionTransport,
		FlushInterval: -1,
		ModifyResponse: func(resp *http.Response) error {
			record.UpstreamEndTime = time.Now()
			record.ResponseStatus = resp.StatusCode
			record.ResponseHeaders = convertHeaders(resp.Header)
			record.Success = true
			record.Outcome = "complete"
			record.ResponseSource = "upstream"
			resp.Body = &captureReadCloser{Reader: io.TeeReader(resp.Body, &responseBody), Closer: resp.Body}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			record.UpstreamEndTime = time.Now()
			record.Error = "Upstream request failed"
			record.Outcome = "upstream_error"
			record.FailureReason = failureReason(err)
			if r.Context().Err() != nil {
				record.Outcome = "client_canceled"
			}
			record.ResponseSource = "proxy"
			record.ResponseStatus = http.StatusBadGateway
			http.Error(w, "Upstream request failed", http.StatusBadGateway)
		},
	}
	// ReverseProxy aborts a partially written response on stream failure. Preserve
	// that behavior while recording the failed exchange instead of a false success.
	defer func() {
		if v := recover(); v != nil {
			record.Success = false
			record.Error = "Response stream interrupted"
			record.Outcome = "interrupted"
			if r.Context().Err() != nil {
				record.Outcome = "client_canceled"
			}
			panic(v)
		}
	}()
	forward.ServeHTTP(w, r)
}
