const DATA_ROOT = "./data";
const SITE_NAME = "xAGI Tools";
const DEFAULT_TITLE = `${SITE_NAME} | AI Tools Directory`;
const DEFAULT_DESCRIPTION = "Discover approved AI tools, browse categories, and explore detailed tool profiles from xAGI Labs.";

const state = {
  manifest: null,
  cache: new Map(),
  searchManifest: null,
  searchChunks: new Map(),
  detailManifest: null,
};

const app = document.getElementById("app");
const seo = {
  canonical: document.getElementById("meta-canonical"),
  description: document.querySelector('meta[name="description"]'),
  robots: document.querySelector('meta[name="robots"]'),
  ogType: document.getElementById("meta-og-type"),
  ogTitle: document.getElementById("meta-og-title"),
  ogDescription: document.getElementById("meta-og-description"),
  ogURL: document.getElementById("meta-og-url"),
  twitterTitle: document.getElementById("meta-twitter-title"),
  twitterDescription: document.getElementById("meta-twitter-description"),
  structuredData: document.getElementById("structured-data"),
};

boot().catch((error) => {
  renderError(error);
});

window.addEventListener("hashchange", () => {
  renderRoute().catch((error) => renderError(error));
});

async function boot() {
  state.manifest = await fetchJSON("manifest.json");
  preloadCore(state.manifest).catch(() => {});
  await renderRoute();
}

async function renderRoute() {
  const route = parseRoute();

  if (route.kind === "home") {
    const home = await fetchJSON("home.json");
    renderHome(home);
    return;
  }

  if (route.kind === "tools") {
    const page = route.page || 1;
    const payload = await fetchJSON(pageFilePath("tools/pages", page));
    renderToolList("All Tools", "Browse the approved AI tools catalog.", payload, null);
    return;
  }

  if (route.kind === "categories") {
    const payload = await fetchJSON("categories/index.json");
    renderCategories(payload);
    return;
  }

  if (route.kind === "category") {
    const page = route.page || 1;
    const index = await fetchJSON("categories/index.json");
    const category = index.items.find((item) => item.slug === route.slug);
    if (!category) {
      renderNotFound(`Category "${route.slug}" was not found.`);
      return;
    }
    const payload = await fetchJSON(pageFilePath(`categories/${route.slug}`, page));
    renderToolList(category.name, category.description || "Category listing.", payload, category);
    return;
  }

  if (route.kind === "tool") {
    const tool = await loadToolBySlug(route.slug);
    if (!tool) {
      renderNotFound(`Tool "${route.slug}" was not found.`);
      return;
    }
    renderToolDetail(tool);
    return;
  }

  if (route.kind === "search") {
    const query = route.query.trim();
    if (!query) {
      const home = await fetchJSON("home.json");
      renderHome(home);
      return;
    }
    const results = await searchTools(query);
    renderSearch(query, results);
    return;
  }

  renderNotFound("The requested page was not found.");
}

function parseRoute() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw || raw === "/") {
    return { kind: "home" };
  }

  const [pathPart, queryString = ""] = raw.split("?");
  const path = pathPart.replace(/^\/+/, "");
  const segments = path.split("/").filter(Boolean);
  const query = new URLSearchParams(queryString);

  if (segments[0] === "tools" && segments.length === 1) {
    return { kind: "tools", page: toPositiveInt(query.get("page"), 1) };
  }
  if (segments[0] === "categories" && segments.length === 1) {
    return { kind: "categories" };
  }
  if (segments[0] === "category" && segments[1]) {
    return { kind: "category", slug: decodeURIComponent(segments[1]), page: toPositiveInt(query.get("page"), 1) };
  }
  if (segments[0] === "tool" && segments[1]) {
    return { kind: "tool", slug: decodeURIComponent(segments[1]) };
  }
  if (segments[0] === "search") {
    return { kind: "search", query: query.get("q") || "" };
  }
  return { kind: "not-found" };
}

async function preloadCore(manifest) {
  await Promise.allSettled((manifest.preload || []).map((path) => fetchJSON(path)));
}

