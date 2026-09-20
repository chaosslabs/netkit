package proxy

import (
	"encoding/json"
	"net"
	"net/url"
	"regexp"
	"strings"
)

const redacted = "[REDACTED]"
const omittedBody = "[Body omitted: only complete JSON up to 64 KiB is retained]"
const maxCaptureBytes = 64 * 1024

var credentialPattern = regexp.MustCompile(`(?i)(bearer\s+)[a-z0-9._~+/-]+=*|bot[0-9]+:[a-z0-9_-]+|\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+`)

func sensitiveField(key string, extra []string) bool {
	key = strings.ToLower(strings.NewReplacer("-", "", "_", "", " ", "").Replace(key))
	for _, part := range []string{"authorization", "cookie", "password", "passwd", "secret", "token", "apikey", "credential", "privatekey"} {
		if strings.Contains(key, part) {
			return true
		}
	}
	for _, field := range extra {
		if key == strings.ToLower(strings.NewReplacer("-", "", "_", "", " ", "").Replace(strings.TrimSpace(field))) {
			return true
		}
	}
	return false
}

func redactText(value string) string { return credentialPattern.ReplaceAllString(value, redacted) }

func redactURL(value string) string {
	if host, port, err := net.SplitHostPort(value); err == nil && !strings.ContainsAny(value, "/@?#") {
		return net.JoinHostPort(host, port)
	}
	u, err := url.Parse(value)
	if err != nil {
		return redacted
	}
	if u.User != nil {
		u.User = url.User(redacted)
	}
	u.Fragment = ""
	// Every query value is private by default, including keys unknown to Netkit.
	if u.RawQuery != "" {
		q, err := url.ParseQuery(u.RawQuery)
		if err != nil {
			u.RawQuery = "redacted"
		} else {
			for k := range q {
				q[k] = []string{redacted}
			}
			u.RawQuery = q.Encode()
		}
	}
	segments := strings.Split(u.Path, "/")
	previousSensitive := false
	for i, segment := range segments {
		sensitive := sensitiveField(segment, nil)
		if previousSensitive || strings.Contains(segment, ":") || len(segment) > 32 {
			segments[i] = redacted
		} else {
			segments[i] = redactText(segment)
		}
		previousSensitive = sensitive
	}
	u.Path, u.RawPath = strings.Join(segments, "/"), ""
	return u.String()
}

func redactHeaders(headers map[string]string, fields []string) map[string]string {
	result := make(map[string]string, len(headers))
	for key, value := range headers {
		switch {
		case sensitiveField(key, fields):
			result[key] = redacted
		case strings.EqualFold(key, "X-Netkit-Destination"), strings.EqualFold(key, "Location"), strings.EqualFold(key, "Referer"):
			result[key] = redactURL(value)
		default:
			result[key] = redactText(value)
		}
	}
	return result
}

func redactBody(body string, fields []string) string {
	if body == "" {
		return ""
	}
	if len(body) > maxCaptureBytes {
		return omittedBody
	}
	var data interface{}
	decoder := json.NewDecoder(strings.NewReader(body))
	decoder.UseNumber()
	if !json.Valid([]byte(body)) || decoder.Decode(&data) != nil {
		return omittedBody
	}
	var visit func(interface{}) interface{}
	visit = func(value interface{}) interface{} {
		switch v := value.(type) {
		case map[string]interface{}:
			for k, item := range v {
				if sensitiveField(k, fields) {
					v[k] = redacted
				} else {
					v[k] = visit(item)
				}
			}
		case []interface{}:
			for i, item := range v {
				v[i] = visit(item)
			}
		case string:
			if strings.HasPrefix(v, "http://") || strings.HasPrefix(v, "https://") {
				return redactURL(v)
			}
			return redactText(v)
		}
		return value
	}
	encoded, err := json.Marshal(visit(data))
	if err != nil {
		return omittedBody
	}
	return string(encoded)
}

func sanitizeRecord(record RequestRecord, fields []string) RequestRecord {
	record.URL = redactURL(record.URL)
	record.RequestHeaders = redactHeaders(record.RequestHeaders, fields)
	record.ResponseHeaders = redactHeaders(record.ResponseHeaders, fields)
	record.RequestBody = redactBody(record.RequestBody, fields)
	record.ResponseBody = redactBody(record.ResponseBody, fields)
	// Errors are controlled messages; transport errors can embed raw target URLs.
	if record.Error != "" {
		record.Error = outcomeDescription(record.Outcome)
		if record.FailureReason == "tls_certificate" {
			record.Error += ": origin certificate verification failed"
		}
		if record.FailureReason == "timeout" {
			record.Error += ": timeout"
		}
	}
	return record
}
