import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactBody, redactHeaders, redactURL, REDACTED, OMITTED_BODY } from './inspection';

test('sanitizes nested JSON, URL credentials and custom fields without hiding ordinary fields', () => {
  const body = redactBody(JSON.stringify({ password: 'fixture-password', nested: [{ custom_pin: 'fixture-pin', n: 42 }], link: 'https://user:fixture-user@example.test/bot123:fixture-token/getMe?q=fixture-query' }), ['custom_pin']);
  assert.equal(body.includes('fixture-'), false);
  assert.equal(JSON.parse(body).nested[0].n, 42);
  assert.equal(redactHeaders({ Authorization: 'fixture-auth', Cookie: 'fixture-cookie', 'X-Pin': 'fixture-pin' }, ['X-Pin'])['X-Pin'], REDACTED);
  assert.equal(redactURL('https://example.test/token/fixture-path?q=fixture-query').includes('fixture-'), false);
  assert.equal(redactURL('https://example.test/%62ot123%3Afixture-token/getMe').includes('fixture-'), false);
});
test('omits opaque, incomplete and oversized bodies', () => {
  for (const body of ['data: fixture-token', '{"password":"fixture"', 'x'.repeat(65537)]) assert.equal(redactBody(body), OMITTED_BODY);
});