async function fetchJSON(path) {
  const normalized = normalizeDataPath(path);
  if (state.cache.has(normalized)) {
    return state.cache.get(normalized);
  }

  const response = await fetch(normalized, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  const data = await response.json();
  state.cache.set(normalized, data);
  return data;
}

async function getSearchManifest() {
  if (!state.searchManifest) {
    state.searchManifest = await fetchJSON("search/manifest.json");
  }
  return state.searchManifest;
}

async function getDetailManifest() {
  if (!state.detailManifest) {
    state.detailManifest = await fetchJSON("tools/detail/manifest.json");
  }
  return state.detailManifest;
}

async function loadToolBySlug(slug) {
  const manifest = await getDetailManifest();
  const shardPath = manifest.lookup[slug];
  if (!shardPath) {
    return null;
  }
  const shard = await fetchJSON(shardPath);
  return shard.items.find((item) => item.slug === slug) || null;
}

async function searchTools(query) {
  const needle = query.trim().toLowerCase();
  const manifest = await getSearchManifest();
  const results = [];

  for (const chunkRef of manifest.chunks) {
    let chunk = state.searchChunks.get(chunkRef.path);
    if (!chunk) {
      chunk = await fetchJSON(chunkRef.path);
      state.searchChunks.set(chunkRef.path, chunk);
    }
    for (const item of chunk.items) {
      if (matchesSearch(item, needle)) {
        results.push(item);
      }
    }
  }

  results.sort((a, b) => {
    const aScore = scoreSearch(a, needle);
    const bScore = scoreSearch(b, needle);
    if (aScore !== bScore) {
      return bScore - aScore;
    }
    return a.name.localeCompare(b.name);
  });

  return results.slice(0, 120);
}

function matchesSearch(item, needle) {
  return [item.name, item.description, ...(item.tags || []), ...(item.category_slugs || [])]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(needle));
}

function scoreSearch(item, needle) {
  let score = 0;
  if (item.name.toLowerCase().startsWith(needle)) score += 8;
  if (item.name.toLowerCase().includes(needle)) score += 5;
  if ((item.description || "").toLowerCase().includes(needle)) score += 2;
  if ((item.tags || []).some((tag) => tag.toLowerCase().includes(needle))) score += 2;
  return score;
}

function renderHome(home) {
  app.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">xAGI Labs</p>
        <h1>Discover AI tools across the categories that matter.</h1>
        <p>Browse approved tools, explore categories, and open detailed profiles to find the right product faster.</p>
      </div>
      <div class="hero-stats">
        ${renderStat(home.stats.tool_count, "approved tools")}
        ${renderStat(home.stats.category_count, "categories")}
      </div>
      <div class="hero-actions">
        <form class="search-box" id="search-form">
          <label for="hero-search">Search tools by name, tag, or category</label>
          <input id="hero-search" name="q" type="search" placeholder="Try: speech, video, design, agents" autocomplete="off">
        </form>
        <a class="button button-primary" href="#/tools">Browse All Tools</a>
      </div>
    </section>

    ${renderCardSection("Newest arrivals", "Recent additions to the directory.", home.newest)}
    ${renderCategorySection(home.top_categories)}
  `;

  updatePageMeta({
    title: "AI Tools Directory",
    description: `Discover ${formatNumber(home.stats.tool_count)} approved AI tools across ${formatNumber(home.stats.category_count)} categories from xAGI Labs.`,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      description: `Discover ${formatNumber(home.stats.tool_count)} approved AI tools across ${formatNumber(home.stats.category_count)} categories from xAGI Labs.`,
      url: currentPageURL(),
      potentialAction: {
        "@type": "SearchAction",
        target: `${currentPageURL().split("#")[0]}#/search?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  });

  const form = document.getElementById("search-form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = new FormData(form).get("q")?.toString().trim() || "";
    window.location.hash = query ? `#/search?q=${encodeURIComponent(query)}` : "#/";
  });
}

