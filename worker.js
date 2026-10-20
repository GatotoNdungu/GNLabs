// GN Labs, Cloudflare Pages "advanced mode" worker (works with drag-and-drop,
// Git or Wrangler deploys). It does two jobs, everything else is served as normal:
//   1. /article?slug=...  : writes the article's title, excerpt and cover image
//      into the HTML so link scrapers (X, Facebook, LinkedIn, WhatsApp, Slack)
//      show a proper preview card. They do not run JavaScript.
//   2. /sitemap.xml       : fixed pages + every published Contentful article.
// The values below are the same public, read-only Content Delivery values used in
// contentful.js. Optional env vars CF_SPACE_ID / CF_ACCESS_TOKEN override them.

// Google Analytics 4 Measurement ID, e.g. "G-ABC123XYZ9". Leave empty to keep analytics off.
// This is the ONLY place it goes: the worker adds the tag to every page automatically.
const GA_ID = "";

const SITE = "https://gnlabs.site";
const SPACE = "qz1tpi20918f";
const TOKEN = "B3_yCnVFGynp0gz5wQe_7yZ_wHovCmpuSFcW7_ai8NY";
const PAGES = [["/",1.0],["/services",0.9],["/projects",0.8],["/resources",0.8],["/about",0.6],["/contact",0.7],["/privacy-policy",0.3],["/terms-of-service",0.3]];

async function cda(env, query) {
  const base = env.CF_API_BASE || "https://cdn.contentful.com";
  const url = `${base}/spaces/${env.CF_SPACE_ID || SPACE}/environments/${env.CF_ENVIRONMENT || "master"}/entries?content_type=article&${query}`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${env.CF_ACCESS_TOKEN || TOKEN}` }, cf: { cacheTtl: 300, cacheEverything: true } });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}
function cover(data, item) {
  const id = item.fields.coverImage && item.fields.coverImage.sys && item.fields.coverImage.sys.id;
  const a = id && ((data.includes && data.includes.Asset) || []).find(x => x.sys.id === id);
  const u = a && a.fields && a.fields.file && a.fields.file.url;
  return u ? "https:" + u : null;
}
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

async function sitemap(env) {
  const day = new Date().toISOString().slice(0,10);
  const rows = PAGES.map(([p,pr]) => `  <url><loc>${SITE}${p}</loc><lastmod>${day}</lastmod><priority>${pr}</priority></url>`);
  const data = await cda(env, "order=-fields.publishDate&limit=1000&select=sys.updatedAt,fields.slug,fields.publishDate");
  for (const it of (data && data.items) || []) {
    const slug = it.fields && it.fields.slug;
    if (slug) rows.push(`  <url><loc>${SITE}/article?slug=${esc(encodeURIComponent(slug))}</loc><lastmod>${esc((it.sys.updatedAt || "").slice(0,10) || day)}</lastmod><priority>0.7</priority></url>`);
  }
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`,
    { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=900" } });
}

async function article(request, env, slug) {
  const res = await env.ASSETS.fetch(request);
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  const data = await cda(env, `fields.slug=${encodeURIComponent(slug)}&limit=1&include=2`);
  const item = data && data.items && data.items[0];
  if (!item || !item.fields.title) return res;
  const f = item.fields, title = f.title, desc = f.excerpt || "";
  const image = cover(data, item) || `${SITE}/og-cover.jpg`;
  const url = `${SITE}/article?slug=${encodeURIComponent(slug)}`;
  const set = (attr, val) => ({ element(el) { el.setAttribute(attr, val); } });
  const out = new Response(new HTMLRewriter()
    .on("title", { element(el) { el.setInnerContent(`${title} | GN Labs`); } })
    .on('meta[name="description"]', set("content", desc))
    .on('link[rel="canonical"]', set("href", url))
    .on('meta[property="og:title"]', set("content", title))
    .on('meta[property="og:description"]', set("content", desc))
    .on('meta[property="og:url"]', set("content", url))
    .on('meta[property="og:image"]', set("content", image))
    .on('meta[name="twitter:title"]', set("content", title))
    .on('meta[name="twitter:description"]', set("content", desc))
    .on('meta[name="twitter:image"]', set("content", image))
    .on('meta[name="robots"]', set("content", "index, follow, max-image-preview:large"))
    .transform(res).body, res);
  out.headers.set("cache-control", "public, max-age=300");
  return out;
}

// Adds the GA4 tag to every HTML page. Skipped when GA_ID is empty, or when the visitor's browser
// sends Do Not Track / Global Privacy Control.
function withAnalytics(request, res) {
  if (!GA_ID) return res;
  if (request.headers.get("DNT") === "1" || request.headers.get("Sec-GPC") === "1") return res;
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  const tag = `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>` +
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());` +
    `gtag("config","${GA_ID}",{allow_google_signals:false,allow_ad_personalization_signals:false});</script>`;
  return new HTMLRewriter().on("head", { element(el) { el.append(tag, { html: true }); } }).transform(res);
}

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === "/sitemap.xml") return sitemap(env);
    if ((u.pathname === "/article" || u.pathname === "/article.html") && u.searchParams.get("slug") && request.method === "GET")
      return withAnalytics(request, await article(request, env, u.searchParams.get("slug")));
    return withAnalytics(request, await env.ASSETS.fetch(request));
  }
};
