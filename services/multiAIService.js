/**
 * AI layer: Ollama (local LLM) when available, else heuristics.
 * Set AI_PROVIDER=ollama|heuristic|auto (default auto)
 */

import { analyzeHeuristic, heuristicSuggestions, applyHeuristicFix, bulkApplyHeuristicFixes } from './localHeuristicAnalysis.js'
import { fixFolderSEOFiles, fixWebsiteHtmlSEO } from './seoFixService.js'
import {
  isOllamaAvailable,
  ollamaAnalyzeCode,
  ollamaGenerateFix,
  ollamaFixAllBugs,
  ollamaFixSEO,
  ollamaSelfHeal,
  getOllamaConfig,
} from './ollamaService.js'

const AI_PROVIDER = (process.env.AI_PROVIDER || 'auto').toLowerCase()

async function useOllama() {
  if (AI_PROVIDER === 'heuristic') return false
  if (AI_PROVIDER === 'ollama') return isOllamaAvailable(true)
  return isOllamaAvailable()
}

export async function analyzeCode(code, language = 'javascript', fileName = '') {
  if (await useOllama()) {
    try {
      return await ollamaAnalyzeCode(code, language)
    } catch (err) {
      console.warn('Ollama analyze failed, using heuristics:', err.message)
    }
  }
  const { issues, score, summary } = analyzeHeuristic(code, language, fileName)
  return {
    issues,
    score,
    summary,
    aiModel: 'Heuristic (local rules)',
  }
}

export async function generateFix(code, issue, language = 'javascript') {
  if (await useOllama()) {
    try {
      const fixed = await ollamaGenerateFix(code, issue, language)
      if (fixed && fixed.length > 10) {
        return { fixedCode: fixed, aiModel: `Ollama (${getOllamaConfig().model})` }
      }
    } catch (err) {
      console.warn('Ollama fix failed:', err.message)
    }
  }
  const fixedCode = applyHeuristicFix(code, issue, language)
  return { fixedCode, aiModel: 'Heuristic fix' }
}

export async function fixAllBugs(code, language = 'javascript', fileName = '', deepFix = false) {
  let issues = analyzeHeuristic(code, language, fileName).issues
  const log = []

  if (await useOllama()) {
    try {
      const analyzed = await ollamaAnalyzeCode(code, language)
      if (analyzed?.issues?.length) {
        const seen = new Set(issues.map((i) => `${i.title}-${i.line}`))
        for (const i of analyzed.issues) {
          const k = `${i.title}-${i.line}`
          if (!seen.has(k)) {
            seen.add(k)
            issues.push(i)
          }
        }
        log.push(`🔍 AI scan found ${analyzed.issues.length} issue(s)`)
      }
    } catch {
      /* heuristic issues only */
    }
  }

  const issuesSummary = issues
    .slice(0, 30)
    .map((i) => `- ${i.title}${i.line ? ` (line ${i.line})` : ''}: ${i.fix || i.description || ''}`)
    .join('\n')

  if (await useOllama()) {
    try {
      const fixed = await ollamaFixAllBugs(
        code,
        language,
        issuesSummary || 'Detect every problem. Add missing code. Make file complete and runnable.',
        deepFix
      )
      const changed = fixed.trim() !== code.trim() && fixed.length >= code.length * 0.5
      if (changed) {
        return {
          fixedCode: fixed,
          log: [
            '✅ Fixed via Ollama (neural)',
            issues.length ? `📋 Used ${issues.length} detected issue(s) as context` : '📋 Full-file AI repair',
          ],
          aiModel: `Ollama (${getOllamaConfig().model})`,
        }
      }
      log.push('⚠️ Ollama returned unchanged code — applying rule fixes')
    } catch (err) {
      log.push(`⚠️ Ollama failed (${err.message}) — rule-based fix`)
    }
  }

  let fixed = code
  for (const issue of issues) {
    const next = applyHeuristicFix(fixed, issue, language)
    if (next !== fixed) log.push(`✅ ${issue.title}`)
    fixed = next
  }

  const bulk = bulkApplyHeuristicFixes(fixed, fileName)
  fixed = bulk.fixed
  for (const line of bulk.log) {
    if (!log.includes(line)) log.push(line)
  }

  return {
    fixedCode: fixed,
    log: log.length ? log : ['✅ No changes — code may already be clean'],
    aiModel: 'Heuristic (local rules)',
  }
}

