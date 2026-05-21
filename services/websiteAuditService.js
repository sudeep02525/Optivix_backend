/**
 * Website SEO / security / performance audit (server-side HTML fetch)
 */

export function detectWebsiteType(html) {
  const checks = {
    'E-commerce': [/shopify/i, /woocommerce/i, /cart/i, /checkout/i],
    Blog: [/wordpress/i, /wp-content/i, /article/i],
    SaaS: [/dashboard/i, /pricing/i, /subscription/i],
    'Landing Page': [/get-started/i, /sign-up/i],
  }
  let best = 'General Website'
  let max = 0
  for (const [type, patterns] of Object.entries(checks)) {
    const n = patterns.filter(p => p.test(html)).length
    if (n > max) { max = n; best = type }
  }
  return best
}

export function analyzeWebsiteHtml(html, url) {
  const issues = []
  const suggestions = []

  const hasTitle = /<title[^>]*>[^<]+<\/title>/i.test(html)
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const titleText = titleMatch ? titleMatch[1].trim() : ''

  if (!hasTitle || !titleText) {
    issues.push({ cat: 'SEO', sev: 'critical', title: 'Missing <title> tag', desc: 'Every page must have a title tag.', fix: 'Add <title>Your Page Title</title> in <head>.' })
  } else if (titleText.length < 30) {
    issues.push({ cat: 'SEO', sev: 'medium', title: 'Title too short', desc: `Title is ${titleText.length} chars. Aim for 50–60.`, fix: 'Expand the title with keywords.' })
  }

  if (!/<meta[^>]+name=["']description["'][^>]*content=["'][^"']+["']/i.test(html)) {
    issues.push({ cat: 'SEO', sev: 'high', title: 'Missing meta description', desc: 'Needed for search snippets.', fix: 'Add <meta name="description" content="..." />' })
  }

  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    issues.push({ cat: 'SEO', sev: 'high', title: 'Missing viewport meta', desc: 'Site may not be mobile-friendly.', fix: 'Add viewport meta tag.' })
  }

  if (!/<meta[^>]+property=["']og:/i.test(html)) {
    issues.push({ cat: 'SEO', sev: 'medium', title: 'Missing Open Graph tags', desc: 'Social previews will look poor.', fix: 'Add og:title, og:description, og:image.' })
  }

  const imgNoAlt = (html.match(/<img(?![^>]*\balt=)[^>]*>/gi) || []).length
  if (imgNoAlt > 0) {
    issues.push({ cat: 'Accessibility', sev: 'high', title: `${imgNoAlt} images missing alt`, desc: 'Alt text helps SEO and a11y.', fix: 'Add alt="..." to every <img>.' })
  }

  const h1Count = (html.match(/<h1[\s>]/gi) || []).length
  if (h1Count === 0) issues.push({ cat: 'SEO', sev: 'high', title: 'No <h1> tag', desc: 'Pages need one main heading.', fix: 'Add a single <h1>.' })
  else if (h1Count > 1) issues.push({ cat: 'SEO', sev: 'medium', title: `Multiple H1 (${h1Count})`, desc: 'Use one H1 per page.', fix: 'Change extras to H2/H3.' })

  if (!url.startsWith('https://')) {
    issues.push({ cat: 'Security', sev: 'critical', title: 'Not using HTTPS', desc: 'Data is sent unencrypted.', fix: 'Enable SSL and redirect HTTP to HTTPS.' })
  }

  if (!/<html[^>]*\blang=/i.test(html)) {
    issues.push({ cat: 'Accessibility', sev: 'medium', title: 'Missing lang on <html>', desc: 'Screen readers need language.', fix: 'Add lang="en" to <html>.' })
  }

  const criticalCount = issues.filter(i => i.sev === 'critical').length
  const highCount = issues.filter(i => i.sev === 'high').length
  const mediumCount = issues.filter(i => i.sev === 'medium').length
  const lowCount = issues.filter(i => i.sev === 'low').length
  const score = Math.max(0, 100 - criticalCount * 25 - highCount * 15 - mediumCount * 7 - lowCount * 3)

  return {
    issues,
    suggestions,
    score,
    websiteType: detectWebsiteType(html),
    stats: {
      title: titleText,
      imgTotal: (html.match(/<img/gi) || []).length,
      h1Count,
      htmlSize: `${(html.length / 1024).toFixed(1)} KB`,
      hasHTTPS: url.startsWith('https://'),
    },
  }
}

export { fixWebsiteHtmlSEO, inferSeoMetaFromHtml, fixFolderSEOFiles } from './seoFixService.js'

export async function fetchWebsiteHtml(rawUrl) {
  let url = rawUrl.trim()
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  const parsed = new URL(url)
  const res = await fetch(parsed.href, {
    headers: { 'User-Agent': 'Optivix-Audit/1.0 (+https://optivix.app)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} — could not fetch site`)
  const html = await res.text()
  if (!html || html.length < 80) throw new Error('Empty or invalid HTML response')
  return { html, url: parsed.href }
}
