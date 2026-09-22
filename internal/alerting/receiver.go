package alerting

import (
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Rule struct{ Title, Signal, Unit string }

var Rules = map[string]Rule{
	"NetkitUpstreamFailureRate":  {"Sustained upstream HTTP 5xx", "http5xx", "fraction of HTTP observations"},
	"NetkitTransportFailureRate": {"Sustained proxy or upstream connection failures", "transport", "fraction of HTTP observations"},
	"NetkitHeaderLatencyHigh":    {"High time to response headers (ordinary profile)", "headers", "seconds"},
	"NetkitUnavailable":          {"Netkit scrape unavailable", "", "scrape up"},
	"NetkitInsufficientSamples":  {"Insufficient samples; health is unknown", "", "HTTP observations"},
}

type Config struct {
	Dir, Token, Instance, AdminURL, DashboardURL string
	Capacity                                     int
	TTL                                          time.Duration
}
type Incident struct {
	ID            string     `json:"id"`
	Rule          string     `json:"rule"`
	Status        string     `json:"status"`
	Started       time.Time  `json:"started"`
	Created       time.Time  `json:"created"`
	Updated       time.Time  `json:"updated"`
	EndsAt        time.Time  `json:"ends_at,omitempty"`
	From          time.Time  `json:"from"`
	To            time.Time  `json:"to"`
	Observed      *float64   `json:"observed,omitempty"`
	Threshold     *float64   `json:"threshold,omitempty"`
	EvidenceState string     `json:"evidence_state"`
	Matching      int        `json:"matching_retained"`
	Evidence      []Evidence `json:"evidence"`
}
type Receiver struct {
	mu     sync.Mutex
	config Config
	client *http.Client
	now    func() time.Time
}

func New(config Config) (*Receiver, error) {
	if len(config.Token) < 16 {
		return nil, errors.New("incident webhook token must contain at least 16 characters")
	}
	if config.Instance == "" || len(config.Instance) > 128 {
		return nil, errors.New("instance alias required (up to 128 characters)")
	}
	if config.Capacity < 1 || config.Capacity > 1000 || config.TTL < time.Minute || config.TTL > 30*24*time.Hour {
		return nil, errors.New("incident capacity must be 1–1000 and TTL 1 minute–30 days")
	}
	for _, raw := range []string{config.AdminURL, config.DashboardURL} {
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return nil, errors.New("admin/dashboard URLs must be HTTP(S), without credentials, query or fragment")
		}
	}
	if err := os.MkdirAll(config.Dir, 0700); err != nil {
		return nil, err
	}
	info, err := os.Stat(config.Dir)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("incident directory must be private (mode 0700)")
	}
	return &Receiver{config: config, now: time.Now, client: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (r *Receiver) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/webhook", r.webhook)
	mux.HandleFunc("/", r.view)
	return mux
}
func (r *Receiver) Prune() error { r.mu.Lock(); defer r.mu.Unlock(); _, err := r.load(); return err }

// load enforces both bounds. No labels or request content can become filesystem paths.
func (r *Receiver) load() ([]Incident, error) {
	entries, err := os.ReadDir(r.config.Dir)
	if err != nil {
		return nil, err
	}
	incidents := make([]Incident, 0)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || len(entry.Name()) != 69 {
			continue
		}
		if _, err := hex.DecodeString(strings.TrimSuffix(entry.Name(), ".json")); err != nil {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() || info.Size() > 128*1024 {
			continue
		}
		path := filepath.Join(r.config.Dir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var incident Incident
		if err = json.Unmarshal(data, &incident); err != nil {
			return nil, errors.New("invalid incident file")
		}
		if incident.ID != strings.TrimSuffix(entry.Name(), ".json") {
			return nil, errors.New("incident filename mismatch")
		}
		if r.now().Sub(incident.Created) >= r.config.TTL {
			if err := os.Remove(path); err != nil {
				return nil, err
			}
			continue
		}
		incidents = append(incidents, incident)
	}
	sort.Slice(incidents, func(i, j int) bool { return incidents[i].Created.After(incidents[j].Created) })
	for len(incidents) > r.config.Capacity {
		last := incidents[len(incidents)-1]
		if err := os.Remove(filepath.Join(r.config.Dir, last.ID+".json")); err != nil {
			return nil, err
		}
		incidents = incidents[:len(incidents)-1]
	}
	return incidents, nil
}
func (r *Receiver) save(incident Incident) error {
	data, err := json.Marshal(incident)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(r.config.Dir, ".incident-")
	if err != nil {
		return err
	}
	name := file.Name()
	defer func() { _ = os.Remove(name) }()
	if _, err = file.Write(data); err != nil {
		_ = file.Close()
		return err
	}
	if err = file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(name, filepath.Join(r.config.Dir, incident.ID+".json"))
}
func number(value string) *float64 {
	n, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
		return nil
	}
	return &n
}

type webhookAlert struct {
	Status      string            `json:"status"`
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	StartsAt    time.Time         `json:"startsAt"`
	EndsAt      time.Time         `json:"endsAt"`
}

