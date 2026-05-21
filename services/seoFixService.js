/**
 * Full SEO repair — detects site purpose and adds every standard meta/tag.
 */

import { detectWebsiteType } from './websiteAuditService.js'

export function inferSeoMetaFromHtml(html, filePath = '') {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  const rawTitle = (titleMatch?.[1] || ogTitle?.[1] || h1Match?.[1] || '').trim()
  const h1Text = (h1Match?.[1] || rawTitle || 'Welcome').trim()
  const brand = rawTitle.split('|')[0].split('-')[0].trim() || h1Text || 'Your Website'
  const websiteType = detectWebsiteType(html)
  const pathHint = filePath.replace(/\\/g, '/').toLowerCase()

  let purpose = `${brand} — professional ${websiteType.toLowerCase()}`
  if (/pricing|payment/i.test(pathHint)) purpose = `${brand} pricing and plans`
  else if (/about/i.test(pathHint)) purpose = `About ${brand} — mission and team`
  else if (/contact/i.test(pathHint)) purpose = `Contact ${brand} — get in touch`
  else if (/blog|article|post/i.test(pathHint)) purpose = `${brand} blog — articles and insights`
  else if (/product|shop/i.test(pathHint)) purpose = `${brand} products and catalog`

  const description = `${purpose}. Explore features, benefits, and trusted solutions tailored for you.`.slice(0, 160)
  const pageTitle =
    rawTitle && rawTitle.length >= 10
      ? rawTitle.slice(0, 60)
      : `${h1Text} | ${brand}`.slice(0, 60)

  const keywords = [
    brand.toLowerCase(),
    websiteType.toLowerCase(),
    ...h1Text.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
    'web',
    'online',
  ]
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 12)
    .join(', ')

  const canonical = 'https://yoursite.com' + (pathHint && pathHint !== 'index.html' ? `/${pathHint.replace(/^\/+/, '')}` : '')

  return {
    brand,
    pageTitle,
    description,
    keywords,
    websiteType,
    h1Text,
    canonical,
    ogImage: 'https://yoursite.com/og-image.jpg',
    twitterHandle: '@yourbrand',
  }
}

function injectAfterTitle(html, block) {
  if (/<\/title>/i.test(html)) return html.replace(/<\/title>/i, `</title>\n${block}`)
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>\n${block}`)
  return `<head>\n${block}\n</head>\n` + html
}

function injectBeforeHeadClose(html, block) {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${block}\n</head>`)
  return html + `\n${block}`
}