function renderCategories(payload) {
  const items = payload.items || [];
  app.innerHTML = `
    <section class="list-shell">
      <div class="list-head">
        <div>
          <p class="eyebrow">Category Index</p>
          <h1>Browse by category</h1>
          <p>${items.length} categories with published tools.</p>
        </div>
        <a class="button button-secondary" href="#/tools">Open all tools</a>
      </div>
      <section class="category-grid">
        ${items.map(renderCategoryCard).join("")}
      </section>
    </section>
  `;

  updatePageMeta({
    title: "AI Tool Categories",
    description: `Browse ${formatNumber(items.length)} AI tool categories curated by xAGI Labs.`,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${SITE_NAME} Categories`,
      description: `Browse ${formatNumber(items.length)} AI tool categories curated by xAGI Labs.`,
      url: currentPageURL(),
    },
  });
}

function renderToolList(title, description, payload, category) {
  const items = payload.items || [];
  const meta = payload.meta || {};
  const routeBase = category ? `#/category/${encodeURIComponent(category.slug)}` : "#/tools";
  const pager = renderPager(meta, routeBase);

  app.innerHTML = `
    <section class="list-shell">
      <div class="list-head">
        <div>
          <p class="eyebrow">${category ? "Category" : "Directory"}</p>
          <h1>${escapeHTML(title)}</h1>
          <p>${escapeHTML(description || "")}</p>
        </div>
        <div class="meta-cluster">
          <span class="meta-chip"><strong>${formatNumber(meta.total_items || 0)}</strong> tools</span>
          <span class="meta-chip"><strong>${formatNumber(meta.total_pages || 1)}</strong> pages</span>
        </div>
      </div>
      <section class="card-grid">
        ${items.map(renderToolCard).join("")}
      </section>
      ${pager}
    </section>
  `;

  updatePageMeta({
    title: category ? `${title} AI Tools` : "Browse AI Tools",
    description: buildListDescription(title, description, meta.total_items || items.length, meta.page || 1, category),
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: category ? `${title} AI Tools` : `${SITE_NAME} Directory`,
      description: buildListDescription(title, description, meta.total_items || items.length, meta.page || 1, category),
      url: currentPageURL(),
    },
  });
}

function renderToolDetail(tool) {
  const description = truncateText(tool.long_description || tool.description || "Explore this AI tool in the xAGI Tools directory.", 160);
  app.innerHTML = `
    <section class="tool-detail">
      <div class="detail-hero">
        <div class="detail-body">
          <p class="eyebrow">Tool Detail</p>
          <h1>${escapeHTML(tool.name)}</h1>
          <p>${escapeHTML(tool.long_description || tool.description || "No description available.")}</p>
          <div class="detail-meta">
            ${tool.pricing_type ? `<span class="meta-chip"><strong>Pricing</strong> ${escapeHTML(tool.pricing_type)}</span>` : ""}
            ${tool.company ? `<span class="meta-chip"><strong>Company</strong> ${escapeHTML(tool.company)}</span>` : ""}
            ${tool.website_url ? `<a class="button button-primary" href="${escapeAttr(tool.website_url)}" target="_blank" rel="noreferrer">Visit Website</a>` : ""}
          </div>
        </div>
        ${tool.logo_url ? `<img src="${escapeAttr(tool.logo_url)}" alt="${escapeAttr(tool.name)} logo" loading="lazy">` : ""}
      </div>

      <div class="detail-grid">
        ${renderDetailPanel("What it is", tool.what_is)}
        ${renderDetailPanel("How to use", tool.how_to_use)}
        ${renderListPanel("Key features", tool.key_features)}
        ${renderListPanel("Platforms", tool.platforms)}
        ${renderListPanel("Tags", tool.tags)}
        ${renderCategoryPanel(tool.categories)}
      </div>
    </section>
  `;

  updatePageMeta({
    title: `${tool.name} AI Tool`,
    description,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: tool.name,
      description,
      applicationCategory: tool.categories?.[0]?.name || "AI Tool",
      operatingSystem: (tool.platforms || []).join(", ") || undefined,
      sameAs: tool.website_url || undefined,
      url: currentPageURL(),
    },
  });
}

function renderSearch(query, results) {
  app.innerHTML = `
    <section class="search-results">
      <div class="list-head">
        <div>
          <p class="eyebrow">Lazy Search</p>
          <h1>Search results for “${escapeHTML(query)}”</h1>
          <p class="search-note">${formatNumber(results.length)} matches found in the directory.</p>
        </div>
        <a class="button button-secondary" href="#/">Back home</a>
      </div>
      <section class="card-grid">
        ${results.length ? results.map(renderSearchCard).join("") : emptyMessage("No tools matched this search query.")}
      </section>
    </section>
  `;

  updatePageMeta({
    title: `Search: ${query}`,
    description: `Search results for ${query} in the xAGI Tools directory.`,
    robots: "noindex,follow",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "SearchResultsPage",
      name: `Search results for ${query}`,
      description: `Search results for ${query} in the xAGI Tools directory.`,
      url: currentPageURL(),
    },
  });
}

