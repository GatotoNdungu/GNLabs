// Live sitemap: fixed pages + every published Contentful article.
// New articles appear here the moment they are published; no redeploy needed.
import { cda } from "./_cf.js";
const SITE = "https://gnlabs.site";
const PAGES = [["/",1.0],["/services",0.9],["/projects",0.8],["/resources",0.8],["/about",0.6],["/contact",0.7],["/privacy-policy",0.3],["/terms-of-service",0.3]];
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

export async function onRequest({ env }) {
  const day = new Date().toISOString().slice(0,10);
  let rows = PAGES.map(([p,pr]) => `  <url><loc>${SITE}${p}</loc><lastmod>${day}</lastmod><priority>${pr}</priority></url>`);
  const data = await cda(env, "order=-fields.publishDate&limit=1000&select=sys.updatedAt,fields.slug,fields.publishDate");
  if (data && data.items) {
    for (const it of data.items) {
      const slug = it.fields && it.fields.slug;
      if (!slug) continue;
      rows.push(`  <url><loc>${SITE}/article?slug=${encodeURIComponent(slug)}</loc><lastmod>${esc((it.sys.updatedAt||"").slice(0,10)||day)}</lastmod><priority>0.7</priority></url>`);
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=900" } });
}
