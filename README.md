# netkit

A modern HTTP proxy and request capture tool with a sleek web dashboard.

<!-- badges --->

## Features

- **HTTP Proxy Server**: Forward HTTP requests through the proxy
- **Request History**: Comprehensive tracking of all proxied requests
- **Web Dashboard**: Modern React-based interface for managing requests
- **Real-time Statistics**: Monitor proxy performance and request metrics
- **Admin API**: RESTful endpoints for health checks, metrics, and history
- **Request Replay**: Load and replay requests from history
- **Timing Metrics**: Detailed breakdown of proxy overhead and upstream latency

## Quick Start

### 1. Build the Project

```bash
make dev
```

Open http://localhost:3000 to access the dashboard.

### Docker dashboard

The published `biancarosa/netkit:0.1.0` image does not embed the dashboard.
Build the corrected image from this checkout:

```bash
docker build -t netkit:local .
docker run --rm -p 127.0.0.1:3000:3000 -p 127.0.0.1:8080:8080 netkit:local
```

Open http://localhost:3000. The dashboard accesses its admin API through the
same port. Run `make test-docker-dashboard` to verify the image before publishing.

## Dashboard Features

### Request Builder
- **HTTP Method Selection**: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
- **URL Input**: Full URL with validation
- **Headers Management**: Dynamic header pairs with enable/disable toggles
- **Request Body**: JSON editor with syntax highlighting
- **Send Requests**: Execute requests through the proxy or directly

### Request History
The dashboard provides two types of request history:

#### Local History
- Requests made from the dashboard interface
- Stored in browser localStorage
- Includes request/response data and timing
- Replay functionality to load previous requests

#### Proxy History
- All HTTP requests that pass through the proxy server
- Stored in server memory (configurable size)
- Detailed timing metrics (proxy overhead, upstream latency)
- Request/response size tracking
- Success/error status tracking

### Statistics Panel
Real-time statistics showing:
- **Request Counts**: Success vs error rates
- **Timing Metrics**: Average durations and latency breakdown
- **Data Transfer**: Total request/response sizes
- **Status Codes**: Distribution of HTTP status codes
- **Methods**: Usage breakdown by HTTP method

## API Endpoints

### Proxy Server (Port 8080)
- **HTTP Proxy**: All HTTP traffic

### Admin Server (Port 8081)
- `GET /healthz` - Health check
- `GET /metrics` - Prometheus-style metrics
- `GET /requests` - Request history (JSON)
- `GET /requests/stats` - Request statistics
- `POST /requests/clear` - Clear request history

## Configuration

### Command Line Flags

```bash
./bin/netkit serve [flags]

Flags:
  --port int              Proxy server port (default 8080)
  --admin-port int        Admin server port (enables admin endpoints)
  --history-size int      Maximum requests to keep in history (default 1000)
  --dashboard             Enable web dashboard (default true)
  --dashboard-port int    Dashboard server port (default 3000)
  --dashboard-base-path   Public dashboard URL prefix, for example /netkit
  --log-level string      Log level: debug, info, warn, error (default "info")
```

### Environment Variables

The embedded production dashboard uses same-origin API routes by default:
`/api/proxy` for proxied requests and `/api/admin/*` for health, history, and metrics.

For standalone dashboard development, you can still point the browser at separate proxy/admin ports in `dashboard/.env.local`:
```bash
NEXT_PUBLIC_PROXY_HOST=localhost
NEXT_PUBLIC_PROXY_PORT=8080
NEXT_PUBLIC_ADMIN_PORT=8081
```

For path-based reverse proxies, build and run with the same base path:

```bash
docker build --build-arg NETKIT_DASHBOARD_BASE_PATH=/netkit -t netkit .
docker run -e NETKIT_DASHBOARD_BASE_PATH=/netkit -p 3000:3000 -p 8080:8080 -p 8081:8081 netkit
```

## Usage Examples

### Using as HTTP Proxy

```bash
# Configure your application to use the proxy
curl -x http://localhost:8080 http://httpbin.org/get

# Or set environment variables
export HTTP_PROXY=http://localhost:8080
export HTTPS_PROXY=http://localhost:8080
```

### Request History API

```bash
# Get request history
curl http://localhost:8081/requests

# Get statistics
curl http://localhost:8081/requests/stats

# Clear history
curl -X POST http://localhost:8081/requests/clear
```

## Development

### Prerequisites
- Go 1.21+
- Node.js 18+
- npm

### Development Commands

```bash
# Install all development tools (Go, Node.js, git-cliff)
make install

# Install specific toolsets
make install-backend           # Go tools only
make install-dashboard         # Node.js dependencies only
make install-changelog-tools   # git-cliff and conventional commit tools

# Run tests
make test
make e2e

# Run linting
make lint
make check

# Start development servers
make dev

# Build for production
make build
make build-dashboard
```

### Conventional Commits and Changelog

