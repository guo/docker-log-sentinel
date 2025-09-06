#!/usr/bin/env bun

/**
 * Docker Log Sentinel
 * --------------------
 * A tiny TypeScript CLI that tails Docker logs and sends smart alerts
 * (deduped + rate-limited) when error-like lines appear.
 *
 * Features
 * - Monitor specific containers (by name) or all running containers
 * - Detect error lines via configurable regex patterns
 * - Ignore noise via ignore patterns
 * - Per-container deduping + rate limiting to prevent alert spam
 * - Aggregated periodic summaries (counts by fingerprint)
 * - Alert to: stdout (always) and optional Webhook (Slack or Lark)
 * - Zero-config defaults, but configurable via flags and env vars
 *
 * Requirements
 * - Node 18+
 * - Docker socket access (default /var/run/docker.sock) or remote via env DOCKER_HOST
 * - npm i dockerode yargs
 *
 * Example
 *   ts-node docker-log-sentinel.ts --all
 *   ts-node docker-log-sentinel.ts --containers api,worker --since 5m
 *   SLACK_WEBHOOK_URL=https://hooks.slack.com/... ts-node docker-log-sentinel.ts --all
 *   LARK_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/... ts-node docker-log-sentinel.ts --all
 */

import Docker from 'dockerode'
import * as readline from 'node:readline'
import * as crypto from 'node:crypto'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

// -------------------- CLI --------------------
const argv = yargs(hideBin(process.argv))
  .scriptName('docker-log-sentinel')
  .usage('$0 [options]')
  .option('all', { type: 'boolean', describe: 'Watch all running containers', default: false })
  .option('containers', { type: 'string', describe: 'Comma-separated container names to watch' })
  .option('since', { type: 'string', describe: 'Only show logs since e.g. 10m, 1h, 2025-09-01T00:00:00Z', default: '10m' })
  .option('patterns', { type: 'string', describe: 'Regex for error detection', default: '(error|exception|panic|fatal|segfault|stack trace|traceback|unhandled|critical|ERR!|failed|reverted|execution reverted|gas needed)' })
  .option('ignore', { type: 'string', describe: 'Regex for lines to ignore (noise)', default: '(healthcheck|heartbeat|timeout=0|connection reset by peer .* retrying|client aborted connection)' })
  .option('summarizeEvery', { type: 'number', describe: 'Seconds between summary alerts', default: 300 })
  .option('rateLimit', { type: 'number', describe: 'Minimum seconds between identical alerts per container', default: 120 })
  .option('maxLineLength', { type: 'number', describe: 'Trim long lines to this length in alerts', default: 500 })
  .option('slackChannel', { type: 'string', describe: 'Override Slack channel (if webhook supports it)' })
  .option('dockerSocket', { type: 'string', describe: 'Docker socket path', default: process.env.DOCKER_SOCKET || '/var/run/docker.sock' })
  .help().argv

// -------------------- Config --------------------
const ALERT_WEBHOOK_URL = process.env.LARK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL || ''
const docker = new Docker(
  process.env.DOCKER_HOST
    ? { host: process.env.DOCKER_HOST, port: process.env.DOCKER_PORT ? Number(process.env.DOCKER_PORT) : 2375 }
    : { socketPath: argv.dockerSocket as string }
)

const errorRegex = new RegExp(argv.patterns as string, 'i')
const ignoreRegex = (argv.ignore as string) ? new RegExp(argv.ignore as string, 'i') : null

const rateLimitSeconds = Number(argv.rateLimit)
const summaryIntervalSeconds = Number(argv.summarizeEvery)
const maxLen = Number(argv.maxLineLength)

// -------------------- State --------------------
interface Hit {
  firstAt: number
  lastAt: number
  count: number
  sample: string
}

// per container -> fingerprint -> Hit
const hits = new Map<string, Map<string, Hit>>()
// per container -> fingerprint -> last alert time (epoch seconds)
const lastAlertAt = new Map<string, Map<string, number>>()

function getBucket<K, V>(m: Map<K, Map<string, V>>, k: K): Map<string, V> {
  if (!m.has(k)) m.set(k, new Map<string, V>())
  return m.get(k) as Map<string, V>
}

function normalizeLine(line: string): string {
  // remove volatile numbers, uuids, hex strings, timestamps to improve deduping
  return line
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/0x[0-9a-f]+/gi, '<hex>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, '<ts>')
    .replace(/\b\d+\b/g, '<num>')
    .slice(0, 4000)
}

function fingerprint(line: string): string {
  const norm = normalizeLine(line)
  return crypto.createHash('sha1').update(norm).digest('hex')
}

function trim(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

async function sendWebhook(text: string) {
  if (!ALERT_WEBHOOK_URL) return
  try {
    // Detect Lark vs Slack by URL pattern
    if (/feishu|lark/.test(ALERT_WEBHOOK_URL)) {
      await fetch(ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } })
      })
    } else {
      await fetch(ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, channel: argv.slackChannel })
      })
    }
  } catch (e) {
    console.error('Webhook failed:', (e as Error).message)
  }
}

