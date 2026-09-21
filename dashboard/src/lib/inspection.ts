import type { BackendRequestRecord } from '../services/api';

export const REDACTED = '[REDACTED]';
export const OMITTED_BODY = '[Body omitted: only complete JSON up to 64 KiB is retained]';
export function sensitiveField(key: string, extra: string[] = []): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[-_ ]/g, '');
  return /authorization|cookie|password|passwd|secret|token|apikey|credential|privatekey/.test(normalize(key)) || extra.some(s => normalize(s.trim()) === normalize(key));
}
export function redactText(value: string): string {
  return value.replace(/bearer\s+[a-z0-9._~+/-]+=*|bot[0-9]+:[a-z0-9_-]+|\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+/gi, REDACTED);
}
export function redactURL(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) { url.username = REDACTED; url.password = ''; }
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) url.searchParams.set(key, REDACTED);
    let previousSensitive = false;
    url.pathname = url.pathname.split('/').map(encoded => {
      const segment = decodeURIComponent(encoded);
      const hide = previousSensitive || segment.includes(':') || segment.length > 32;
      previousSensitive = sensitiveField(segment);
      return encodeURIComponent(hide ? REDACTED : redactText(segment));
    }).join('/');
    return url.toString();
  } catch { return REDACTED; }
}
export function redactHeaders(headers: Record<string, string>, extra: string[] = []): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key,
    sensitiveField(key, extra) ? REDACTED : /^(location|referer|x-netkit-destination)$/i.test(key) ? redactURL(value) : redactText(value),
  ]));
}
export function redactBody(body: string, extra: string[] = []): string {
  if (!body || body === OMITTED_BODY) return body;
  if (new TextEncoder().encode(body).length > 65536) return OMITTED_BODY;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, sensitiveField(key, extra) ? REDACTED : visit(val)]));
    if (typeof value === 'string') return /^https?:\/\//.test(value) ? redactURL(value) : redactText(value);
    return value;
  };
  try { return JSON.stringify(visit(JSON.parse(body))); } catch { return OMITTED_BODY; }
}
export function outcomeLabel(record: BackendRequestRecord): string {
  const labels: Record<string, string> = { complete: 'Transfer completed', interrupted: 'Interrupted', client_canceled: 'Client canceled', blocked_by_inspection: 'Blocked by inspection', upstream_error: 'Upstream connection failed', proxy_error: 'Proxy error', tunnel_only: 'Tunnel only', unknown: 'Unknown' };
  return labels[record.outcome] || 'Unknown (older server)';
}
