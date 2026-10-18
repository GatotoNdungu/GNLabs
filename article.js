// Social/search previews: link scrapers (Facebook, LinkedIn, X, WhatsApp,
// Slack) and many crawlers do NOT run JavaScript, so the article's title,
// description and featured image are written into the HTML here, on the
// server, before the page is sent. Visitors still get the normal page.
import { cda, coverUrl } from "./_cf.js";

export async function onRequest(context) {
  const { request, env } = context;
  const res = await context.next();
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug || !(res.headers.get("content-type") || "").includes("text/html")) return res;

  let a = null;
  try {
    const data = await cda(env, `fields.slug=${encodeURIComponent(slug)}&limit=1&include=2`);
    if (data && data.items && data.items[0]) {
      const f = data.items[0].fields;
      a = { title: f.title, excerpt: f.excerpt || "", image: coverUrl(data, data.items[0]), date: f.publishDate || data.items[0].sys.createdAt };
    }
  } catch (e) {}
  if (!a || !a.title) return res;

  const url = `https://gnlabs.site/article?slug=${encodeURIComponent(slug)}`;
  const image = a.image || "https://gnlabs.site/og-cover.jpg";
  const set = (sel, attr, val) => ({ element(el) { el.setAttribute(attr, val); } });
  const rw = new HTMLRewriter()
    .on("title", { element(el) { el.setInnerContent(`${a.title} | GN Labs`); } })
    .on('meta[name="description"]', set(0, "content", a.excerpt))
    .on('link[rel="canonical"]', set(0, "href", url))
    .on('meta[property="og:title"]', set(0, "content", a.title))
    .on('meta[property="og:description"]', set(0, "content", a.excerpt))
    .on('meta[property="og:url"]', set(0, "content", url))
    .on('meta[property="og:image"]', set(0, "content", image))
    .on('meta[name="twitter:title"]', set(0, "content", a.title))
    .on('meta[name="twitter:description"]', set(0, "content", a.excerpt))
    .on('meta[name="twitter:image"]', set(0, "content", image))
    .on('meta[name="robots"]', set(0, "content", "index, follow, max-image-preview:large"));
  const out = new Response(rw.transform(res).body, res);
  out.headers.set("cache-control", "public, max-age=300");
  return out;
}
