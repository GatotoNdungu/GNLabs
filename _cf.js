// Shared helper for the Pages Functions. Reads Contentful with the same
// content type / field names as contentful.js. Set two environment variables
// in Cloudflare Pages (Settings > Variables): CF_SPACE_ID and CF_ACCESS_TOKEN
// (the Content Delivery token, same one used in contentful.js).
export async function cda(env, query) {
  // Defaults are your public Content Delivery values (the same ones already
  // shipped in contentful.js), so no setup is needed; env vars override them.
  const space = env.CF_SPACE_ID || "qz1tpi20918f";
  const token = env.CF_ACCESS_TOKEN || "B3_yCnVFGynp0gz5wQe_7yZ_wHovCmpuSFcW7_ai8NY";
  const env_ = env.CF_ENVIRONMENT || "master";
  const url = `https://cdn.contentful.com/spaces/${space}/environments/${env_}/entries?content_type=article&${query}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) return null;
  return r.json();
}
export function coverUrl(data, item) {
  const id = item.fields.coverImage && item.fields.coverImage.sys && item.fields.coverImage.sys.id;
  const a = id && (data.includes && data.includes.Asset || []).find(x => x.sys.id === id);
  const u = a && a.fields && a.fields.file && a.fields.file.url;
  return u ? "https:" + u : null;
}
