# Dashboard build stage
FROM node:20-alpine AS dashboard-builder

WORKDIR /dashboard
ARG NETKIT_DASHBOARD_BASE_PATH=""
ENV NEXT_PUBLIC_NETKIT_BASE_PATH=${NETKIT_DASHBOARD_BASE_PATH}
ENV NEXT_TELEMETRY_DISABLED=1

# Copy dashboard files
COPY dashboard/package*.json ./
RUN npm ci --legacy-peer-deps

COPY dashboard/ ./
RUN npm run build:static
RUN test -s /dashboard/out/index.html

# Go build stage
FROM golang:1.24-alpine AS builder

WORKDIR /build
ARG NETKIT_DASHBOARD_BASE_PATH=""

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Copy built dashboard from previous stage to the location expected by embed directive
COPY --from=dashboard-builder /dashboard/out ./internal/dashboard/out
RUN test -s ./internal/dashboard/out/index.html

# Build the binary with embedded dashboard
RUN CGO_ENABLED=0 GOOS=linux go build -tags embed_dashboard -o netkit ./cmd/netkit
RUN set -eu; \
    dashboard_path="${NETKIT_DASHBOARD_BASE_PATH:-/}"; \
    if [ "$dashboard_path" = "" ]; then dashboard_path="/"; fi; \
    case "$dashboard_path" in */) ;; *) dashboard_path="$dashboard_path/";; esac; \
    api_prefix="${dashboard_path%/}"; \
    ./netkit serve --port 18080 --admin-port 18081 --dashboard --dashboard-port 13000 --dashboard-base-path "$api_prefix" --log-level error >/tmp/netkit.log 2>&1 & \
    pid="$!"; \
    trap 'kill "$pid" 2>/dev/null || true' EXIT; \
    for i in $(seq 1 30); do \
      if wget -q -O /tmp/dashboard.html "http://127.0.0.1:13000${dashboard_path}"; then \
        break; \
      fi; \
      sleep 1; \
    done; \
    test -s /tmp/dashboard.html; \
    ! grep -q "Dashboard not embedded" /tmp/dashboard.html; \
    asset_path="$(grep -o 'src="[^"]*\.js[^"]*"' /tmp/dashboard.html | head -n 1 | cut -d '"' -f 2)"; \
    case "$asset_path" in "${api_prefix}/_next/"*) ;; *) echo "Dashboard JavaScript URL does not match ${dashboard_path}: ${asset_path}" >&2; exit 1;; esac; \
    wget -q -O /dev/null "http://127.0.0.1:13000${asset_path}"; \
    wget -q -O /tmp/health.json "http://127.0.0.1:13000${api_prefix}/api/admin/healthz"; \
    grep -q '"healthy"' /tmp/health.json

# Runtime stage
FROM alpine:latest
ARG NETKIT_DASHBOARD_BASE_PATH=""
ENV NETKIT_DASHBOARD_BASE_PATH=${NETKIT_DASHBOARD_BASE_PATH}

RUN apk --no-cache add ca-certificates \
    && addgroup -S -g 10001 netkit \
    && adduser -S -D -H -u 10001 -G netkit netkit

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/netkit .

# Expose ports (proxy, admin, dashboard)
EXPOSE 8080 8081 3000

USER 10001:10001

# Run the proxy server with embedded dashboard
CMD ["./netkit", "serve", "--port", "8080", "--admin-port", "8081", "--dashboard", "--dashboard-port", "3000", "--log-level", "info"]
