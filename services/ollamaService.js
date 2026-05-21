/**
 * Ollama local LLM — set OLLAMA_BASE_URL and OLLAMA_MODEL in .env
 */

const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '')
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'codellama'
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 90000

let ollamaAvailableCache = { at: 0, ok: false }

export async function isOllamaAvailable(force = false) {
  const now = Date.now()
  if (!force && now - ollamaAvailableCache.at < 15000) return ollamaAvailableCache.ok
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: ctrl.signal })
    clearTimeout(t)
    ollamaAvailableCache = { at: now, ok: res.ok }
    return res.ok
  } catch {
    ollamaAvailableCache = { at: now, ok: false }
    return false
  }
}

async function ollamaChat(userPrompt, systemPrompt = '') {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userPrompt },
        ],
      }),
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
  const raw = await ollamaChat(user, system)
  const parsed = extractJson(raw)
  if (parsed?.issues && Array.isArray(parsed.issues)) {
    return {
      issues: parsed.issues,
      score: typeof parsed.score === 'number' ? parsed.score : 70,
      summary: parsed.summary || 'Ollama analysis complete',
      aiModel: `Ollama (${OLLAMA_MODEL})`,
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
  return { baseUrl: OLLAMA_BASE, model: OLLAMA_MODEL }
}
