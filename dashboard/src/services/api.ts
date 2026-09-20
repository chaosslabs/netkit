import { redactHeaders, redactBody, redactURL } from '../lib/inspection';
import { RequestConfig, ApiResponse } from '../types/api';

// Backend request record from the Go API
export interface BackendRequestRecord {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  request_headers: Record<string, string>;
  request_body?: string;
  response_status: number;
  response_headers: Record<string, string>;
  response_body?: string;
  proxy_start_time: string;
  upstream_start_time: string;
  upstream_end_time: string;
  proxy_end_time: string;
  proxy_overhead_us: number;
  upstream_latency_us: number;
  total_duration_us: number;
  request_size: number;
  response_size: number;
  outcome: string;
  response_source: string;
  failure_reason?: string;
  success: boolean;
  error?: string;
}

export interface BackendHistoryResponse {
  records: BackendRequestRecord[];
  total: number;
}

export interface RequestStats {
  scope: string;
  capacity: number;
  oldest_at?: string;
  newest_at?: string;
  outcomes?: Record<string, number>;
  total_requests: number;
  success_count: number;
  error_count: number;
  avg_duration_us: number;
  avg_upstream_latency_us: number;
  avg_proxy_overhead_us: number;
  total_request_size: number;
  total_response_size: number;
  status_codes?: Record<number, number>;
  methods?: Record<string, number>;
}

type RuntimeNetkitConfig = {
  basePath?: string;
  proxyBaseUrl?: string;
  adminBaseUrl?: string;
};

declare global {
  interface Window {
    __NETKIT_CONFIG__?: RuntimeNetkitConfig;
  }
}

const normalizeBasePath = (value?: string): string => {
  if (!value || value === '/') {
    return '';
  }

  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.replace(/\/+$/, '');
};

const joinUrl = (base: string, path: string): string => {
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
};

class ApiService {
  private proxyHost: string;
  private proxyPort: number;
  private adminPort: number;

  constructor() {
    this.proxyHost = process.env.NEXT_PUBLIC_PROXY_HOST || 'localhost';
    this.proxyPort = parseInt(process.env.NEXT_PUBLIC_PROXY_PORT || '8080');
    this.adminPort = parseInt(process.env.NEXT_PUBLIC_ADMIN_PORT || '8081');
  }

  private getRuntimeConfig(): RuntimeNetkitConfig {
    if (typeof window === 'undefined') {
      return {};
    }

    return window.__NETKIT_CONFIG__ || {};
  }

  private getPublicBasePath(): string {
    return normalizeBasePath(
      this.getRuntimeConfig().basePath ||
      process.env.NEXT_PUBLIC_NETKIT_BASE_PATH ||
      process.env.NEXT_PUBLIC_BASE_PATH
    );
  }

  private useLegacyPortUrls(): boolean {
    return process.env.NODE_ENV === 'development' ||
      Boolean(
        process.env.NEXT_PUBLIC_PROXY_HOST ||
        process.env.NEXT_PUBLIC_PROXY_PORT ||
        process.env.NEXT_PUBLIC_ADMIN_PORT
      );
  }

  private getProxyBaseUrl(): string {
    const configuredProxyUrl =
      this.getRuntimeConfig().proxyBaseUrl ||
      process.env.NEXT_PUBLIC_NETKIT_PROXY_BASE_URL ||
      process.env.NEXT_PUBLIC_PROXY_BASE_URL;

    if (configuredProxyUrl) {
      return configuredProxyUrl.replace(/\/+$/, '');
    }

    if (this.useLegacyPortUrls()) {
      return `http://${this.proxyHost}:${this.proxyPort}`;
    }

    return joinUrl(this.getPublicBasePath(), '/api/proxy');
  }

  private getAdminBaseUrl(): string {
    const configuredAdminUrl =
      this.getRuntimeConfig().adminBaseUrl ||
      process.env.NEXT_PUBLIC_NETKIT_ADMIN_BASE_URL ||
      process.env.NEXT_PUBLIC_ADMIN_BASE_URL ||
      process.env.NEXT_PUBLIC_API_URL;

    if (configuredAdminUrl) {
      return configuredAdminUrl.replace(/\/+$/, '');
    }

    if (this.useLegacyPortUrls()) {
      return `http://${this.proxyHost}:${this.adminPort}`;
    }

    return joinUrl(this.getPublicBasePath(), '/api/admin');
  }

  getProxyDisplayAddress(): string {
    if (this.useLegacyPortUrls()) {
      return `${this.proxyHost}:${this.proxyPort}`;
    }

    return this.getProxyBaseUrl();
  }

  getAdminDisplayAddress(): string {
    if (this.useLegacyPortUrls()) {
      return `Admin: ${this.adminPort}`;
    }

    return 'Admin API';
  }

