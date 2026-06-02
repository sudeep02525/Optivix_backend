/**
 * Ollama local LLM — set OLLAMA_BASE_URL and OLLAMA_MODEL in .env
 */

const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 90000

let ollamaAvailableCache = { at: 0, ok: false }
let activeOllamaModel = process.env.OLLAMA_MODEL || 'codellama'

export async function isOllamaAvailable(force = false) {
  const now = Date.now()
  if (!force && now - ollamaAvailableCache.at < 15000) return ollamaAvailableCache.ok
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: ctrl.signal })
    clearTimeout(t)
    
    if (res.ok) {
      const data = await res.json()
      const models = data.models || []
      if (models.length > 0) {
        const configuredModel = process.env.OLLAMA_MODEL || 'codellama'
        const names = models.map(m => m.name)
        
        // Find exact or substring match
        const found = names.find(n => n.toLowerCase().includes(configuredModel.toLowerCase()) || configuredModel.toLowerCase().includes(n.toLowerCase()))
        if (found) {
          activeOllamaModel = found
        } else {
          // Fallback to the first installed model (e.g. llama3.2:latest)
          activeOllamaModel = models[0].name
          console.log(`🤖 Ollama model '${configuredModel}' not found on machine. Using installed model instead: '${activeOllamaModel}'`)
        }
      }
      ollamaAvailableCache = { at: now, ok: true }
      return true
    }
    
    ollamaAvailableCache = { at: now, ok: false }
    return false
  } catch {
    ollamaAvailableCache = { at: now, ok: false }
    return false
  }
}

async function ollamaChat(userPrompt, systemPrompt = '', jsonMode = false) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const requestBody = {
      model: activeOllamaModel,
      stream: false,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userPrompt },
      ],
    }
    if (jsonMode) {
      requestBody.format = 'json'
    }

    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify(requestBody),
    })
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
    const data = await res.json()
    return data.message?.content?.trim() || ''
  } finally {
    clearTimeout(timer)
  }
}

function extractCodeBlock(text) {
  const m = text.match(/```(?:\w+)?\n([\s\S]*?)```/)
  if (m) return m[1].trim()
  return text.trim()
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}

export async function ollamaAnalyzeCode(code, language = 'javascript') {
  const system = `You are a senior code reviewer. Respond with ONLY valid JSON:
{"issues":[{"id":"string","type":"bug|security|performance","severity":"critical|high|medium|low","line":number|null,"title":"string","description":"string","fix":"string"}],"score":0-100,"summary":"string"}`
  const user = `Language: ${language}\n\nAnalyze this code:\n\`\`\`\n${code.slice(0, 12000)}\n\`\`\``
  const raw = await ollamaChat(user, system, true)
  const parsed = extractJson(raw)
  if (parsed?.issues && Array.isArray(parsed.issues)) {
    return {
      issues: parsed.issues,
      score: typeof parsed.score === 'number' ? parsed.score : 70,
      summary: parsed.summary || 'Ollama analysis complete',
      aiModel: `Ollama (${activeOllamaModel})`,
    }
  }
  throw new Error('Ollama returned invalid JSON')
}

export async function ollamaGenerateFix(code, issue, language = 'javascript') {
  const system = 'You fix code precisely. Return ONLY the full fixed source code in one markdown code block. No explanations.'
  const user = `Language: ${language}
Issue: ${issue?.title || 'Unknown'}
${issue?.description || ''}
Suggested fix: ${issue?.fix || ''}

Code:
\`\`\`
${code.slice(0, 10000)}
\`\`\``
  const raw = await ollamaChat(user, system)
  return extractCodeBlock(raw) || code
}

export async function ollamaFixSEO(html, siteContext = '') {
  const system =
    'You are an SEO expert. Add EVERY missing SEO element: title, meta description, keywords, viewport, charset, robots, canonical, Open Graph, Twitter Card, theme-color, favicon, lang, h1, image alt, JSON-LD schema. ' +
    'Use the site context for realistic copy. Return ONLY the full fixed HTML in one markdown code block.'
  const user = `Site context:\n${siteContext}\n\nHTML:\n\`\`\`\n${html.slice(0, 12000)}\n\`\`\``
  const raw = await ollamaChat(user, system)
  return extractCodeBlock(raw) || html
}

export async function ollamaFixAllBugs(code, language = 'javascript', issuesSummary = '', deepFix = false) {
  const isJsx = /jsx|tsx/i.test(language) || /import\s+React|export\s+default|<\w+[\s>]/.test(code)
  const system = deepFix
    ? 'You are a senior engineer doing a FULL file repair. Scan the ENTIRE file. Fix every bug, security issue, and anti-pattern. ' +
      (isJsx
        ? 'For JSX/TSX: fix component syntax, add missing React imports, export default, close all tags, fix keys and hooks. If no CSS/styles exist, add import for a .css file and add className hooks OR add a <style> block with basic layout styles. '
        : '') +
      'ADD anything missing: imports, exports, functions, wrappers, HTML head/body tags, meta tags, closing brackets, semicolons, CSS rules. ' +
      'If the file is truncated or incomplete, reconstruct missing parts so it is valid and runnable. ' +
      'Return ONLY the complete fixed source in one markdown code block — never truncate or use placeholders like "...".'
    : 'You are an expert debugger. Fix ALL listed issues and obvious bugs/security problems. ' +
      'Add missing imports/tags/brackets when clearly required. ' +
      'Return ONLY the complete fixed source in one markdown code block. Keep valid imports/exports. Do not truncate or omit code.'
  const user = `Language: ${language}
${issuesSummary ? `Issues to fix:\n${issuesSummary}\n\n` : 'Detect and fix ALL problems in this file.\n\n'}Code:
\`\`\`
${code.slice(0, 14000)}
\`\`\``
  const raw = await ollamaChat(user, system)
  const fixed = extractCodeBlock(raw)
  return fixed && fixed.length > 10 ? fixed : code
}

export async function ollamaSelfHeal(code, errorMessage, language = 'javascript') {
  const system = 'You are a production incident engineer. Fix the crash with minimal safe changes. Return ONLY fixed code in a markdown block.'
  const user = `Production error:
${errorMessage}

${language} source (fix root cause, use optional chaining where needed):
\`\`\`
${code.slice(0, 10000)}
\`\`\``
  const raw = await ollamaChat(user, system)
  return extractCodeBlock(raw) || code
}

export function getOllamaConfig() {
  return { baseUrl: OLLAMA_BASE, model: activeOllamaModel }
}
