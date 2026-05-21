import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

const sessions = new Map()

function getSession(userId) {
  const key = String(userId || 'guest')
  if (!sessions.has(key)) {
    sessions.set(key, { cwd: null, history: [] })
  }
  return sessions.get(key)
}

function pushHistory(session, line) {
  session.history.push(line)
  if (session.history.length > 500) session.history = session.history.slice(-500)
}

export function setTerminalCwd(userId, cwd, options = {}) {
  if (!cwd || typeof cwd !== 'string') return { ok: false, error: 'Path required' }
  const session = getSession(userId)
  const resolved = path.resolve(cwd.trim())

  if (!fs.existsSync(resolved)) {
    if (options.create) {
      try {
        fs.mkdirSync(resolved, { recursive: true })
      } catch (err) {
        return { ok: false, error: `Cannot create folder: ${err.message}` }
      }
    } else {
      return { ok: false, error: `Folder not found: ${resolved}` }
    }
  }

  session.cwd = resolved
  pushHistory(session, `[optivix] Working directory: ${resolved}`)
  return { ok: true, cwd: resolved }
}

export function getTerminalStatus(userId) {
  const session = getSession(userId)
  return { cwd: session.cwd, history: session.history.slice(-150) }
}

export function clearTerminalHistory(userId) {
  const session = getSession(userId)
  session.history = []
  return { ok: true }
}

function runProcess(command, cwd, session) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const child = spawn(command, {
      cwd,
      shell: isWin ? 'cmd.exe' : '/bin/bash',
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (d) => {
      const t = d.toString()
      stdout += t
      t.split(/\r?\n/).forEach((l) => {
        if (l.length) pushHistory(session, l)
      })
    })
    child.stderr?.on('data', (d) => {
      const t = d.toString()
      stderr += t
      t.split(/\r?\n/).forEach((l) => {
        if (l.length) pushHistory(session, `[stderr] ${l}`)
      })
    })

    child.on('close', (code) => {
      if (code !== 0) pushHistory(session, `[exit ${code}]`)
      resolve({ exitCode: code ?? 0, stdout, stderr })
    })

    child.on('error', (err) => {
      pushHistory(session, `[error] ${err.message}`)
      resolve({ exitCode: 1, stdout: '', stderr: err.message })
    })
  })
}

function handleMkdir(session, cmd, cwd) {
  let args = cmd.replace(/^(mkdir|md)\s+/i, '').trim()
  args = args.replace(/^(-p|--parents)\s+/i, '').trim()
  const targets = args.split(/\s+/).filter(Boolean)
  if (!targets.length) {
    pushHistory(session, '[error] mkdir: missing path')
    return
  }
  for (const t of targets) {
    const full = path.isAbsolute(t) ? t : path.resolve(cwd, t.replace(/["']/g, ''))
    try {
      fs.mkdirSync(full, { recursive: true })
      pushHistory(session, `created ${full}`)
      session.cwd = fs.statSync(full).isDirectory() ? full : session.cwd
    } catch (err) {
      pushHistory(session, `[error] ${err.message}`)
    }
  }
}

export async function execTerminalCommand(userId, command, cwdHint) {
  const cmd = (command || '').trim()
  if (!cmd) return { ok: false, error: 'Empty command' }

  const session = getSession(userId)
  let cwd = session.cwd

  if (cwdHint) {
    const set = setTerminalCwd(userId, cwdHint, { create: false })
    if (!set.ok) return set
    cwd = set.cwd
  }

  if (!cwd) {
    return {
      ok: false,
      error: 'Open a folder in Explorer first — project will sync to terminal automatically',
    }
  }

  pushHistory(session, `$ ${cmd}`)

  if (/^cd\s+/i.test(cmd)) {
    const target = cmd.replace(/^cd\s+/i, '').trim().replace(/^["']|["']$/g, '')
    if (target === '..') {
      session.cwd = path.dirname(cwd)
      pushHistory(session, session.cwd)
      return { ok: true, cwd: session.cwd, history: session.history.slice(-150) }
    }
    const next = path.isAbsolute(target) ? target : path.resolve(cwd, target)
    if (!fs.existsSync(next)) {
      pushHistory(session, `[error] Path not found: ${next}`)
      return { ok: true, cwd, history: session.history.slice(-150) }
    }
    session.cwd = next
    pushHistory(session, next)
    return { ok: true, cwd: session.cwd, history: session.history.slice(-150) }
  }

  if (/^clear$/i.test(cmd)) {
    session.history = []
    return { ok: true, cwd: session.cwd, history: [] }
  }

  if (/^(mkdir|md)(\s|$)/i.test(cmd)) {
    handleMkdir(session, cmd, cwd)
    return { ok: true, cwd: session.cwd, history: session.history.slice(-150) }
  }

  await runProcess(cmd, cwd, session)
  return { ok: true, cwd: session.cwd, history: session.history.slice(-150) }
}

/** Point terminal at synced IDE workspace */
export function useWorkspaceAsCwd(userId, workspacePath) {
  return setTerminalCwd(userId, workspacePath, { create: true })
}