function renderNotFound(message) {
  app.innerHTML = `
    <section class="empty-state">
      <p class="eyebrow">Not Found</p>
      <h2>Nothing at this route.</h2>
      <p>${escapeHTML(message)}</p>
      <a class="inline-link" href="#/">Return to home</a>
    </section>
  `;

  updatePageMeta({
    title: "Page Not Found",
    description: "The requested page could not be found in the xAGI Tools directory.",
    robots: "noindex,follow",
  });
}

function renderError(error) {
  console.error(error);
  app.innerHTML = `
    <section class="error-state">
      <p class="eyebrow">Data Error</p>
      <h2>This page could not be loaded.</h2>
      <p>Please refresh the page or try again in a moment.</p>
      <p class="site-note">${escapeHTML(error.message || String(error))}</p>
    </section>
  `;

  updatePageMeta({
    title: "Data Error",
    description: "The xAGI Tools directory could not load this page.",
    robots: "noindex,follow",
  });
}

function renderCardSection(title, description, items, fallback = "") {
  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Homepage Section</p>
          <h2>${escapeHTML(title)}</h2>
          <p>${escapeHTML(description)}</p>
        </div>
      </div>
      <section class="card-grid">
        ${items.length ? items.map(renderToolCard).join("") : fallback}
      </section>
    </section>
  `;
}

function renderCategorySection(items) {
  return `
    <section class="categories-grid">
      <div class="section-head">
        <div>
          <p class="eyebrow">Top Categories</p>
          <h2>Jump into dense pockets of the catalog.</h2>
          <p>Browse categories with the most published tools in the directory.</p>
        </div>
        <a class="button button-secondary" href="#/categories">See all categories</a>
      </div>
      <section class="category-grid">
        ${items.map(renderCategoryCard).join("")}
      </section>
    </section>
  `;
}

function renderToolCard(item) {
  return `
    <article class="tool-card">
      <a class="tool-card__link" href="#/tool/${encodeURIComponent(item.slug)}">
        <div class="tool-card__head">
          ${item.logo_url ? `<img class="tool-card__logo" src="${escapeAttr(item.logo_url)}" alt="${escapeAttr(item.name)} logo" loading="lazy">` : `<div class="tool-card__logo"></div>`}
          <div class="tool-card__title">
            <h3>${escapeHTML(item.name)}</h3>
            <div class="chip-row">
              ${item.pricing_type ? `<span class="chip">${escapeHTML(item.pricing_type)}</span>` : ""}
            </div>
          </div>
        </div>
        <p>${escapeHTML(item.description || "No description available.")}</p>
      </a>
    </article>
  `;
}

function renderSearchCard(item) {
  return `
    <article class="tool-card">
      <a class="tool-card__link" href="#/tool/${encodeURIComponent(item.slug)}">
        <div class="tool-card__head">
          ${item.logo_url ? `<img class="tool-card__logo" src="${escapeAttr(item.logo_url)}" alt="${escapeAttr(item.name)} logo" loading="lazy">` : `<div class="tool-card__logo"></div>`}
          <div class="tool-card__title">
            <h3>${escapeHTML(item.name)}</h3>
            <div class="chip-row">
              ${(item.category_slugs || []).slice(0, 3).map((slug) => `<span class="chip">${escapeHTML(slug)}</span>`).join("")}
            </div>
          </div>
        </div>
        <p>${escapeHTML(item.description || "No description available.")}</p>
      </a>
    </article>
  `;
}

function renderCategoryCard(item) {
  return `
    <article class="category-card">
      <a class="category-card__link" href="#/category/${encodeURIComponent(item.slug)}">
        <div class="chip-row">
          <span class="chip">${item.level === 0 ? "Main" : "Subcategory"}</span>
          <span class="chip">${formatNumber(item.tool_count)} tools</span>
        </div>
        <h3>${escapeHTML(item.name)}</h3>
        <p>${escapeHTML(item.description || "Browse tools in this category.")}</p>
      </a>
    </article>
  `;
}

function renderPager(meta, routeBase) {
  const current = meta.page || 1;
  const total = meta.total_pages || 1;
  return `
    <nav class="pager" aria-label="Pagination">
      <div class="meta-cluster">
        <strong>Page ${current}</strong>
        <span>${formatNumber(meta.total_items || 0)} items</span>
      </div>
      <div class="meta-cluster">
        ${current > 1 ? `<a href="${routePageHref(routeBase, current - 1)}">Previous</a>` : ""}
        ${current < total ? `<a href="${routePageHref(routeBase, current + 1)}">Next</a>` : ""}
      </div>
    </nav>
  `;
}

function renderDetailPanel(title, text) {
  if (!text) {
    return "";
  }
  return `
    <section class="detail-panel">
      <h2>${escapeHTML(title)}</h2>
      <p>${escapeHTML(text)}</p>
    </section>
  `;
}

function renderListPanel(title, items) {
  if (!items || !items.length) {
    return "";
  }
  return `
    <section class="detail-panel">
      <h2>${escapeHTML(title)}</h2>
      <ul>
        ${items.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function renderCategoryPanel(items) {
  if (!items || !items.length) {
    return "";
  }
  return `
    <section class="detail-panel">
      <h2>Categories</h2>
      <div class="chip-row">
        ${items.map((item) => `<a class="chip-link" href="#/category/${encodeURIComponent(item.slug)}">${escapeHTML(item.name)}</a>`).join("")}
      </div>
    </section>
  `;
}

function renderStat(value, label) {
  return `<span class="stat-pill"><strong>${formatNumber(value)}</strong> ${escapeHTML(label)}</span>`;
}

function emptyMessage(message) {
  return `<div class="empty-state"><p>${escapeHTML(message)}</p></div>`;
}

function pageFilePath(base, page) {
  return `${base}/page-${String(page).padStart(4, "0")}.json`;
}

function routePageHref(routeBase, page) {
  return `${routeBase}?page=${page}`;
}

function normalizeDataPath(path) {
  return `${DATA_ROOT}/${String(path).replace(/^\.?\/*/, "")}`;
}

function buildListDescription(title, description, totalItems, page, category) {
  const prefix = category
    ? `Explore ${formatNumber(totalItems)} tools in ${title}.`
    : `Browse ${formatNumber(totalItems)} approved AI tools.`;
  const body = description ? ` ${truncateText(description, 110)}` : "";
  const suffix = page > 1 ? ` Page ${page}.` : "";
  return `${prefix}${body}${suffix}`.trim();
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHTML(value);
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length <= maxLength) {
    return text || DEFAULT_DESCRIPTION;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function currentPageURL() {
  return `${window.location.origin}${window.location.pathname}${window.location.hash || ""}`;
}

function updatePageMeta({ title, description, robots, type = "website", structuredData } = {}) {
  const finalTitle = title ? `${title} | ${SITE_NAME}` : DEFAULT_TITLE;
  const finalDescription = truncateText(description || DEFAULT_DESCRIPTION, 160);
  const finalURL = currentPageURL();
  const finalRobots = robots || "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";

  document.title = finalTitle;
  setMetaContent(seo.description, finalDescription);
  setMetaContent(seo.robots, finalRobots);
  setMetaContent(seo.ogType, type);
  setMetaContent(seo.ogTitle, finalTitle);
  setMetaContent(seo.ogDescription, finalDescription);
  setMetaContent(seo.ogURL, finalURL);
  setMetaContent(seo.twitterTitle, finalTitle);
  setMetaContent(seo.twitterDescription, finalDescription);
  if (seo.canonical) {
    seo.canonical.href = finalURL;
  }
  if (seo.structuredData) {
    seo.structuredData.textContent = JSON.stringify(
      structuredData || {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: finalTitle,
        description: finalDescription,
        url: finalURL,
      },
    );
  }
}

function setMetaContent(element, value) {
  if (element) {
    element.setAttribute("content", value);
  }
}
