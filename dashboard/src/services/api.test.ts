import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiService } from './api';

test('API failures propagate instead of becoming empty data', async () => {
 const original = global.fetch;
 try {
  global.fetch = async () => new Response('unavailable', { status: 503 });
  await assert.rejects(apiService.getRequestHistory());
  await assert.rejects(apiService.getRequestStats());
  global.fetch = async () => new Response('null', { status: 200 });
  await assert.rejects(apiService.getRequestHistory());
  await assert.rejects(apiService.getRequestStats());
 } finally { global.fetch = original; }
});

test('older/raw history is sanitized before reaching components', async () => {
 const original = global.fetch;
 try {
  global.fetch = async (url) => new Response(JSON.stringify(String(url).includes('healthz') ? { redact_fields: ['pin'] } : { records: [{
   method: 'POST', url: 'https://example.test/bot123:fixture-token/getMe?q=fixture-query',
   request_headers: { Authorization: 'fixture-auth' }, response_headers: { 'Set-Cookie': 'fixture-cookie' },
   request_body: '{"pin":"fixture-pin"}', response_body: '{"password":"fixture-password"}', error: 'fixture-raw-error',
  }] }));
  const records = await apiService.getRequestHistory();
  assert.equal(JSON.stringify(records).includes('fixture-'), false);
 } finally { global.fetch = original; }
});

test('builder forwards original input but only exposes sanitized response', async () => {
 const original = global.fetch;
 let sent = false;
 try {
  global.fetch = async (url, options) => {
   if (String(url).includes('healthz')) return new Response(JSON.stringify({ redact_fields: ['pin'] }));
   assert.equal(new Headers(options?.headers).get('Authorization'), 'fixture-outgoing');
   assert.equal(options?.body, '{"password":"fixture-outgoing-body"}');
   sent = true;
   return new Response('{"pin":"fixture-response"}', { headers: { 'X-Api-Key': 'fixture-header' } });
  };
  const result = await apiService.makeRequest({ method: 'POST', url: 'https://example.test', headers: { Authorization: 'fixture-outgoing' }, body: '{"password":"fixture-outgoing-body"}' });
  assert.equal(sent, true);
  assert.equal(JSON.stringify(result).includes('fixture-'), false);
 } finally { global.fetch = original; }
});

test('capture policy and data endpoints preserve a configured dashboard prefix', async () => {
 const original = global.fetch;
 const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
 const seen: string[] = [];
 try {
  Object.defineProperty(globalThis, 'window', { value: { __NETKIT_CONFIG__: { basePath: '/tools/netkit' } }, configurable: true });
  global.fetch = async (url) => {
   seen.push(String(url));
   return new Response(JSON.stringify(String(url).includes('healthz') ? { capture_mode: 'http_and_connect_tunnels', history_capacity: 5 } : String(url).includes('/stats') ? { total_requests: 0 } : { records: [] }));
  };
  await apiService.getRequestHistory();
  await apiService.getRequestStats();
  assert.equal(seen.length, 3);
  assert.ok(seen.every(url => url.startsWith('/tools/netkit/api/admin/')));
 } finally {
  global.fetch = original;
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else Reflect.deleteProperty(globalThis, 'window');
 }
});
