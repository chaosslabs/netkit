#!/usr/bin/env python3
"""Run a real Netkit demo with a deterministic, local-only upstream."""
import argparse
import http.client
import json
from pathlib import Path
import signal
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[2]
PROXY, ADMIN, DASHBOARD, UPSTREAM = 18080, 18081, 13000, 18090


class Upstream(BaseHTTPRequestHandler):
    def do_GET(self):
        status = 200
        payload = {"service": "demo-store", "products": ["keyboard", "headphones"]}
        if self.path == "/slow":
            time.sleep(0.8)
            payload = {"message": "Slow upstream completed", "delay_ms": 800}
        elif self.path == "/unavailable":
            status, payload = 503, {"error": "Demo inventory unavailable", "retryable": True}
        elif self.path not in ("/products", "/healthz"):
            status, payload = 404, {"error": "Not found"}
        self.respond(status, payload)

    def do_POST(self):
        if self.path != "/orders":
            self.respond(404, {"error": "Not found"})
            return
        try:
            if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
                chunks = []
                while True:
                    size = int(self.rfile.readline().split(b";", 1)[0], 16)
                    if size == 0:
                        while self.rfile.readline() not in (b"\r\n", b"\n", b""):
                            pass
                        break
                    chunks.append(self.rfile.read(size))
                    if self.rfile.read(2) != b"\r\n":
                        raise ValueError("Invalid chunk terminator")
                raw = b"".join(chunks)
            else:
                raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            body = json.loads(raw)
        except (ValueError, json.JSONDecodeError):
            self.respond(400, {"error": "Expected JSON"})
            return
        self.respond(201, {"order_id": "demo-1042", "received": body})

    def respond(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


def request(port, method, path, body=None, headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.request(method, path, body, headers or {})
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


def verify():
    """Send actual forward-proxy traffic, then check captured records and metrics."""
    scenarios = [("GET", "/products", None, 200),
                 ("POST", "/orders", json.dumps({"item": "keyboard", "quantity": 2}), 201),
                 ("GET", "/slow", None, 200),
                 ("GET", "/unavailable", None, 503)]
    for method, path, body, expected in scenarios:
        url = f"http://127.0.0.1:{UPSTREAM}{path}"
        previous = {r["id"] for r in json.loads(request(ADMIN, "GET", "/requests")[1])["records"]}
        status, response = request(PROXY, method, url, body, {"Content-Type": "application/json"})
        assert status == expected, (path, status, response)
        # Confirm the response really came from our upstream.
        payload = json.loads(response)
        if path == "/orders":
            assert payload["received"] == json.loads(body)
        record = None
        for _ in range(40):
            records = json.loads(request(ADMIN, "GET", "/requests")[1])["records"]
            record = next((r for r in records if r["url"] == url and
                           r["method"] == method and r["id"] not in previous), None)
            if record is not None:
                break
            time.sleep(0.05)
        assert record is not None, f"No fresh capture for {method} {url}"
        assert record["response_status"] == expected, record
        assert json.loads(record["response_body"]) == payload, record
        if body:
            assert json.loads(record["request_body"]) == json.loads(body), record
        if path == "/slow":
            assert record["upstream_latency_us"] >= 700_000, record
        print(f"PASS {method:4} {path:14} HTTP {status} captured; {record['total_duration_us'] / 1000:.1f} ms", flush=True)
    status, metrics = request(ADMIN, "GET", "/metrics")
    assert status == 200 and b"netkit" in metrics
    stats = json.loads(request(ADMIN, "GET", "/requests/stats")[1])
    assert stats["total_requests"] >= len(scenarios), stats
    print("PASS history, JSON bodies, upstream latency, statistics and Prometheus metrics", flush=True)


def run(skip_build):
    # Fail before building or seeding if another process owns a demo port.
    for port in (PROXY, ADMIN, DASHBOARD, UPSTREAM):
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(("", port))
    binary = ROOT / "bin/netkit-demo"
    if not skip_build:
        subprocess.run(["npm", "ci"], cwd=ROOT / "dashboard", check=True)
        subprocess.run(["npm", "run", "build"], cwd=ROOT / "dashboard", check=True)
        binary.parent.mkdir(exist_ok=True)
        subprocess.run(["go", "build", "-o", str(binary), "./cmd/netkit"], cwd=ROOT, check=True)
    if not binary.is_file() or not (ROOT / "dashboard/out/index.html").is_file():
        raise RuntimeError("Demo build missing; run make demo first")
    server = ThreadingHTTPServer(("127.0.0.1", UPSTREAM), Upstream)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    process = None
    try:
        process = subprocess.Popen([str(binary), "serve", "--port", str(PROXY),
            "--admin-port", str(ADMIN), "--dashboard-port", str(DASHBOARD),
            "--dashboard-dir", str(ROOT / "dashboard/out"), "--history-size", "200",
            "--log-level", "error"], cwd=ROOT)
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError("Netkit exited before becoming ready")
            try:
                if request(DASHBOARD, "GET", "/api/admin/healthz")[0] == 200:
                    break
            except OSError:
                pass
            time.sleep(0.1)
        else:
            raise RuntimeError("Netkit readiness timed out")
        verify()
        print(f"\nDemo ready: http://localhost:{DASHBOARD}\nCtrl-C stops both servers.\n"
              "Netkit listeners bind all interfaces; use a trusted development machine.", flush=True)
        if process.wait() != 0:
            raise RuntimeError("Netkit exited unexpectedly")
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("run", "verify"), nargs="?", default="run")
    parser.add_argument("--skip-build", action="store_true", help="Reuse the last local demo build")
    args = parser.parse_args()
    def stop(*_args):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        run(args.skip_build) if args.action == "run" else verify()
    except KeyboardInterrupt:
        pass