async function alertNow(containerName: string, msg: string) {
  const text = `🚨 *${containerName}* error\n${'```'}\n${trim(msg, maxLen)}\n${'```'}`
  console.error(`[ALERT] ${containerName}: ${trim(msg, 200)}`)
  await sendWebhook(text)
}

async function summaryAlert() {
  const now = Math.floor(Date.now() / 1000)
  const lines: string[] = []
  for (const [container, fpMap] of hits) {
    const top = [...fpMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([fp, h]) => `• ${h.count}× since ${new Date(h.firstAt * 1000).toISOString()} — ${trim(h.sample, 160)}`)
    if (top.length) {
      lines.push(`*${container}*\n${top.join('\n')}`)
    }
  }
  if (!lines.length) return
  const text = `🧭 *Docker Log Sentinel summary* @ ${new Date(now * 1000).toISOString()}\n\n${lines.join('\n\n')}`
  console.log(text)
  await sendWebhook(text)
}

function markHit(container: string, fp: string, sample: string) {
  const bucket = getBucket(hits, container)
  const h = bucket.get(fp)
  const now = Math.floor(Date.now() / 1000)
  if (h) {
    h.count++
    h.lastAt = now
  } else {
    bucket.set(fp, { firstAt: now, lastAt: now, count: 1, sample })
  }
}

function canAlert(container: string, fp: string): boolean {
  const bucket = getBucket(lastAlertAt, container)
  const now = Math.floor(Date.now() / 1000)
  const last = bucket.get(fp) || 0
  if (now - last < rateLimitSeconds) return false
  bucket.set(fp, now)
  return true
}

// -------------------- Log streaming --------------------
async function streamContainer(containerId: string, name: string, since: string) {
  const c = docker.getContainer(containerId)
  const opts: any = { stdout: true, stderr: true, follow: true }
  if (since) opts.since = since
  const stream = await c.logs(opts)

  // Create separate streams for stdout and stderr to properly handle Docker log format
  const { PassThrough } = await import('node:stream')
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  c.modem.demuxStream(stream, stdout, stderr)

  // Process both stdout and stderr
  const processLogStream = (logStream: any) => {
    const rl = readline.createInterface({ input: logStream })
    rl.on('line', async (line: string) => {
      if (!line) return
      // Remove Docker log prefix (8 bytes header + timestamp info)
      const text = line.replace(/^.{0,30}[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}.*?\s*/, '').trim()
      if (!text) return
      
      if (ignoreRegex && ignoreRegex.test(text)) return
      if (!errorRegex.test(text)) return

      const fp = fingerprint(text)
      markHit(name, fp, text)
      if (canAlert(name, fp)) {
        await alertNow(name, text)
      }
    })
    rl.on('close', () => {
      console.log(`[${name}] log stream closed`)
    })
  }

  processLogStream(stdout)
  processLogStream(stderr)
}

async function listTargetContainers(): Promise<{ id: string; name: string }[]> {
  const all = await docker.listContainers({ all: false })
  const m = new Map<string, string>()
  for (const c of all) {
    const name = (c.Names?.[0] || '').replace(/^\//, '')
    if (!name) continue
    m.set(c.Id, name)
  }

  const specified = (argv.containers as string | undefined)?.split(',').map((s) => s.trim()).filter(Boolean)
  if (argv.all) {
    return [...m.entries()].map(([id, name]) => ({ id, name }))
  }
  if (specified && specified.length) {
    const results: { id: string; name: string }[] = []
    for (const [id, name] of m) {
      if (specified.includes(name)) results.push({ id, name })
    }
    if (!results.length) {
      console.error('No matching running containers for:', specified.join(', '))
      process.exit(2)
    }
    return results
  }
  console.error('Specify --all or --containers <name1,name2>')
  process.exit(2)
}

function parseSince(since: string): number | undefined {
  if (!since) return undefined
  const m = /^([0-9]+)([smhd])$/.exec(since)
  if (m) {
    const n = Number(m[1])
    const unit = m[2]
    const seconds = unit === 's' ? n : unit === 'm' ? n * 60 : unit === 'h' ? n * 3600 : n * 86400
    return Math.floor(Date.now() / 1000) - seconds
  }
  const t = Date.parse(since)
  if (!Number.isFinite(t)) return undefined
  return Math.floor(t / 1000)
}

async function main() {
  const targets = await listTargetContainers()
  const sinceEpoch = parseSince(argv.since as string)
  console.log(`Watching ${targets.length} container(s). Patterns=${errorRegex} Ignore=${ignoreRegex}`)

  setInterval(summaryAlert, summaryIntervalSeconds * 1000)

  await Promise.all(
    targets.map(({ id, name }) => streamContainer(id, name, sinceEpoch ? String(sinceEpoch) : ''))
  )
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
