# Netkit setup

[← Back to the README](../README.md)

## Dashboard configuration

The embedded production dashboard uses same-origin API routes by default:
`/api/proxy` for proxied requests and `/api/admin/*` for health, history, and metrics.

For standalone dashboard development, set separate proxy/admin ports in
`dashboard/.env.local`:

```bash
NEXT_PUBLIC_PROXY_HOST=localhost
NEXT_PUBLIC_PROXY_PORT=8080
NEXT_PUBLIC_ADMIN_PORT=8081
```

For path-based reverse proxies, build and run with the same base path:

```bash
docker build --build-arg NETKIT_DASHBOARD_BASE_PATH=/netkit -t netkit .
docker run -e NETKIT_DASHBOARD_BASE_PATH=/netkit -p 127.0.0.1:3000:3000 -p 127.0.0.1:8080:8080 netkit
```

## HTTPS inspection

Netkit can decrypt HTTPS for **every destination** when clients explicitly trust
its inspection CA. There is no domain allowlist. Without `--inspect-https`, CONNECT
continues to work as an encrypted tunnel.

The commands below assume `netkit` is on your PATH. For a local build, use
`./bin/netkit` instead. Generate a CA once and keep it across proxy restarts:

```sh
mkdir -p "$HOME/.config/netkit"
netkit ca --cert "$HOME/.config/netkit/ca.pem" --key "$HOME/.config/netkit/ca-key.pem"
netkit serve --inspect-https \
  --ca-cert "$HOME/.config/netkit/ca.pem" \
  --ca-key "$HOME/.config/netkit/ca-key.pem"
```

The `ca` command refuses to overwrite existing files and creates the private key
with mode `0600`. Only the public `ca.pem` belongs in client trust stores. The
private key stays with Netkit. Existing signing CA PEM files can also be loaded;
an invalid, expired, or mismatched CA fails startup.

For Node.js, make the public certificate available to the application and restart
its process with:

```sh
NODE_EXTRA_CA_CERTS=/path/to/ca.pem \
NODE_OPTIONS=--use-env-proxy \
HTTP_PROXY=http://127.0.0.1:8080 \
HTTPS_PROXY=http://127.0.0.1:8080 \
node your-app.js
```

For curl:

```sh
curl --proxy http://127.0.0.1:8080 --cacert /path/to/ca.pem \
  https://example.com/
```

Python requests uses `REQUESTS_CA_BUNDLE=/path/to/ca.pem`; Chromium requires the
CA in its own applicable trust store and an explicit proxy configuration.
Certificate-pinned applications need their pinning configuration adjusted.
Netkit still verifies upstream certificates using its system trust roots; it
does not disable TLS verification. Private upstream CAs must also be trusted by
Netkit itself.

The dashboard and `/requests` API show sanitized decrypted exchanges. Sensitive
headers, URL values, and JSON fields are masked before retention. Only complete
JSON bodies up to 64 KiB are retained; other bodies have omission markers. This
is a field/pattern policy, not a general secret detector. See the
[capture policy](trustworthy-capture.md) for details. History is in memory and
is cleared on restart.

Responses are streamed to clients immediately, including SSE; their history
record is saved when the exchange finishes or disconnects. Long-lived streams
therefore appear after closing. Capture buffers are bounded, and byte counts track the observed stream.
Binary or compressed payloads are not decoded for display. Inspected connections negotiate HTTP/1.1 (including
keep-alive); HTTP/2-only clients are not supported. WebSocket and other protocol
upgrades return 501 in inspection mode; frame inspection is not implemented.
Plain HTTP carried inside CONNECT (as used by Node fetch) is also captured.
Only traffic configured to pass through Netkit can be inspected.

Inspection has no upstream response-header deadline by default, so long-polling
requests can wait for a response. Client cancellation still cancels the upstream
request. To impose a deadline, use `--inspection-response-header-timeout=90s`
with a duration longer than the upstream polling interval. TLS handshake and
idle-connection timeouts remain in effect.

