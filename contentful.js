/* ============================================================================
   GN Labs — shared Contentful client
   ============================================================================
   Include this one file on every page that needs Contentful content, before
   that page's own <script> block:

     <script src="/assets/contentful.js"></script>

   It gives you window.GNContentful with:
     .isConfigured()                 → true once SPACE_ID + ACCESS_TOKEN are set
     .fetchArticles({force})         → all published articles, newest first, cached
     .fetchArticleBySlug(slug,{force})→ a single article by its slug, cached
     .clearCache()                   → wipes the local cache (call after publishing
                                        if you don't want to wait out the TTL)
     .renderRichText(doc)            → turns a Contentful Rich Text field into the
                                        HTML this site's .article-body CSS expects
     .escapeHtml(str) / .formatDate(iso)

   WHY A CACHE, AND WHY LOCALSTORAGE:
   Every page view that calls the Content Delivery API costs one of your
   monthly API calls. Fetching fresh on every visit is the single fastest way
   to burn through the free tier's 100,000/month, especially once more than
   one site shares an organization's quota. Caching each response in the
   visitor's own browser for a short window means repeat views (and most
   single-session browsing) cost zero extra calls, at the price of new
   content taking up to CACHE_TTL_MS to show up for someone who already has a
   cached copy. Tune that trade-off below.
============================================================================ */
window.GNContentful = (function () {

  // --------------------------------------------------------------------
  // FILL THESE IN once the Contentful Space exists — nothing else in this
  // file, or in blog.html / article.html, needs to change after that.
  // --------------------------------------------------------------------
  const SPACE_ID = 'qz1tpi20918f';
  const ACCESS_TOKEN = 'B3_yCnVFGynp0gz5wQe_7yZ_wHovCmpuSFcW7_ai8NY';
  const ENVIRONMENT = 'master';
  const CONTENT_TYPE = 'article';

  // How long a cached response is trusted before a fresh fetch is made.
  // 15 minutes is a reasonable default for a blog that doesn't publish
  // more than a few times a week. Lower it if you want fresher content at
  // the cost of more API calls; raise it if you're watching the quota.
  const CACHE_TTL_MS = 15 * 60 * 1000;

  const CACHE_PREFIX = 'gnlabs:cf:';

  function isConfigured() {
    return Boolean(SPACE_ID && ACCESS_TOKEN);
  }

  // ---- Cache: a thin, fail-silent wrapper around localStorage ----
  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const { value, expires } = JSON.parse(raw);
      if (Date.now() > expires) {
        localStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }
      return value;
    } catch (err) {
      return null; // Private browsing, storage disabled, or corrupt entry
    }
  }

  function cacheSet(key, value, ttl = CACHE_TTL_MS) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ value, expires: Date.now() + ttl }));
    } catch (err) {
      // Storage full or unavailable — the page just fetches live every
      // time for this visitor, which is a safe degradation, not a failure.
    }
  }

  function clearCache() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(CACHE_PREFIX))
      .forEach(k => localStorage.removeItem(k));
  }

  // ---- Low-level fetch against the Content Delivery API ----
  async function cdaFetch(query) {
    const url = `https://cdn.contentful.com/spaces/${SPACE_ID}/environments/${ENVIRONMENT}/entries?${query}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
    if (!res.ok) throw new Error('Contentful request failed: ' + res.status);
    return res.json();
  }

  function mapAssets(data) {
    const assetMap = {};
    ((data.includes && data.includes.Asset) || []).forEach(a => {
      assetMap[a.sys.id] = (a.fields && a.fields.file && a.fields.file.url) ? 'https:' + a.fields.file.url : null;
    });
    return assetMap;
  }

  function mapEntry(item, assetMap) {
    const f = item.fields || {};
    const imgId = f.coverImage && f.coverImage.sys && f.coverImage.sys.id;
    return {
      id: item.sys.id,
      title: f.title || 'Untitled',
      slug: f.slug || item.sys.id,
      excerpt: f.excerpt || '',
      category: f.category || 'software',
      image: (imgId && assetMap[imgId]) || null,
      date: f.publishDate || item.sys.createdAt,
      readTime: f.readTime || '5 min read',
      featured: !!f.featured,
      author: f.author || null,
      body: f.body || null // Rich Text document, if the field is present
    };
  }

  // ---- Public: every published article, newest first, cached ----
  async function fetchArticles({ force = false } = {}) {
    if (!isConfigured()) return null;
    const cacheKey = `articles:${SPACE_ID}`;
    if (!force) {
      const cached = cacheGet(cacheKey);
      if (cached) return cached;
    }
    try {
      const data = await cdaFetch(`content_type=${CONTENT_TYPE}&order=-fields.publishDate&limit=100`);
      if (!data.items) return [];
      const assetMap = mapAssets(data);
      const articles = data.items.map(item => mapEntry(item, assetMap));
      cacheSet(cacheKey, articles);
      return articles;
    } catch (err) {
      console.warn('[GN Labs] Contentful fetch failed — caller should fall back to sample data.', err);
      return null;
    }
  }

  // ---- Public: a single article by slug, cached ----
  async function fetchArticleBySlug(slug, { force = false } = {}) {
    if (!isConfigured() || !slug) return null;
    const cacheKey = `article:${SPACE_ID}:${slug}`;
    if (!force) {
      const cached = cacheGet(cacheKey);
      if (cached) return cached;
    }
    try {
      const data = await cdaFetch(`content_type=${CONTENT_TYPE}&fields.slug=${encodeURIComponent(slug)}&limit=1`);
      if (!data.items || !data.items.length) return null;
      const assetMap = mapAssets(data);
      const article = mapEntry(data.items[0], assetMap);
      cacheSet(cacheKey, article);
      return article;
    } catch (err) {
      console.warn(`[GN Labs] Contentful fetch failed for slug "${slug}".`, err);
      return null;
    }
  }

  // ==========================================================================
  // Minimal Rich Text renderer
  // ==========================================================================
  // Covers paragraphs, H2/H3 (with auto-generated ids so the TOC scrollspy in
  // article.html can find them), lists, blockquotes, hyperlinks, bold/italic/
  // inline-code marks, horizontal rules, and embedded assets (rendered as
  // captioned figures). It deliberately does NOT guess at custom blocks like
  // callouts, pull quotes, or code blocks — model those as their own
  // Contentful content types and embed them, then extend renderEmbeddedEntry()
  // below with one branch per type. Three are stubbed in already
  // (codeBlock / callout / pullQuote) matching the classes already defined
  // in article.html's <style>, so those work the moment you create matching
  // content types in Contentful with the field names shown.
  // ==========================================================================

  function renderRichText(doc) {
    if (!doc || !doc.content) return '';
    return doc.content.map(renderNode).join('');
  }

  function renderMarks(text, marks) {
    let html = escapeHtml(text);
    (marks || []).forEach(m => {
      if (m.type === 'bold') html = `<strong>${html}</strong>`;
      if (m.type === 'italic') html = `<em>${html}</em>`;
      if (m.type === 'code') html = `<code>${html}</code>`;
    });
    return html;
  }

  function renderInline(nodes) {
    return (nodes || []).map(n => {
      if (n.nodeType === 'text') return renderMarks(n.value, n.marks);
      if (n.nodeType === 'hyperlink') {
        const href = (n.data && n.data.uri) ? n.data.uri : '#';
        return `<a href="${escapeHtml(href)}">${renderInline(n.content)}</a>`;
      }
      return renderInline(n.content);
    }).join('');
  }

  function renderNode(node) {
    switch (node.nodeType) {
      case 'paragraph':
        return `<p>${renderInline(node.content)}</p>`;
      case 'heading-2':
        return `<h2 id="${slugifyHeading(node.content)}">${renderInline(node.content)}</h2>`;
      case 'heading-3':
        return `<h3 id="${slugifyHeading(node.content)}">${renderInline(node.content)}</h3>`;
      case 'unordered-list':
        return `<ul>${(node.content || []).map(renderListItem).join('')}</ul>`;
      case 'ordered-list':
        return `<ol>${(node.content || []).map(renderListItem).join('')}</ol>`;
      case 'blockquote':
        return `<blockquote>${(node.content || []).map(renderNode).join('')}</blockquote>`;
      case 'hr':
        return '<hr>';
      case 'embedded-asset-block':
        return renderEmbeddedAsset(node);
      case 'embedded-entry-block':
        return renderEmbeddedEntry(node);
      default:
        return renderInline(node.content);
    }
  }

  function renderListItem(li) {
    return `<li>${(li.content || []).map(c => renderInline(c.content)).join('')}</li>`;
  }

  function renderEmbeddedAsset(node) {
    const asset = node.data && node.data.target;
    if (!asset || !asset.fields) return '';
    const url = asset.fields.file ? 'https:' + asset.fields.file.url : '';
    const alt = asset.fields.description || asset.fields.title || '';
    return `<figure class="article-figure"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">${alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : ''}</figure>`;
  }

  // Add one branch per custom embeddable content type you create in
  // Contentful. Field names below (label/code, label/text, text) are a
  // starting point — match them to whatever you actually name the fields.
  function renderEmbeddedEntry(node) {
    const entry = node.data && node.data.target;
    const type = entry && entry.sys && entry.sys.contentType && entry.sys.contentType.sys.id;
    const f = (entry && entry.fields) || {};

    if (type === 'codeBlock') {
      return `<div class="code-block"><span class="code-label">${escapeHtml(f.label || f.language || 'code')}</span>${escapeHtml(f.code || '')}</div>`;
    }
    if (type === 'callout') {
      return `<div class="callout"><p class="callout-label mb-2">${escapeHtml(f.label || 'Note')}</p><p class="text-ink text-[0.9375rem] leading-relaxed">${escapeHtml(f.text || '')}</p></div>`;
    }
    if (type === 'pullQuote') {
      return `<div class="pull-quote">${escapeHtml(f.text || '')}</div>`;
    }
    console.warn(`[GN Labs] No renderer for embedded content type "${type}" — add a branch in renderEmbeddedEntry().`);
    return '';
  }

  function slugifyHeading(content) {
    const text = (content || []).map(n => n.value || '').join(' ');
    return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  // ---- Small shared utilities ----
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return {
    isConfigured,
    fetchArticles,
    fetchArticleBySlug,
    clearCache,
    renderRichText,
    escapeHtml,
    formatDate
  };
})();
