# Docker Log Sentinel

A TypeScript CLI that monitors Docker container logs and sends intelligent alerts with deduplication and rate limiting.

## Features

- Monitor specific containers (by name) or all running containers
- Detect error lines via configurable regex patterns
- Ignore noise via ignore patterns
- Per-container deduping + rate limiting to prevent alert spam
- Aggregated periodic summaries (counts by fingerprint)
- Alert to: stdout (always) and optional Webhook (Slack or Lark)
- Zero-config defaults, but configurable via flags and env vars

## Requirements

- Node.js 18+
- Docker socket access (default `/var/run/docker.sock`) or remote via env `DOCKER_HOST`

## Installation

```bash
npm install
```

## Usage

### Local Development

```bash
# Watch all containers
npm start -- --all

# Watch specific containers
npm start -- --containers api,worker --since 5m

# With webhook alerts
SLACK_WEBHOOK_URL=https://hooks.slack.com/... npm start -- --all
LARK_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/... npm start -- --all

# Development with auto-restart
npm run dev -- --all
```

### Docker Deployment

```bash
# Build image
docker build -t log-sentinel .

# Run container (mount Docker socket read-only, pass webhook URLs)
docker run --name log-sentinel --restart=always \
  -e LARK_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/XXXX" \
  -e SLACK_WEBHOOK_URL="" \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  log-sentinel
```

## Configuration Options

- `--all`: Monitor all running containers
- `--containers`: Comma-separated list of container names
- `--since`: Time range for log history (e.g., 10m, 1h, 2025-09-01T00:00:00Z)
- `--patterns`: Custom error detection regex (case-insensitive)
- `--ignore`: Custom ignore patterns regex (case-insensitive)
- `--summarizeEvery`: Seconds between summary alerts (default: 300)
- `--rateLimit`: Minimum seconds between identical alerts (default: 120)
- `--dockerSocket`: Custom Docker socket path

## Environment Variables

- `SLACK_WEBHOOK_URL`: Slack webhook for alerts
- `LARK_WEBHOOK_URL`: Lark/Feishu webhook for alerts
- `DOCKER_HOST`: Remote Docker daemon host
- `DOCKER_PORT`: Remote Docker daemon port
- `DOCKER_SOCKET`: Docker socket path override