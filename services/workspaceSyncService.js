import path from 'path'
import fs from 'fs'

const WORKSPACES_ROOT = path.join(process.cwd(), 'workspaces')

function sanitizeFolderName(name) {
  return (name || 'project').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'project'
}

export function getWorkspaceDir(userId, folderName) {
  return path.join(WORKSPACES_ROOT, String(userId), sanitizeFolderName(folderName))
}

export function ensureWorkspaceDir(userId, folderName) {
  const root = getWorkspaceDir(userId, folderName)
  fs.mkdirSync(root, { recursive: true })
  return root
}

/**
 * Write project files from IDE into backend workspace (real disk for terminal/npm).
 */
export function syncWorkspaceFiles(userId, folderName, files = []) {
  const root = ensureWorkspaceDir(userId, folderName)
  let written = 0
  const skipped = []

  for (const file of files) {
    if (!file?.path || file.content == null) continue
    const rel = String(file.path)
      .replace(/^[/\\]+/, '')
      .replace(/\.\./g, '')
      .replace(/\\/g, '/')
    if (!rel) continue

    const full = path.resolve(root, rel)
    const rootResolved = path.resolve(root)
    if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
      skipped.push(rel)
      continue
    }

    try {
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, file.content, 'utf8')
      written++
    } catch (err) {
      skipped.push(`${rel}: ${err.message}`)
    }
  }

  return {
    ok: true,
    workspacePath: root,
    written,
    total: files.length,
    skipped: skipped.length,
  }
}

export function listWorkspace(userId, folderName) {
  const root = getWorkspaceDir(userId, folderName)
  if (!fs.existsSync(root)) return { ok: false, error: 'Workspace not synced yet' }
  return { ok: true, workspacePath: root, exists: true }
}