This project uses [Conventional Commits](https://www.conventionalcommits.org/) for structured commit messages and [git-cliff](https://git-cliff.org/) for automated changelog generation.

#### Quick Start with Conventional Commits

```bash
# Install tools
make install-changelog-tools

# Initialize changelog configuration
make changelog-init

# Make conventional commits
make commit-feat msg="add user authentication"
make commit-fix msg="resolve proxy timeout issue"
make commit-docs msg="update API documentation"

# Create releases
make release-patch  # 1.0.0 -> 1.0.1 (bug fixes)
make release-minor  # 1.0.0 -> 1.1.0 (new features)
make release-major  # 1.0.0 -> 2.0.0 (breaking changes)
```

#### Available Commit Types

- `feat` - New features
- `fix` - Bug fixes
- `docs` - Documentation changes
- `style` - Code formatting
- `refactor` - Code restructuring
- `test` - Test additions/modifications
- `chore` - Maintenance tasks
- `perf` - Performance improvements
- `security` - Security fixes

#### Changelog Commands

```bash
make changelog              # Generate full changelog
make changelog-update       # Update with latest commits
make check-conventional-commits  # Validate commit format
```

For detailed information, see [docs/CHANGELOG_GUIDE.md](docs/CHANGELOG_GUIDE.md).

### Project Structure

```
netkit/
├── cmd/netkit/          # Main application entry point
├── internal/
│   ├── proxy/           # Proxy server implementation
│   └── api/             # Admin API handlers
├── dashboard/           # React dashboard
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── services/    # API service layer
│   │   └── hooks/       # Custom hooks and state management
│   └── public/          # Static assets
└── Makefile            # Development commands
```

## Request History Details

### HTTP vs HTTPS Requests

- **HTTP Requests**: Fully captured with complete request/response data
- **HTTPS Requests**: Only CONNECT tunnel establishment is visible (encrypted content cannot be captured)

### Data Captured

For each HTTP request through the proxy:
- Request method, URL, headers, body
- Response status, headers, body
- Timing breakdown:
  - Proxy overhead (time spent in proxy code)
  - Upstream latency (time waiting for target server)
  - Total duration
- Data sizes (request and response bytes)
- Success/error status

### Performance Considerations

- Request history is stored in memory
- Configurable maximum size (default: 1000 requests)
- Automatic cleanup of oldest requests when limit reached
- Minimal performance impact on proxy operations

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `make check` to ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

### HTTPS tunnel history

When an application uses Netkit through `HTTPS_PROXY`, history records each
`CONNECT host:port` tunnel as soon as its setup succeeds or fails. Long-lived
connections appear immediately. The status and timing describe tunnel setup,
not the encrypted upstream API response or the lifetime of the connection.
A reused tunnel can carry multiple HTTPS requests but creates one history entry.

Netkit does not decrypt TLS: HTTPS paths, headers, bodies, and application status
codes are not captured. CONNECT records leave payload sizes at zero (unmeasured)
and omit request headers to avoid retaining proxy credentials. Transfer errors
after establishment do not change the setup result. Requests made through the
dashboard's destination-header API follow its separate HTTP forwarding path.

## Maintainer operations

See [RUNBOOK.md](RUNBOOK.md) for release validation, local troubleshooting,
CLI/container rollback, and the applicability of cost checks to this distributed tool.

### Inspect HTTPS request and response bodies

Netkit can decrypt HTTPS for **every destination** when clients explicitly trust
its inspection CA. There is no domain allowlist. Without `--inspect-https`, CONNECT
continues to work as an encrypted tunnel.

Generate a CA once and keep it across proxy restarts:

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

The existing request dashboard and `/requests` API show each decrypted HTTP
exchange, including its full URL, headers, and both bodies. Headers and bodies
are captured as received, including credentials. Keep access within your trusted
debugging environment. History remains in memory and is cleared on restart.

Responses are streamed to clients immediately, including SSE; their history
record is saved when the exchange finishes or disconnects. Long-lived streams
therefore appear after closing. Capture stores complete bodies in memory, so
choose `--history-size` to suit payload sizes. Binary or compressed payloads are
not decoded for display. Inspected connections negotiate HTTP/1.1 (including
keep-alive); HTTP/2-only clients are not supported. WebSocket and other protocol
upgrades return 501 in inspection mode; frame inspection is not implemented.
Plain HTTP carried inside CONNECT (as used by Node fetch) is also captured.
Only traffic configured to pass through Netkit can be inspected.

Inspection has no upstream response-header deadline by default, so long-polling
requests can wait for a response. Client cancellation still cancels the upstream
request. To impose a deadline, use `--inspection-response-header-timeout=90s`
with a duration longer than the upstream polling interval. TLS handshake and
idle-connection timeouts remain in effect.

## Trustworthy capture and metrics

Captured history is sanitized before retention. The dashboard separates HTTP status from transfer outcome, discloses capture/retention scope, and preserves stale data when refresh fails. Real cumulative counters and histograms survive history eviction and clearing. See [capture safety and signal semantics](docs/trustworthy-capture.md) for the redaction policy, `--redact-fields`, compatibility changes, timing definitions, and metrics.

### Investigation workspace

Traffic is the landing page, with preserved filters, adjacent request inspection, buffered Live/Pause, and an Overview that drills into matching retained evidence. Compose is available at `/compose/`. See [investigation workspace semantics](docs/investigation-workspace.md) for freshness, URL scope, latency populations, and retention limits.

### Focused alerting

Use the [Prometheus and Alertmanager example](examples/alerting/README.md) for sustained upstream/transport failure alerts, opt-in ordinary-workload header latency, external availability and insufficient-sample signals. The separate `netkit alerts` process retains bounded metadata-only incident snapshots with authenticated webhook writes. Alert evaluation and notification ownership remain external; no native monitor editor or production notification destination is enabled automatically.
