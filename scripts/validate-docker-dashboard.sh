#!/usr/bin/env sh
set -eu

image="${NETKIT_DOCKER_IMAGE:-netkit:dashboard-validation}"
container="${NETKIT_DOCKER_CONTAINER:-netkit-dashboard-validation-$$}"
proxy_port="${NETKIT_DOCKER_PROXY_PORT:-18080}"
admin_port="${NETKIT_DOCKER_ADMIN_PORT:-18081}"
dashboard_port="${NETKIT_DOCKER_DASHBOARD_PORT:-13000}"
dashboard_path="${NETKIT_DASHBOARD_BASE_PATH:-/}"

if [ "$dashboard_path" = "" ]; then
  dashboard_path="/"
fi

case "$dashboard_path" in
  */) ;;
  *) dashboard_path="${dashboard_path}/" ;;
esac

api_prefix="${dashboard_path%/}"
dashboard_url="http://127.0.0.1:${dashboard_port}${dashboard_path}"
health_url="http://127.0.0.1:${dashboard_port}${api_prefix}/api/admin/healthz"
tmp_dashboard="$(mktemp)"
tmp_health="$(mktemp)"

cleanup() {
  rm -f "$tmp_dashboard" "$tmp_health"
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if [ "${NETKIT_DOCKER_SKIP_BUILD:-}" != "1" ]; then
  docker build \
    --build-arg "NETKIT_DASHBOARD_BASE_PATH=${NETKIT_DASHBOARD_BASE_PATH:-}" \
    -t "$image" .
fi

docker run -d \
  --name "$container" \
  -p "127.0.0.1:${proxy_port}:8080" \
  -p "127.0.0.1:${admin_port}:8081" \
  -p "127.0.0.1:${dashboard_port}:3000" \
  "$image" >/dev/null

if [ "$(docker exec "$container" id -u)" != "10001" ]; then
  echo "Docker image must run as the non-root netkit user (UID 10001)" >&2
  exit 1
fi

for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  if curl -fsS "$dashboard_url" > "$tmp_dashboard"; then
    break
  fi
  sleep 1
done

if [ ! -s "$tmp_dashboard" ]; then
  echo "Dashboard did not respond at ${dashboard_url}" >&2
  docker logs "$container" >&2 || true
  exit 1
fi

if grep -q "Dashboard not embedded" "$tmp_dashboard"; then
  echo "Docker image served the fallback dashboard instead of the embedded dashboard" >&2
  exit 1
fi

# HTML alone can pass while a prefix mismatch breaks every browser asset.
asset_path="$(grep -o 'src="[^"]*\.js[^"]*"' "$tmp_dashboard" | head -n 1 | cut -d '"' -f 2)"
case "$asset_path" in
  "${api_prefix}/_next/"*) ;;
  *)
    echo "Dashboard JavaScript URL does not match ${dashboard_path}: ${asset_path}" >&2
    exit 1
    ;;
esac
curl -fsS "http://127.0.0.1:${dashboard_port}${asset_path}" > /dev/null

curl -fsS "$health_url" > "$tmp_health"
if ! grep -q '"healthy"' "$tmp_health"; then
  echo "Dashboard same-origin admin API did not return healthy status" >&2
  exit 1
fi

echo "Docker dashboard validation passed for ${image}"
