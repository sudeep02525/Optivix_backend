/**
 * Rule-based "local AI" code analysis — no external APIs.
 */

import { fixWebsiteHtmlSEO } from './websiteAuditService.js'

function computeScore(issues) {
  const c = issues.filter((i) => i.severity === 'critical').length
  const h = issues.filter((i) => i.severity === 'high').length
  const m = issues.filter((i) => i.severity === 'medium').length
  const l = issues.filter((i) => i.severity === 'low').length
  return Math.max(0, 100 - c * 25 - h * 15 - m * 7 - l * 2)
}

export function analyzeHeuristic(code, language = 'javascript') {
  if (!code || String(code).trim().length < 10) {
    return {
      issues: [],
      score: 100,
      summary: 'Add more code to analyze.',
    }
  }

  const issues = []
  const lines = code.split('\n')
  const lang = (language || 'javascript').toLowerCase()
  const isJsLike = ['javascript', 'js', 'jsx', 'typescript', 'ts', 'tsx'].includes(lang)

  if (isJsLike) {
    lines.forEach((line, i) => {
      const n = i + 1
      const t = line.trim()

      if (/console\.(log|warn|error|debug|info)\(/.test(t) && !t.startsWith('//'))
        issues.push({
          id: `con-${n}`,
          type: 'bug',
          severity: 'low',
          line: n,
          title: 'console call in source',
          description: `Line ${n}: console in production can leak data and hurt performance.`,
          fix: 'Remove or gate behind a debug flag / use a logger.',
        })

      if (/([^=!])==([^=])/.test(line) && !t.startsWith('//') && !t.startsWith('*'))
        issues.push({
          id: `eq-${n}`,
          type: 'bug',
          severity: 'medium',
          line: n,
          title: 'Loose equality (==)',
          description: `Line ${n}: == uses type coercion; prefer === for predictable checks.`,
          fix: 'Replace == with === where types are known.',
        })

      if (/^\s*var\s+/.test(line))
        issues.push({
          id: `var-${n}`,
          type: 'bug',
          severity: 'low',
          line: n,
          title: 'var instead of let/const',
          description: `Line ${n}: var is function-scoped; let/const are block-scoped and safer.`,
          fix: 'Use const by default, let when reassigned.',
        })

      if (/\.innerHTML\s*=/.test(t) && !t.startsWith('//'))
        issues.push({
          id: `xss-${n}`,
          type: 'security',
          severity: 'critical',
          line: n,
          title: 'innerHTML assignment',
          description: `Line ${n}: can lead to XSS if data is user-controlled.`,
          fix: 'Use textContent or sanitize; in React prefer JSX.',
        })

      if (/\beval\s*\(/.test(t) && !t.startsWith('//'))
        issues.push({
          id: `eval-${n}`,
          type: 'security',
          severity: 'critical',
          line: n,
          title: 'eval() usage',
          description: `Line ${n}: executes arbitrary strings — major security risk.`,
          fix: 'Remove eval; use JSON.parse or refactor.',
        })

      if (/(password|secret|api_key|apikey|token|private_key)\s*=\s*['"`][^'"`]{3,}/i.test(t) && !t.startsWith('//'))
        issues.push({
          id: `sec-${n}`,
          type: 'security',
          severity: 'critical',
          line: n,
          title: 'Possible hardcoded secret',
          description: `Line ${n}: secrets in source are exposed in repos and bundles.`,
          fix: 'Use environment variables and server-side config only.',
        })

      if (/fetch\s*\(\s*['"`]http:\/\//.test(t) && !t.startsWith('//'))
        issues.push({
          id: `http-${n}`,
          type: 'security',
          severity: 'high',
          line: n,
          title: 'HTTP fetch URL',
          description: `Line ${n}: unencrypted HTTP for APIs or assets.`,
          fix: 'Use https:// endpoints.',
        })
    })

    const asyncCount = (code.match(/async\s+function|async\s*\(/g) || []).length
    const tryCount = (code.match(/try\s*\{/g) || []).length
    if (asyncCount > 0 && tryCount === 0)
      issues.push({
        id: 'async-try',
        type: 'bug',
        severity: 'high',
        line: null,
        title: 'Async without try/catch',
        description: 'Unhandled promise rejections can crash UX.',
        fix: 'Wrap await paths in try/catch or .catch().',
      })
  }

  if (lang === 'json') {
    try {
      JSON.parse(code)
    } catch (e) {
      issues.push({
        id: 'json',
        type: 'bug',
        severity: 'critical',
        line: null,
        title: 'Invalid JSON',
        description: e.message,
        fix: 'Fix syntax (commas, quotes, trailing commas).',
      })
    }
  }

  if (lang === 'html' || /<html|<!DOCTYPE|<head|<body/i.test(code)) {
    const imgNoAlt = (code.match(/<img(?![^>]*\balt=)[^>]*>/gi) || []).length
    if (imgNoAlt > 0)
      issues.push({
        id: 'img-alt',
        type: 'bug',
        severity: 'high',
        line: null,
        title: `${imgNoAlt} img without alt`,
        description: 'Hurts accessibility and SEO.',
        fix: 'Add meaningful alt attributes.',
      })
    if (!/<title[^>]*>[^<]+<\/title>/i.test(code))
      issues.push({
        id: 'title',
        type: 'bug',
        severity: 'critical',
        line: null,
        title: 'Missing or empty <title>',
        description: 'Required for SEO and browser tabs.',
        fix: 'Add a descriptive <title> in <head>.',
      })
  }

  const seen = new Set()
  const deduped = issues.filter((i) => {
    const k = `${i.type}-${i.line}-${i.title}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const score = computeScore(deduped)
  const summary =
    deduped.length === 0
      ? 'No heuristic issues found.'
      : `Found ${deduped.length} issue(s) via local rules.`

  return { issues: deduped, score, summary }
}

export function heuristicSuggestions(code, language = 'javascript') {
  const { issues } = analyzeHeuristic(code, language)
  if (issues.length === 0) return 'No suggestions — code looks clean under local rules.'
  return issues
    .slice(0, 8)
    .map((i) => `• ${i.title}${i.line ? ` (line ${i.line})` : ''}: ${i.fix}`)
    .join('\n')
}

/** Targeted fix for a single reported issue (heuristic fallback when Ollama is off) */
export function applyHeuristicFix(code, issue, language = 'javascript') {
  if (!issue) return code
  let fixed = code
  const title = (issue.title || '').toLowerCase()
  const line = issue.line

  if (title.includes('console')) {
    fixed = fixed.replace(/console\.(log|warn|debug)\(/g, '// console.$1(')
  }
  if (title.includes('==') || title.includes('equality')) {
    fixed = fixed.replace(/([^=!])==([^=])/g, '$1===$2')
  }
  if (title.includes('var ')) {
    fixed = fixed.replace(/\bvar\b/g, 'let')
  }
  if (title.includes('innerhtml') || title.includes('xss')) {
    fixed = fixed.replace(/\.innerHTML\s*=\s*(['"`][^'"`]*['"`])/g, '.textContent = $1')
  }
  if (title.includes('eval')) {
    fixed = fixed.split('\n').map((ln, i) => {
      if (line && i + 1 !== line) return ln
      if (/\beval\s*\(/.test(ln) && !ln.trim().startsWith('//')) {
        return ln.replace(/\beval\s*\(/, '/* eval disabled */ // eval(')
      }
      return ln
    }).join('\n')
  }
  if (title.includes('key') && title.includes('index')) {
    fixed = fixed.replace(/key=\{index\}/g, 'key={item.id}')
  }
  if ((language === 'html' || /<html/i.test(code)) && (title.includes('title') || title.includes('meta') || title.includes('seo') || title.includes('alt'))) {
    return fixWebsiteHtmlSEO(fixed).fixed
  }

  return fixed
}
