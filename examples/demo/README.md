# 🎬 Local Netkit demo

Run the real proxy and dashboard against a small local store API. No external API,
credentials, or Docker needed. The first build downloads dependencies; all demo
traffic stays on your machine.

[Watch the recorded walkthrough](netkit-demo.mp4) (48 seconds, 1440×1000 at 30 fps, real browser capture).

## 🚀 Start

Requirements: Go 1.24.1+, Node.js 20+, npm, and Python 3.9+.

From the repository root:

```sh
make demo
```

Open **http://localhost:13000**. The launcher builds the dashboard and Netkit, starts
both servers, sends four real HTTP exchanges through the forward proxy, and verifies
the resulting captures. It refuses to start if a demo port is occupied. Ctrl-C stops
both servers; history is in memory and disappears on shutdown.

Netkit currently binds its proxy, admin, and dashboard listeners to all interfaces.
Run this on a trusted development machine; do not expose these unauthenticated ports
to the Internet. The synthetic upstream binds only to loopback.

| Service | Address |
| --- | --- |
| Dashboard and same-origin API | http://localhost:13000 |
| HTTP forward proxy | http://localhost:18080 |
| Admin API and metrics | http://localhost:18081 |
| Synthetic store API | http://127.0.0.1:18090 |

To reuse your last build, run `python3 examples/demo/demo.py run --skip-build`.
To send another batch and recheck captures while the environment runs:

```sh
make demo-verify
```

## 👀 Walkthrough

1. In **Traffic**, inspect `GET /products`: HTTP 200 with a JSON catalog.
2. Inspect `POST /orders`: HTTP 201, the captured JSON request, and the upstream's
   response containing `order_id: demo-1042` and the original request payload.
3. Inspect `GET /slow`: HTTP 200 after an intentional 800 ms upstream delay.
4. Inspect `GET /unavailable`: an actual upstream HTTP 503 with a JSON error.
5. Open **Overview** to see the same real exchanges aggregated.
6. In the request builder, send `GET http://127.0.0.1:18090/products` and return to
   Traffic to inspect the new capture.

You can also use a normal proxy client. `--noproxy ''` is deliberate: curl otherwise
may bypass the proxy for loopback destinations.

```sh
curl --noproxy '' --proxy http://localhost:18080 http://127.0.0.1:18090/products
curl http://localhost:18081/metrics
```

[See screenshots from the video →](../../README.md#-see-it-in-action)

This demo covers plain HTTP capture. It does not demonstrate HTTPS interception,
transport failures, alert delivery, or production deployment.

## 🎥 Record the dashboard

With [Playwright CLI](https://github.com/microsoft/playwright-cli) installed:

```sh
mkdir -p output/playwright
npx playwright install ffmpeg
playwright-cli -s=netkit-demo open http://localhost:13000 --headed
playwright-cli -s=netkit-demo resize 1440 1000
playwright-cli -s=netkit-demo video-start output/playwright/netkit-demo.webm --size=1440x1000 --fps=30 --cursor
playwright-cli -s=netkit-demo snapshot
# Use the displayed element refs with click/fill to follow the walkthrough above.
playwright-cli -s=netkit-demo video-stop
```

Set `--size` explicitly to match the viewport; otherwise Playwright downscales
the video to fit 800×800. The recording captures the running browser. It is not a mock UI or a replay of
fabricated responses. Working recordings under `output/playwright/` are ignored by Git. The reviewed
`netkit-demo.mp4` walkthrough is included here for convenient playback.