export async function fixFolderSEO(files = []) {
  const base = fixFolderSEOFiles(files)
  let aiModel = 'SEO rules (full checklist)'

  if (await useOllama()) {
    const ctx = `Brand: ${base.brand}. Type: ${base.websiteType}. Purpose: ${base.summary}`
    for (const f of base.files) {
      try {
        const enhanced = await ollamaFixSEO(f.content, ctx)
        if (enhanced && enhanced.length > f.content.length * 0.6) {
          f.content = enhanced
          f.log = [...(f.log || []), '✅ Ollama SEO polish']
        }
      } catch {
        /* keep rule-based fix */
      }
    }
    aiModel = `Ollama (${getOllamaConfig().model}) + SEO rules`
  }

  return { ...base, aiModel }
}

export async function fixProjectFiles(files = [], deepFix = true) {
  const codeFiles = files.filter((f) =>
    /\.(jsx|tsx|js|ts|mjs|css|scss|c|cpp|h|hpp|java|go|rs|py|php|sh|sql|rb|json|md)$/i.test(f.path || f.name || '')
  )
  const results = []
  const logs = [`📂 Scanning ${codeFiles.length} code file(s)…`]

  for (const file of codeFiles.slice(0, 30)) {
    const ext = (file.name || file.path || '').split('.').pop()?.toLowerCase()
    let lang = 'javascript'
    
    if (ext === 'css' || ext === 'scss') {
      lang = 'css'
    } else if (ext === 'tsx' || ext === 'ts') {
      lang = 'typescript'
    } else if (ext === 'c' || ext === 'h') {
      lang = 'c'
    } else if (ext === 'cpp' || ext === 'hpp') {
      lang = 'cpp'
    } else if (ext === 'java') {
      lang = 'java'
    } else if (ext === 'go') {
      lang = 'go'
    } else if (ext === 'rs') {
      lang = 'rust'
    } else if (ext === 'py') {
      lang = 'python'
    } else if (ext === 'php') {
      lang = 'php'
    } else if (ext === 'sh') {
      lang = 'shell'
    } else if (ext === 'sql') {
      lang = 'sql'
    } else if (ext === 'rb') {
      lang = 'ruby'
    } else if (ext === 'json') {
      lang = 'json'
    } else if (ext === 'md') {
      lang = 'markdown'
    }
    const r = await fixAllBugs(file.content, lang, file.name || file.path, deepFix)
    results.push({
      path: file.path,
      name: file.name,
      content: r.fixedCode,
      log: r.log,
      aiModel: r.aiModel,
    })
    logs.push(`✅ ${file.name} — ${r.aiModel}`)
  }

  return {
    files: results,
    logs,
    summary: `Fixed ${results.length} file(s)`,
    aiModel: results[0]?.aiModel || 'Heuristic',
  }
}

export async function selfHealCode(code, errorMessage, language = 'javascript') {
  const started = Date.now()
  if (await useOllama()) {
    try {
      const fixedCode = await ollamaSelfHeal(code, errorMessage, language)
      return {
        fixedCode,
        aiModel: `Ollama (${getOllamaConfig().model})`,
        deployTimeMs: Date.now() - started,
        healed: true,
      }
    } catch (err) {
      console.warn('Ollama self-heal failed:', err.message)
    }
  }
  let fixed = code
  if (/Cannot read propert(y|ies) of undefined/i.test(errorMessage)) {
    fixed = fixed.replace(/(\w+)\.(\w+)\.(\w+)/g, (m, a, b, c) => `${a}?.${b}?.${c}`)
    fixed = fixed.replace(/(\w+)\.(\w+)/g, (m, a, b) => {
      if (m.includes('?.')) return m
      return `${a}?.${b}`
    })
  }
  return {
    fixedCode: fixed,
    aiModel: 'Heuristic self-heal',
    deployTimeMs: Date.now() - started,
    healed: fixed !== code,
  }
}

export async function getSuggestions(code, language = 'javascript') {
  return heuristicSuggestions(code, language)
}

export async function checkAIHealth() {
  const ollamaOk = await isOllamaAvailable(true)
  const cfg = getOllamaConfig()
  const sample = 'function x(){ var a=1; return a==1 }'
  const { issues } = analyzeHeuristic(sample, 'javascript')
  return {
    heuristic: issues.length > 0 ? 'healthy' : 'healthy',
    ollama: ollamaOk ? 'healthy' : 'offline',
    ollamaUrl: cfg.baseUrl,
    ollamaModel: cfg.model,
    provider: AI_PROVIDER,
    engine: ollamaOk ? 'ollama+heuristic-fallback' : 'heuristic-only',
  }
}
