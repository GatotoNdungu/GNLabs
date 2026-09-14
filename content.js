// GN Labs — shared behavior + Contentful integration
//
// Fill these in once your Contentful space is ready. Until then, every page
// renders its static fallback content and never touches the network.
window.GNLABS_CONFIG = {
  spaceId: '',        // e.g. 'abc123xyz'
  accessToken: '',    // Contentful Content Delivery API token (public, read-only — safe client-side)
  environment: 'master'
};

(function () {
  // ---- Mobile nav toggle ----
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  // ---- Hero diagram: single draw-in on load, skipped if motion is reduced ----
  const diagram = document.querySelector('.diagram-wrap');
  if (diagram) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      diagram.classList.add('js'); // opts into the hidden pre-draw state
      requestAnimationFrame(() => requestAnimationFrame(() => diagram.classList.add('drawn')));
    }
    // If reduced motion is on, or this code never runs at all, the diagram
    // simply stays in its default fully-visible state — never broken.
  }
})();

/**
 * Fetches entries of a given content type from Contentful and renders them
 * into `container` using `renderFn`. If no space/token is configured, or the
 * request fails for any reason, the container is left untouched — it already
 * holds real fallback content in the static HTML.
 *
 * @param {string} contentType   Contentful content type ID, e.g. 'project'
 * @param {HTMLElement} container
 * @param {(entries: any[]) => string} renderFn
 */
async function loadFromContentful(contentType, container, renderFn) {
  const { spaceId, accessToken, environment } = window.GNLABS_CONFIG;
  if (!spaceId || !accessToken || !container) return;

  const url = `https://cdn.contentful.com/spaces/${spaceId}/environments/${environment}/entries?content_type=${contentType}&order=-sys.createdAt`;

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Contentful responded ${res.status}`);
    const data = await res.json();
    if (!data.items || !data.items.length) return;
    container.innerHTML = renderFn(data.items);
  } catch (err) {
    // Fallback content already in the DOM — log for diagnosis, change nothing visible.
    console.warn('Contentful fetch skipped, showing static fallback:', err.message);
  }
}