/** Complete SEO fix with context-aware copy */
export function fixWebsiteHtmlSEO(html, siteContext = null) {
  if (!html || html.trim().length < 20) {
    return { fixed: html, log: ['⚠️ Empty HTML — skipped'] }
  }

  const ctx = siteContext || inferSeoMetaFromHtml(html)
  let fixed = html
  const log = []

  if (!/<!DOCTYPE/i.test(fixed)) {
    fixed = `<!DOCTYPE html>\n` + fixed
    log.push('✅ Added DOCTYPE html')
  }

  if (!/<html/i.test(fixed)) {
    fixed = `<html lang="en">\n${fixed}\n</html>`
    log.push('✅ Wrapped with <html>')
  }

  if (!/<head/i.test(fixed)) {
    fixed = fixed.replace(/<html([^>]*)>/i, `<html$1>\n<head></head>`)
    log.push('✅ Added <head>')
  }

  if (!/<body/i.test(fixed)) {
    fixed = fixed.replace(/<\/head>/i, `</head>\n<body>\n`) + '\n</body>'
    log.push('✅ Added <body>')
  }

  if (/<html(?![^>]*\blang=)/i.test(fixed)) {
    fixed = fixed.replace(/<html([^>]*)>/i, '<html$1 lang="en">')
    log.push('✅ Added lang="en"')
  }

  if (!/<meta[^>]+charset/i.test(fixed)) {
    fixed = fixed.replace(/<head([^>]*)>/i, `<head$1>\n  <meta charset="UTF-8" />`)
    log.push('✅ Added charset UTF-8')
  }

  if (!/<title[^>]*>[^<]+<\/title>/i.test(fixed)) {
    if (/<title[\s>]/i.test(fixed)) {
      fixed = fixed.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${ctx.pageTitle}</title>`)
    } else {
      fixed = fixed.replace(/<head([^>]*)>/i, `<head$1>\n  <title>${ctx.pageTitle}</title>`)
    }
    log.push(`✅ Set <title> (${ctx.websiteType})`)
  } else if (/<title>\s*<\/title>/i.test(fixed)) {
    fixed = fixed.replace(/<title>\s*<\/title>/i, `<title>${ctx.pageTitle}</title>`)
    log.push('✅ Filled empty <title>')
  }

  const metaBlocks = []

  if (!/<meta[^>]+name=["']description["'][^>]+content=["'][^"']{10,}/i.test(fixed)) {
    metaBlocks.push(`  <meta name="description" content="${ctx.description}" />`)
    log.push('✅ Added meta description (auto-detected purpose)')
  }

  if (!/<meta[^>]+name=["']keywords["']/i.test(fixed)) {
    metaBlocks.push(`  <meta name="keywords" content="${ctx.keywords}" />`)
    log.push('✅ Added meta keywords')
  }

  if (!/<meta[^>]+name=["']author["']/i.test(fixed)) {
    metaBlocks.push(`  <meta name="author" content="${ctx.brand}" />`)
    log.push('✅ Added meta author')
  }

  if (!/<meta[^>]+name=["']viewport["']/i.test(fixed)) {
    metaBlocks.push(`  <meta name="viewport" content="width=device-width, initial-scale=1.0" />`)
    log.push('✅ Added viewport (mobile)')
  }

  if (!/<meta[^>]+name=["']robots["']/i.test(fixed)) {
    metaBlocks.push(`  <meta name="robots" content="index, follow, max-image-preview:large" />`)
    log.push('✅ Added robots meta')
  }

  if (!/<meta[^>]+name=["']theme-color["']/i.test(fixed)) {
    metaBlocks.push(`  <meta name="theme-color" content="#0f172a" />`)
    log.push('✅ Added theme-color')
  }

  if (!/<link[^>]+rel=["']icon["']/i.test(fixed)) {
    metaBlocks.push(`  <link rel="icon" href="/favicon.ico" type="image/x-icon" />`)
    log.push('✅ Added favicon link')
  }

  if (!/<link[^>]+rel=["']canonical["']/i.test(fixed)) {
    metaBlocks.push(`  <link rel="canonical" href="${ctx.canonical}" />`)
    log.push('✅ Added canonical URL')
  }

  if (!/<meta[^>]+property=["']og:type["']/i.test(fixed)) {
    metaBlocks.push(`  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${ctx.brand}" />
  <meta property="og:title" content="${ctx.pageTitle}" />
  <meta property="og:description" content="${ctx.description}" />
  <meta property="og:image" content="${ctx.ogImage}" />
  <meta property="og:url" content="${ctx.canonical}" />
  <meta property="og:locale" content="en_US" />`)
    log.push('✅ Added Open Graph tags')
  }

  if (!/<meta[^>]+name=["']twitter:card["']/i.test(fixed)) {
    metaBlocks.push(`  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="${ctx.twitterHandle}" />
  <meta name="twitter:title" content="${ctx.pageTitle}" />
  <meta name="twitter:description" content="${ctx.description}" />
  <meta name="twitter:image" content="${ctx.ogImage}" />`)
    log.push('✅ Added Twitter Card tags')
  }

  if (metaBlocks.length) fixed = injectAfterTitle(fixed, metaBlocks.join('\n'))

  const imgNoAlt = (fixed.match(/<img(?![^>]*\balt=)[^>]*>/gi) || []).length
  if (imgNoAlt > 0) {
    fixed = fixed.replace(/<img(?![^>]*\balt=)([^>]*)>/gi, `<img$1 alt="${ctx.h1Text} — image">`)
    log.push(`✅ Added alt text to ${imgNoAlt} image(s)`)
  }

  const h1Count = (fixed.match(/<h1[\s>]/gi) || []).length
  if (h1Count === 0 && /<body/i.test(fixed)) {
    fixed = fixed.replace(/<body([^>]*)>/i, `<body$1>\n  <h1>${ctx.h1Text}</h1>`)
    log.push(`✅ Added <h1> (${ctx.h1Text})`)
  }

  if (!/<script[^>]+application\/ld\+json/i.test(fixed)) {
    const schema = {
      '@context': 'https://schema.org',
      '@type': ctx.websiteType === 'E-commerce' ? 'Store' : ctx.websiteType === 'Blog' ? 'Blog' : 'WebSite',
      name: ctx.brand,
      description: ctx.description,
      url: ctx.canonical,
    }
    fixed = injectBeforeHeadClose(
      fixed,
      `  <script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n  </script>`
    )
    log.push(`✅ Added Schema.org JSON-LD (${ctx.websiteType})`)
  }

  if (log.length === 0) log.push('✅ SEO complete — all standard tags present')
  return { fixed, log, context: ctx }
}

function generateIndexHtmlFromProject(files, siteContext) {
  const jsx = files.find((f) => /\.(jsx|tsx)$/i.test(f.name || f.path || ''))
  const compMatch = jsx?.content?.match(/export\s+default\s+function\s+(\w+)/)
  const compName = compMatch?.[1] || 'App'
  const ctx = siteContext || { pageTitle: `${compName} | App`, description: 'Modern web application', brand: compName, canonical: 'https://yoursite.com', ogImage: 'https://yoursite.com/og-image.jpg', h1Text: compName, websiteType: 'SaaS', keywords: 'app, web', twitterHandle: '@app' }
  const shell = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${ctx.pageTitle}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>`
  const { fixed, log } = fixWebsiteHtmlSEO(shell, ctx)
  return {
    path: 'index.html',
    name: 'index.html',
    content: fixed,
    log: ['✅ Created index.html with full SEO (React project detected)', ...log],
  }
}

export function fixFolderSEOFiles(files) {
  let htmlFiles = files.filter((f) => /\.(html?|htm)$/i.test(f.path || f.name || ''))
  const logs = []

  if (htmlFiles.length === 0) {
    const hasReact = files.some((f) => /\.(jsx|tsx|js)$/i.test(f.name || ''))
    if (hasReact) {
      const generated = generateIndexHtmlFromProject(files)
      htmlFiles = [generated]
      logs.push('📄 No HTML found — generated index.html with complete SEO')
    } else {
      return { files: [], summary: 'No HTML/JSX in folder', websiteType: 'Unknown', logs: ['⚠️ Open a folder with .html or React files'] }
    }
  }

  const indexFile =
    htmlFiles.find((f) => /(^|\/)index\.html?$/i.test(f.path || f.name)) || htmlFiles[0]
  const siteContext = inferSeoMetaFromHtml(indexFile.content, indexFile.path)

  const results = []
  const allLogs = [...logs, `🌐 Site type: ${siteContext.websiteType}`, `🏷 Brand: ${siteContext.brand}`]

  for (const file of htmlFiles) {
    const pageCtx = {
      ...siteContext,
      ...inferSeoMetaFromHtml(file.content, file.path),
      brand: siteContext.brand,
    }
    const { fixed, log } = fixWebsiteHtmlSEO(file.content, pageCtx)
    results.push({
      path: file.path,
      name: file.name,
      content: fixed,
      log,
    })
    allLogs.push(`📄 ${file.name}: ${log.length} change(s)`)
  }

  return {
    files: results,
    websiteType: siteContext.websiteType,
    brand: siteContext.brand,
    summary: `Fixed SEO on ${results.length} HTML file(s)`,
    logs: allLogs,
  }
}
