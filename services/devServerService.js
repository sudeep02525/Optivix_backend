import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

let devProcess = null
let logBuffer = []
let previewUrl = null
let startedAt = null
let currentCwd = null

const MAX_LOG = 500

function pushLog(line) {
  logBuffer.push(line)
  if (logBuffer.length > MAX_LOG) logBuffer = logBuffer.slice(-MAX_LOG)
  const m =
    line.match(/https?:\/\/localhost:\d+/i) ||
    line.match(/https?:\/\/127\.0\.0\.1:\d+/i) ||
    line.match(/ready\s+on\s+(https?:\/\/[^\s]+)/i) ||
    line.match(/Local:\s+(https?:\/\/[^\s]+)/i)
  if (m) previewUrl = (m[1] || m[0]).replace(/[^\x21-\x7E]+$/, '')
}

export function startDevServer(cwd) {
  if (!cwd || typeof cwd !== 'string') {
    return { ok: false, error: 'Project folder path is required' }
  }
  const resolved = path.resolve(cwd.trim())
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: `Folder not found: ${resolved}` }
  }
  const pkg = path.join(resolved, 'package.json')
  if (!fs.existsSync(pkg)) {
    return { ok: false, error: 'No package.json — open a Node/Next.js project folder' }
  }
  if (devProcess) {
    return { ok: false, error: 'Dev server already running', previewUrl, cwd: currentCwd }
  }

  logBuffer = []
  previewUrl = null
  currentCwd = resolved
  startedAt = Date.now()

  const isWin = process.platform === 'win32'
  devProcess = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev'], {
    cwd: resolved,
    shell: isWin,
    env: { ...process.env, FORCE_COLOR: '0' },
  })

  const onData = (chunk) => {
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => pushLog(line))
  }

  devProcess.stdout?.on('data', onData)
  devProcess.stderr?.on('data', onData)

  devProcess.on('exit', (code) => {
    pushLog(`[optivix] Dev server exited (code ${code ?? '?'})`)
    devProcess = null
  })

  pushLog(`[optivix] Starting npm run dev in ${resolved}`)
  return { ok: true, cwd: resolved, message: 'Starting dev server…' }
}

export function stopDevServer() {
  if (!devProcess) return { ok: true, message: 'Not running' }
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(devProcess.pid), '/f', '/t'])
    } else {
      devProcess.kill('SIGTERM')
    }
  } catch {
    devProcess.kill()
  }
  devProcess = null
  pushLog('[optivix] Dev server stopped')
  return { ok: true }
}

export function getDevServerStatus() {
  return {
    running: !!devProcess,
    previewUrl,
    cwd: currentCwd,
    startedAt,
    logs: logBuffer.slice(-120),
  }
}