  // Add no-cache headers to prevent browser caching
  private getDefaultHeaders(): HeadersInit {
    return {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    };
  }

  // Add timestamp to URL to bust cache
  private addCacheBuster(url: string): string {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}_t=${Date.now()}`;
  }

  async getCaptureInfo(): Promise<{ capture_mode: string; history_capacity: number; redact_fields?: string[] }> {
    const response = await fetch(joinUrl(this.getAdminBaseUrl(), "/healthz"), { cache: "no-store" });
    if (!response.ok) throw new Error("Capture status unavailable");
    return response.json();
  }

  async makeRequest(config: RequestConfig): Promise<ApiResponse> {
    const startTime = Date.now();
    
    try {
      // Fetch the server policy before sending; do not display an unsanitized response.
      const policy = await this.getCaptureInfo();
      // Convert headers object to fetch headers
      const headers = new Headers();
      
      // Add default no-cache headers first
      Object.entries(this.getDefaultHeaders()).forEach(([key, value]) => {
        headers.set(key, value);
      });

      // Then add user-specified headers
      Object.entries(config.headers).forEach(([key, value]) => {
        if (key && value) {
          headers.append(key, value);
        }
      });

      // Add content type for POST/PUT/PATCH requests with body
      if (config.body && !headers.has('Content-Type')) {
        try {
          JSON.parse(config.body);
          headers.set('Content-Type', 'application/json');
        } catch {
          headers.set('Content-Type', 'text/plain');
        }
      }

      // Add the special X-Netkit-Destination header to tell the proxy where to forward the request
      headers.set('X-Netkit-Destination', config.url);

      const fetchOptions: RequestInit = {
        method: config.method,
        headers,
        body: config.body || undefined,
        cache: 'no-store', // Prevent caching at the fetch level
      };

      // Send request to the proxy server, which will forward it to the destination
      // specified in the X-Netkit-Destination header.
      const response = await fetch(this.getProxyBaseUrl(), fetchOptions);
      
      const responseBody = await response.text();
      const endTime = Date.now();

      // Convert response headers to object
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        statusCode: response.status,
        headers: redactHeaders(responseHeaders, policy.redact_fields),
        body: redactBody(responseBody, policy.redact_fields),
        timestamp: startTime,
        duration: endTime - startTime,
      };
    } catch {
      const endTime = Date.now();
      throw {
        statusCode: 0,
        headers: {},
        body: 'Request failed. Check the capture history and API connection.',
        timestamp: startTime,
        duration: endTime - startTime,
      };
    }
  }

  // Get request history from the backend
  async getRequestHistory(): Promise<BackendRequestRecord[]> {
    try {
      const url = this.addCacheBuster(joinUrl(this.getAdminBaseUrl(), '/requests'));
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getDefaultHeaders(),
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data: BackendHistoryResponse = await response.json();
      if (!data || !Array.isArray(data.records)) throw new Error('Invalid traffic response');
      const policy = await this.getCaptureInfo();
      return data.records.map(record => ({ ...record,
        url: record.method === 'CONNECT' && /^[a-z0-9.[\]:-]+$/i.test(record.url) ? record.url : redactURL(record.url),
        request_headers: redactHeaders(record.request_headers || {}, policy.redact_fields),
        response_headers: redactHeaders(record.response_headers || {}, policy.redact_fields),
        request_body: redactBody(record.request_body || '', policy.redact_fields),
        response_body: redactBody(record.response_body || '', policy.redact_fields),
        error: record.error ? (record.outcome ? 'Exchange incomplete; see outcome and failure reason.' : 'Exchange incomplete (older server).') : undefined,
      }));
    } catch (error) {
      throw error;
    }
  }

  // Get request statistics from the backend
  async getRequestStats(): Promise<RequestStats> {
    try {
      const url = this.addCacheBuster(joinUrl(this.getAdminBaseUrl(), '/requests/stats'));
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getDefaultHeaders(),
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data: RequestStats = await response.json();
      if (!data || !Number.isFinite(data.total_requests)) throw new Error('Invalid statistics response');
      return data;
    } catch (error) {
      throw error;
    }
  }

  // Clear request history on the backend
  async clearRequestHistory(): Promise<boolean> {
    try {
      const url = this.addCacheBuster(joinUrl(this.getAdminBaseUrl(), '/requests/clear'));
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...this.getDefaultHeaders(),
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });
      return response.ok;
    } catch (error) {
      console.error('Failed to clear request history:', error);
      return false;
    }
  }

  // Health check for proxy (now on admin port)
  async checkProxyHealth(): Promise<boolean> {
    try {
      const url = this.addCacheBuster(joinUrl(this.getAdminBaseUrl(), '/healthz'));
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getDefaultHeaders(),
        cache: 'no-store',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const apiService = new ApiService();
