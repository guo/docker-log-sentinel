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

- Bun 1.0+
- Docker socket access (default `/var/run/docker.sock`) or remote via env `DOCKER_HOST`

## Installation

```bash
bun install
```

## Usage

### Local Development

```bash
# Watch all containers
bun start --all

# Watch specific containers  
bun start --containers api,worker --since 5m

# With webhook alerts
SLACK_WEBHOOK_URL=https://hooks.slack.com/... bun start --all
LARK_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/... bun start --all

# Development with auto-restart
bun dev --all

# Direct execution (executable via shebang)
./index.ts --all
```

### Docker Deployment

```bash
# Pull the pre-built image
docker pull ghcr.io/guo/docker-log-sentinel:latest

# Monitor all containers (default behavior)
docker run --name log-sentinel --restart=always \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  ghcr.io/guo/docker-log-sentinel:latest

# Monitor specific containers by name
docker run --name log-sentinel --restart=always \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  ghcr.io/guo/docker-log-sentinel:latest \
  --containers api,worker,database

# Monitor with time range and webhook alerts
docker run --name log-sentinel --restart=always \
  -e SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK" \
  -e LARK_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/XXXX" \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  ghcr.io/guo/docker-log-sentinel:latest \
  --containers myapp,redis --since 10m --summarizeEvery 600

# Or build locally if needed
docker build -t log-sentinel .
docker run --name log-sentinel --restart=always \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  log-sentinel --all
```

### Direct Deployment

For production environments where you want to run the sentinel directly on the host:

```bash
# Clone and install
git clone <repository-url>
cd docker-log-sentinel
bun install

# Run as a background service (using nohup)
nohup bun start --all --summarizeEvery 300 > sentinel.log 2>&1 &

# Or monitor specific containers with webhook
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK" \
nohup bun start --containers api,worker,database --since 5m > sentinel.log 2>&1 &

# Check if running
ps aux | grep "bun.*index.ts"

# View logs
tail -f sentinel.log

# Stop the service
pkill -f "bun.*index.ts"
```

#### Systemd Service (Recommended for Linux)

Create a systemd service for automatic startup and management:

```bash
# Create service file
sudo tee /etc/systemd/system/docker-log-sentinel.service > /dev/null <<EOF
[Unit]
Description=Docker Log Sentinel
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/docker-log-sentinel
ExecStart=/usr/local/bin/bun start --all --summarizeEvery 300
Environment=SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
sudo systemctl enable docker-log-sentinel
sudo systemctl start docker-log-sentinel

# Check status
sudo systemctl status docker-log-sentinel

# View logs
sudo journalctl -u docker-log-sentinel -f
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