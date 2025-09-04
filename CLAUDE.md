# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Docker Log Sentinel is a TypeScript CLI tool that monitors Docker container logs for errors and sends intelligent alerts. It's a single-file application (`index.js`) that uses TypeScript via ts-node.

## Architecture

### Core Components

- **Main CLI**: Single-file architecture using yargs for argument parsing
- **Docker Integration**: Uses dockerode library to connect to Docker daemon
- **Log Processing Pipeline**: 
  - Streams logs from containers in real-time
  - Applies error detection regex patterns
  - Normalizes log lines to create fingerprints for deduplication
  - Rate limits alerts per container/error type
- **Alert System**: Supports stdout logging and webhook notifications (Slack/Lark)
- **State Management**: In-memory tracking of error hits and alert timestamps

### Key Features

- Monitor specific containers by name or all running containers
- Configurable error detection patterns (default: error, exception, panic, etc.)
- Noise filtering with ignore patterns (healthchecks, heartbeats, etc.)
- Deduplication via normalized fingerprinting (removes UUIDs, IPs, timestamps, hex values)
- Rate limiting to prevent alert spam (default: 120s between identical alerts)
- Periodic summary reports (default: every 5 minutes)
- Support for both Slack and Lark webhooks

## Running the Application

### Basic Usage
```bash
# Run with ts-node directly (recommended)
ts-node index.js --all

# Watch specific containers
ts-node index.js --containers api,worker --since 5m

# With webhook alerts
SLACK_WEBHOOK_URL=https://hooks.slack.com/... ts-node index.js --all
LARK_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/... ts-node index.js --all
```

### Dependencies
- Node.js 18+
- Docker socket access (default: `/var/run/docker.sock`)
- Required packages: `dockerode`, `yargs`

### Configuration Options
- `--all`: Monitor all running containers
- `--containers`: Comma-separated list of container names
- `--since`: Time range for log history (e.g., 10m, 1h, 2025-09-01T00:00:00Z)
- `--patterns`: Custom error detection regex
- `--ignore`: Custom ignore patterns regex
- `--summarizeEvery`: Seconds between summary alerts (default: 300)
- `--rateLimit`: Minimum seconds between identical alerts (default: 120)
- `--dockerSocket`: Custom Docker socket path

### Environment Variables
- `SLACK_WEBHOOK_URL`: Slack webhook for alerts
- `LARK_WEBHOOK_URL`: Lark/Feishu webhook for alerts
- `DOCKER_HOST`: Remote Docker daemon host
- `DOCKER_PORT`: Remote Docker daemon port
- `DOCKER_SOCKET`: Docker socket path override

## Development Notes

### Key Functions
- `normalizeLine()`: Strips volatile data for fingerprinting (index.js:85)
- `fingerprint()`: Creates SHA1 hash for deduplication (index.js:96)
- `streamContainer()`: Main log streaming logic per container (index.js:173)
- `canAlert()`: Rate limiting logic (index.js:163)
- `summaryAlert()`: Periodic summary generation (index.js:133)

### State Management
- `hits`: Per-container error tracking with counts and timestamps
- `lastAlertAt`: Rate limiting state per container/fingerprint
- All state is in-memory only (resets on restart)

### Error Detection
- Default pattern matches common error indicators case-insensitively
- Ignore patterns filter out noise like healthchecks
- Log lines are stripped of Docker metadata before pattern matching