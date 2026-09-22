#!/usr/bin/env python3
"""Exercise a real Alertmanager and netkit alerts receiver with disposable local data."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def stamp(value=None):
    return (value or dt.datetime.now(dt.timezone.utc)).isoformat().replace('+00:00', 'Z')


def request(url, data=None, method=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    payload = None if data is None else json.dumps(data).encode()
    with urllib.request.urlopen(urllib.request.Request(url, payload, headers, method=method), timeout=5) as response:
        return response.read()


def until(predicate, message, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if predicate():
                return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(.1)
    raise AssertionError(message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--netkit', required=True)
    parser.add_argument('--alertmanager', required=True)
    args = parser.parse_args()
    receiver_port, am_port = port(), port()
    receiver_url = f'http://127.0.0.1:{receiver_port}'
    am_url = f'http://127.0.0.1:{am_port}'
    token = 'disposable-integration-token'
    delivered = []
    lock = threading.Lock()
    evidence_time = stamp()

    class Fixture(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({'matching_retained': 1, 'records': [{
                'id': 'a' * 32, 'timestamp': evidence_time, 'method': 'GET',
                'outcome': 'complete', 'status': 503, 'source': 'upstream',
                'headers_us': 2000, 'duration_us': 3000,
                'url': 'https://fixture.invalid/secret/never-store-me',
            }]}).encode()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            try:
                request(receiver_url + '/webhook', payload, token=token)
            except urllib.error.URLError:
                self.send_response(503)
                self.end_headers()
                return
            with lock:
                delivered.append(payload)
            self.send_response(204)
            self.end_headers()

        def log_message(self, *_):
            pass

    fixture = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
    threading.Thread(target=fixture.serve_forever, daemon=True).start()
    fixture_url = f'http://127.0.0.1:{fixture.server_port}'
    children = []
    try:
        with tempfile.TemporaryDirectory(prefix='netkit-alert-integration-') as work:
            root = Path(work)
            config = root / 'alertmanager.yml'
            config.write_text(f'''route:
  receiver: test
  group_by: [alertname, job, instance]
  group_wait: 1s
  group_interval: 1s
  repeat_interval: 3s
receivers:
  - name: test
    webhook_configs:
      - url: {fixture_url}/webhook
        send_resolved: true
''')
            with (root / 'process.log').open('w') as output:
                children.append(subprocess.Popen([
                    args.netkit, 'alerts', '--listen', f'127.0.0.1:{receiver_port}',
                    '--dir', str(root / 'incidents'), '--admin-url', fixture_url,
                    '--dashboard-url', 'http://127.0.0.1:18080',
                ], env={**os.environ, 'NETKIT_ALERT_TOKEN': token}, stdout=output, stderr=output))
                children.append(subprocess.Popen([
                    args.alertmanager, '--config.file', str(config),
                    '--storage.path', str(root / 'am'), '--cluster.listen-address=',
                    '--web.listen-address', f'127.0.0.1:{am_port}',
                ], stdout=output, stderr=output))
                until(lambda: request(am_url + '/-/ready') and request(receiver_url + '/'), 'services not ready')
                start = dt.datetime.now(dt.timezone.utc)
                alerts = [{
                    'labels': {'alertname': 'NetkitUpstreamFailureRate', 'job': 'netkit',
                               'instance': 'netkit-local', 'test_case': case},
                    'annotations': {'value': '0.5', 'threshold': '0.1', 'description': 'never-store-me'},
                    'startsAt': stamp(start), 'endsAt': stamp(start + dt.timedelta(minutes=5)),
                } for case in ('a', 'b')]
                request(am_url + '/api/v2/alerts', alerts)
                until(lambda: len(delivered) >= 1, 'initial grouped notification missing')
                assert len(delivered[0]['alerts']) == 2, 'alerts were not grouped'
                until(lambda: len(delivered) >= 2, 'repeat notification missing')
                files = list((root / 'incidents').glob('*.json'))
                assert len(files) == 1, 'retries duplicated the logical incident'
                incident = json.loads(files[0].read_text())
                assert incident['status'] == 'firing' and len(incident['evidence']) == 1
                assert 'never-store-me' not in files[0].read_text()
                silence = json.loads(request(am_url + '/api/v2/silences', {
                    'matchers': [{'name': 'instance', 'value': 'netkit-local', 'isRegex': False, 'isEqual': True}],
                    'startsAt': stamp(), 'endsAt': stamp(start + dt.timedelta(minutes=2)),
                    'createdBy': 'local-test', 'comment': 'disposable integration silence',
                }))
                time.sleep(1.5)  # Drain any notification already in flight before silence creation.
                count = len(delivered)
                time.sleep(4)
                assert len(delivered) == count, 'silence did not suppress repeated notifications'
                request(am_url + '/api/v2/silence/' + silence['silenceID'], method='DELETE')
                for alert in alerts:
                    alert['endsAt'] = stamp()
                request(am_url + '/api/v2/alerts', alerts)
                until(lambda: any(p['status'] == 'resolved' for p in delivered), 'recovery notification missing')
                until(lambda: json.loads(files[0].read_text())['status'] == 'resolved', 'incident did not resolve')
                assert json.loads(files[0].read_text())['evidence'] == incident['evidence'], 'recovery replaced original evidence'
                print('PASS: grouping, repeat delivery, silence, recovery, durable deduplication and metadata-only evidence')
                for child in children:
                    child.terminate()
                for child in children:
                    child.wait(timeout=10)
    finally:
        for child in children:
            if child.poll() is None:
                child.kill()
                child.wait()
        fixture.shutdown()


if __name__ == '__main__':
    main()