func (r *Receiver) webhook(w http.ResponseWriter, req *http.Request) {
	if req.Method != "POST" {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", 405)
		return
	}
	if subtle.ConstantTimeCompare([]byte(req.Header.Get("Authorization")), []byte("Bearer "+r.config.Token)) != 1 {
		http.Error(w, "unauthorized", 401)
		return
	}
	var payload struct {
		Alerts []webhookAlert `json:"alerts"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, req.Body, 1<<20))
	if err := decoder.Decode(&payload); err != nil || len(payload.Alerts) == 0 || len(payload.Alerts) > 8 {
		http.Error(w, "invalid webhook", 400)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		http.Error(w, "invalid webhook", 400)
		return
	}
	for _, alert := range payload.Alerts {
		if _, ok := Rules[alert.Labels["alertname"]]; !ok || alert.Labels["job"] != "netkit" || alert.Labels["instance"] != r.config.Instance || alert.StartsAt.IsZero() || alert.StartsAt.After(r.now().Add(time.Minute)) || (alert.Status != "firing" && alert.Status != "resolved") || (alert.Status == "resolved" && (alert.EndsAt.IsZero() || alert.EndsAt.Before(alert.StartsAt))) {
			http.Error(w, "unsupported alert scope or lifecycle", 400)
			return
		}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	incidents, err := r.load()
	if err != nil {
		http.Error(w, "incident storage unavailable", 503)
		return
	}
	existing := make(map[string]Incident)
	for _, i := range incidents {
		existing[i.ID] = i
	}
	for _, alert := range payload.Alerts {
		name := alert.Labels["alertname"]
		hash := sha256.Sum256([]byte(name + "\n" + r.config.Instance + "\n" + alert.StartsAt.UTC().Format(time.RFC3339Nano)))
		id := hex.EncodeToString(hash[:])
		incident, exists := existing[id]
		if !exists {
			incident = Incident{ID: id, Rule: name, Status: alert.Status, Started: alert.StartsAt, Created: r.now(), From: alert.StartsAt.Add(-5 * time.Minute), To: r.now(), Evidence: []Evidence{}, EvidenceState: "not_applicable"}
			// Capture the first notification's retained evidence once, before eviction can change it.
			if Rules[name].Signal != "" {
				r.capture(&incident, Rules[name].Signal)
			}
		}
		// An out-of-order firing retry must not reopen an already resolved incident.
		if incident.Status != "resolved" || alert.Status == "resolved" {
			incident.Status = alert.Status
			incident.Updated = r.now()
			if alert.Status == "resolved" {
				incident.EndsAt = alert.EndsAt
			}
			if incident.Observed == nil {
				incident.Observed = number(alert.Annotations["value"])
			}
			if incident.Threshold == nil {
				incident.Threshold = number(alert.Annotations["threshold"])
			}
		}
		if err := r.save(incident); err != nil {
			http.Error(w, "incident storage unavailable", 503)
			return
		}
		existing[id] = incident
	}
	if _, err := r.load(); err != nil {
		http.Error(w, "incident retention unavailable", 503)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (r *Receiver) capture(incident *Incident, signal string) {
	incident.EvidenceState = "unavailable"
	endpoint, err := url.Parse(strings.TrimRight(r.config.AdminURL, "/") + "/requests/evidence")
	if err != nil {
		return
	}
	q := url.Values{"from": {incident.From.Format(time.RFC3339Nano)}, "to": {incident.To.Format(time.RFC3339Nano)}, "signal": {signal}}
	endpoint.RawQuery = q.Encode()
	response, err := r.client.Get(endpoint.String())
	if err != nil {
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return
	}
	var data struct {
		Records  []Evidence `json:"records"`
		Matching int        `json:"matching_retained"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 128*1024)).Decode(&data); err != nil || len(data.Records) > 20 || data.Matching < len(data.Records) {
		return
	}
	for _, e := range data.Records {
		if !e.Valid() || !e.Matches(signal) || e.Timestamp.Before(incident.From) || e.Timestamp.After(incident.To) {
			return
		}
	}
	incident.Evidence = data.Records
	incident.Matching = data.Matching
	incident.EvidenceState = "captured"
	if len(data.Records) == 0 {
		incident.EvidenceState = "no_retained_matches"
	}
}
func (r *Receiver) investigate(incident Incident) string {
	u, _ := url.Parse(r.config.DashboardURL)
	u.Path = strings.TrimRight(u.Path, "/") + "/"
	u.RawQuery = url.Values{"from": {incident.From.Format(time.RFC3339Nano)}, "to": {incident.To.Format(time.RFC3339Nano)}, "signal": {Rules[incident.Rule].Signal}}.Encode()
	return u.String()
}

//go:embed incident.html
var incidentHTML string

var page = template.Must(template.New("incidents").Funcs(template.FuncMap{"when": func(value time.Time) string { return value.UTC().Format("2006-01-02 15:04:05.000 UTC") }, "retention": func(value time.Duration) string {
	if value%(24*time.Hour) == 0 {
		return fmt.Sprintf("%d days", int(value.Hours()/24))
	}
	return value.String()
}, "unit": func(name string) string { return Rules[name].Unit }, "title": func(name string) string { return Rules[name].Title }, "number": func(value *float64) string {
	if value == nil {
		return "not supplied"
	}
	return fmt.Sprintf("%.4g", *value)
}}).Parse(incidentHTML))

func (r *Receiver) view(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" || req.URL.Path != "/" {
		http.NotFound(w, req)
		return
	}
	r.mu.Lock()
	incidents, err := r.load()
	r.mu.Unlock()
	if err != nil {
		http.Error(w, "incident storage unavailable", 503)
		return
	}
	type item struct {
		Incident Incident
		Link     string
	}
	items := []item{}
	id := req.URL.Query().Get("id")
	for _, incident := range incidents {
		if id == "" || id == incident.ID {
			items = append(items, item{incident, r.investigate(incident)})
		}
	}
	empty := "No incident notifications received. This does not imply healthy monitoring."
	if id != "" && len(items) == 0 {
		empty = "Incident unavailable or expired. Check the receiver retention policy; this is not a healthy status."
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
	if id != "" && len(items) == 0 {
		w.WriteHeader(404)
	}
	_ = page.Execute(w, struct {
		Instance string
		Capacity int
		TTL      time.Duration
		Items    []item
		Empty    string
	}{r.config.Instance, r.config.Capacity, r.config.TTL, items, empty})
}
