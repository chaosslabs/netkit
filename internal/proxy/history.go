package proxy

import (
	"encoding/json"
	"sync"
	"time"
)

// RequestRecord represents a single HTTP request and response through the proxy
type RequestRecord struct {
	ID              string            `json:"id"`
	Timestamp       time.Time         `json:"timestamp"`
	Method          string            `json:"method"`
	URL             string            `json:"url"`
	RequestHeaders  map[string]string `json:"request_headers"`
	RequestBody     string            `json:"request_body,omitempty"`
	ResponseStatus  int               `json:"response_status"`
	ResponseHeaders map[string]string `json:"response_headers"`
	ResponseBody    string            `json:"response_body,omitempty"`

	// Timing metrics
	ProxyStartTime    time.Time `json:"proxy_start_time"`
	UpstreamStartTime time.Time `json:"upstream_start_time"`
	UpstreamEndTime   time.Time `json:"upstream_end_time"`
	ProxyEndTime      time.Time `json:"proxy_end_time"`

	// Calculated metrics (in microseconds for better precision)
	ProxyOverheadUs   int64 `json:"proxy_overhead_us"`   // Legacy residual: total minus time to headers; includes body transfer, NOT CPU overhead
	UpstreamLatencyUs int64 `json:"upstream_latency_us"` // Time to response headers (or failed upstream attempt); not full body latency
	TotalDurationUs   int64 `json:"total_duration_us"`   // Total time from client perspective (microseconds)

	// Size metrics
	RequestSize  int64 `json:"request_size"`
	ResponseSize int64 `json:"response_size"`

	// Status
	FailureReason  string `json:"failure_reason,omitempty"`
	Outcome        string `json:"outcome"`
	ResponseSource string `json:"response_source"`
	Success        bool   `json:"success"`
	Error          string `json:"error,omitempty"`
}

// RequestHistory manages the collection of request records
type RequestHistory struct {
	records      []RequestRecord
	mutex        sync.RWMutex
	maxSize      int
	redactFields []string
	signals      map[string]*signalSeries
	observed     uint64
}

// NewRequestHistory creates a new request history with the specified maximum size
func NewRequestHistory(maxSize int) *RequestHistory {
	return &RequestHistory{
		records: make([]RequestRecord, 0),
		maxSize: maxSize,
		signals: make(map[string]*signalSeries),
	}
}

// AddRecord adds a new request record to the history
func (h *RequestHistory) AddRecord(record RequestRecord) {
	h.mutex.Lock()
	defer h.mutex.Unlock()

	normalizeRecord(&record)
	h.observe(record)
	record = sanitizeRecord(record, h.redactFields)

	// Add to beginning of slice (most recent first)
	h.records = append([]RequestRecord{record}, h.records...)

	// Trim to max size
	if len(h.records) > h.maxSize {
		h.records = h.records[:h.maxSize]
	}
}

// GetRecords returns all records (most recent first)
func (h *RequestHistory) GetRecords() []RequestRecord {
	h.mutex.RLock()
	defer h.mutex.RUnlock()

	// Return a copy to avoid race conditions
	result := make([]RequestRecord, len(h.records))
	for i, record := range h.records {
		result[i] = record
		result[i].RequestHeaders = redactHeaders(record.RequestHeaders, h.redactFields)
		result[i].ResponseHeaders = redactHeaders(record.ResponseHeaders, h.redactFields)
	}
	return result
}

// GetRecordsJSON returns all records as JSON
func (h *RequestHistory) GetRecordsJSON() ([]byte, error) {
	records := h.GetRecords()
	return json.Marshal(map[string]interface{}{
		"records":  records,
		"total":    len(records),
		"capacity": h.maxSize,
		"scope":    "retained_buffer",
	})
}

// Clear removes all records
func (h *RequestHistory) Clear() {
	h.mutex.Lock()
	defer h.mutex.Unlock()
	h.records = h.records[:0]
}

// GetStats returns aggregated statistics
func (h *RequestHistory) GetStats() map[string]interface{} {
	h.mutex.RLock()
	defer h.mutex.RUnlock()

	if len(h.records) == 0 {
		return map[string]interface{}{
			"total_requests": 0, "success_count": 0, "error_count": 0,
			"avg_duration_us": 0, "avg_upstream_latency_us": 0, "avg_proxy_overhead_us": 0,
			"total_request_size": 0, "total_response_size": 0,
			"scope": "retained_buffer", "capacity": h.maxSize,
		}
	}

	var totalDuration, totalUpstreamLatency, totalProxyOverhead int64
	var totalRequestSize, totalResponseSize int64
	var successCount, errorCount int
	statusCounts := make(map[int]int)
	methodCounts := make(map[string]int)
	outcomeCounts := make(map[string]int)
	var oldest, newest time.Time

	for _, record := range h.records {
		outcomeCounts[record.Outcome]++
		if oldest.IsZero() || record.Timestamp.Before(oldest) {
			oldest = record.Timestamp
		}
		if record.Timestamp.After(newest) {
			newest = record.Timestamp
		}
		totalDuration += record.TotalDurationUs
		totalUpstreamLatency += record.UpstreamLatencyUs
		totalProxyOverhead += record.ProxyOverheadUs
		totalRequestSize += record.RequestSize
		totalResponseSize += record.ResponseSize

		if record.Success {
			successCount++
		} else {
			errorCount++
		}

		if record.ResponseSource == "upstream" && record.ResponseStatus > 0 {
			statusCounts[record.ResponseStatus]++
		}
		methodCounts[record.Method]++
	}

	count := len(h.records)
	return map[string]interface{}{
		"total_requests": count,
		"outcomes":       outcomeCounts, "scope": "retained_buffer", "capacity": h.maxSize,
		"oldest_at": oldest, "newest_at": newest,
		"success_count":           successCount,
		"error_count":             errorCount,
		"avg_duration_us":         totalDuration / int64(count),
		"avg_upstream_latency_us": totalUpstreamLatency / int64(count),
		"avg_proxy_overhead_us":   totalProxyOverhead / int64(count),
		"total_request_size":      totalRequestSize,
		"total_response_size":     totalResponseSize,
		"status_codes":            statusCounts,
		"methods":                 methodCounts,
	}
}
