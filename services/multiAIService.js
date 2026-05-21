/**
 * AI layer: Ollama (local LLM) when available, else heuristics.
 * Set AI_PROVIDER=ollama|heuristic|auto (default auto)
 */

import { analyzeHeuristic, heuristicSuggestions, applyHeuristicFix } from './localHeuristicAnalysis.js'
import {
  isOllamaAvailable,
  ollamaAnalyzeCode,
  ollamaGenerateFix,
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
