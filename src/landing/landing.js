// The IndoorWay landing page: the first screen when the address names no map.
// A header with menus, then one page at a time: the first page (the hero, a
// picture of the map and the feature cards), Solutions, Showcase (the site's own
// maps opened in frames), Industries and the demo request form. The footer is
// under every page.
// All wording and links are in content.js.
import "./landing.css";
import { escapeHTML } from "../utils/html.js";
import { publicAssetUrl } from "../core/paths.js";
import { BRAND, DEMO, FEATURES, FOOTER, FOOTNOTES, HERO, INDUSTRIES, NAV, SHOWCASE, SOCIAL, SOLUTIONS } from "./content.js";
import { icon } from "./icons.js";
import { PICTURE_KINDS, pictureFile } from "./pictures.js";

const e = escapeHTML;

// Address of one of this site's maps ("org=bcsir&embed=1").
const mapUrl = (item, { embed = false } = {}) => {
  const query = [`org=${encodeURIComponent(item.org)}`, item.query, embed ? "embed=1" : ""].filter(Boolean).join("&");
  return `${publicAssetUrl("")}?${query}`;
};

// "Search any POI*" -> the text and its mark ("*"), when the text ends with one.
export function splitMark(text) {
  const [, body, mark = ""] = /^(.*?)(\*+)?$/s.exec(String(text ?? ""));
  return { body: body.trim(), mark };
}

const brandHTML = () => `<a class="lw-brand" href="#top" aria-label="${e(BRAND.name)} home">
  <img src="${e(publicAssetUrl(BRAND.logo))}" alt="" width="34" height="34" /><span>${e(BRAND.name)}</span></a>`;

const socialHTML = (className) => `<ul class="${className}">${SOCIAL.map((item) =>
  `<li><a href="${e(item.url)}" target="_blank" rel="noopener" aria-label="${e(item.label)}" title="${e(item.label)}">${icon(item.icon)}</a></li>`).join("")}</ul>`;

function navHTML() {
  const entries = NAV.map((entry, index) => {
    const link = `<a class="lw-nav-link" href="#${e(entry.target)}" data-nav="${e(entry.target)}">${e(entry.label)}</a>`;
    if (!entry.menu) return `<li>${link}</li>`;
    const items = entry.menu.map((item) => `<li><a href="#${e(item.target)}">${icon(item.icon)}<span>${e(item.label)}</span></a></li>`).join("");
    return `<li class="lw-menu" data-menu>
      ${link}<button class="lw-menu-toggle" type="button" aria-expanded="false" aria-controls="lw-menu-${index}" aria-label="${e(`${entry.label} menu`)}">${icon("chevron")}</button>
      <ul id="lw-menu-${index}" class="lw-menu-panel${entry.wide ? " lw-menu-wide" : ""}">${items}</ul>
    </li>`;
  }).join("");
  return `<header class="lw-header" id="lw-header">
    <div class="lw-container lw-header-inner">
      ${brandHTML()}
      <button class="lw-burger" type="button" aria-expanded="false" aria-controls="lw-nav" aria-label="Menu">${icon("menu")}${icon("close")}</button>
      <nav id="lw-nav" class="lw-nav" aria-label="Main">
        <ul class="lw-nav-list">${entries}</ul>
        <a class="lw-button" href="#demo">${e(DEMO.cta)}</a>
      </nav>
    </div>
  </header>`;
}

// One of the first page's pictures (pictures.js): the browser takes the lightest
// copy that is sharp on its screen.
function pictureHTML({ file, alt }, kind, { lazy = true } = {}) {
  const { widths, ratio, sizes } = PICTURE_KINDS[kind];
  const width = widths.at(-1);
  const srcset = widths.map((size) => `${publicAssetUrl(pictureFile(file, size))} ${size}w`).join(", ");
  return `<img src="${e(publicAssetUrl(pictureFile(file, widths[0])))}" srcset="${e(srcset)}" sizes="${e(sizes)}" width="${width}" height="${Math.round(width / ratio)}" alt="${e(alt)}" decoding="async"${lazy ? ' loading="lazy"' : ""} />`;
}

// The features of the first page, in one white card: the text on the left and
// the picture on the right (on a narrow screen the picture is on top), one
// feature at a time. The arrows and dots at the top of the text change it
// (setupFeatures). All the texts lie on top of each other, and so do the
// pictures, so the card keeps its size when the feature changes.
function featuresHTML() {
  const { items } = FEATURES;
  const first = (index) => (index === 0 ? " data-active" : "");
  const arrow = (step, label) => `<button class="lw-slider-arrow" type="button" data-step="${step}" aria-label="${e(label)}" title="${e(label)}">${icon("chevron")}</button>`;
  const dots = items.map((item, index) => `<button class="lw-slider-dot" type="button" data-go="${index}" aria-label="${e(item.title)}" title="${e(item.title)}"${index === 0 ? ' aria-current="true"' : ""}>
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle class="lw-slider-spot" cx="10" cy="10" r="4"/><circle class="lw-slider-ring" cx="10" cy="10" r="7.5"/><circle class="lw-slider-arc" cx="10" cy="10" r="7.5" pathLength="100"/></svg></button>`).join("");
  const texts = items.map((item, index) => `<article class="lw-feat-text" data-slide${first(index)} role="group" aria-roledescription="slide" aria-label="${index + 1} / ${items.length}">
    <div class="lw-feat-top">${item.eyebrow ? `<p class="lw-feat-eyebrow">${e(item.eyebrow)}</p>` : ""}</div>
    <h3>${e(item.title)}</h3>
    ${item.lead ? `<p class="lw-feat-lead">${e(item.lead)}</p>` : ""}
    <ul class="lw-feat-points">${item.points.map((text) => `<li>${e(text)}</li>`).join("")}</ul>
    ${item.closing ? `<p class="lw-feat-closing">${e(item.closing)}</p>` : ""}
  </article>`).join("");
  const pictures = items.map((item, index) => `<div class="lw-feat-picture" data-slide${first(index)}>${pictureHTML(item, "card")}</div>`).join("");
  return `<section class="lw-slider" id="lw-features" aria-roledescription="carousel" aria-label="${e(FEATURES.title)}">
    <div class="lw-slider-pager">${arrow(-1, FEATURES.previous)}<div class="lw-slider-dots">${dots}</div>${arrow(1, FEATURES.next)}</div>
    <div class="lw-slider-texts">${texts}</div>
    <div class="lw-slider-pictures">${pictures}</div>
  </section>`;
}

const heroHTML = () => `<section class="lw-hero" id="top" data-page>
  <div class="lw-container lw-hero-text">
    <h1>${e(HERO.title)}<span>${e(HERO.byline)}</span></h1>
    <p class="lw-hero-lead">${e(HERO.lead)}</p>
    <p class="lw-hero-sub">${e(HERO.text)}</p>
    <div class="lw-talk">
      <a class="lw-talk-label" href="#demo">${e(HERO.talk)}</a>
      ${socialHTML("lw-social")}
      <a class="lw-talk-arrow" href="#demo" aria-label="${e(DEMO.cta)}" title="${e(DEMO.cta)}">${icon("arrow")}</a>
    </div>
  </div>
  <div class="lw-container lw-intro">
    <div class="lw-intro-picture">${pictureHTML(FEATURES.picture, "hero", { lazy: false })}</div>
    <h2 class="lw-intro-title">${e(FEATURES.title)}</h2>
    ${featuresHTML()}
  </div>
</section>`;

const headHTML = (section) => `<div class="lw-section-head">
  <p class="lw-eyebrow">${e(section.eyebrow)}</p>
  <h2>${e(section.title)}</h2>
  ${section.lead ? `<p>${e(section.lead)}</p>` : ""}
</div>`;

const solutionsHTML = () => `<section class="lw-section" id="solutions" data-page hidden>
  <div class="lw-container">
    ${headHTML(SOLUTIONS)}
    <div class="lw-cards lw-cards-4">${SOLUTIONS.items.map((item) => `<article class="lw-card" id="solution-${e(item.id)}">
      <span class="lw-card-icon">${icon(item.icon)}</span><h3>${e(item.title)}</h3><p>${e(item.text)}</p></article>`).join("")}</div>
  </div>
</section>`;

function featureHTML(text) {
  const { body, mark } = splitMark(text);
  return `<li>${icon("check")}<span>${e(body)}${mark ? `<sup>${e(mark)}</sup>` : ""}</span></li>`;
}

// A locked map: its picture, blurred, under a lock. Nothing is loaded and
// there is no link to the map.
const lockedFrameHTML = (item, label) => `<div class="lw-frame lw-frame-locked" id="show-${e(item.id)}">
  <div class="lw-frame-bar">
    <span class="lw-frame-title">${e(label)}</span>
    <span class="lw-frame-chip">${icon("lock")}${e(SHOWCASE.locked)}</span>
  </div>
  <div class="lw-frame-stage">
    <img class="lw-frame-poster" src="${e(publicAssetUrl(item.poster))}" alt="" loading="lazy" />
    <div class="lw-frame-lock" role="img" aria-label="${e(SHOWCASE.locked)}">${icon("lock")}</div>
  </div>
</div>`;

function showcaseItemHTML(item) {
  const label = `${item.name}, ${item.kind}`;
  const text = `<div class="lw-show-text">
      <p class="lw-tier">${e(item.tier)}</p>
      <h3>${e(item.name)}</h3>
      <p class="lw-show-kind">${e(item.kind)}</p>
      <ul class="lw-features">${item.features.map(featureHTML).join("")}</ul>
    </div>`;
  if (item.locked) return `<article class="lw-show" data-org="${e(item.org)}">${text}${lockedFrameHTML(item, label)}</article>`;
  return `<article class="lw-show" data-org="${e(item.org)}">
    ${text}
    <div class="lw-frame" id="show-${e(item.id)}" data-state="idle" data-src="${e(mapUrl(item, { embed: true }))}" data-title="${e(label)}">
      <div class="lw-frame-bar">
        <span class="lw-frame-title">${e(label)}</span>
        <a class="lw-frame-action" href="${e(mapUrl(item))}" target="_blank" rel="noopener" title="${e(SHOWCASE.newTab)}" aria-label="${e(SHOWCASE.newTab)}">${icon("external")}</a>
        <button class="lw-frame-action lw-frame-full" type="button" data-full aria-pressed="false">${icon("expand")}${icon("collapse")}<span>${e(SHOWCASE.fullscreen)}</span></button>
      </div>
      <div class="lw-frame-stage">
        <img class="lw-frame-poster" src="${e(publicAssetUrl(item.poster))}" alt="" loading="lazy" />
        <button class="lw-frame-cover" type="button" data-start aria-label="${e(`${SHOWCASE.start}: ${label}`)}">
          <span class="lw-frame-start">${icon("play")}<span data-cover-label>${e(SHOWCASE.start)}</span></span>
        </button>
      </div>
    </div>
  </article>`;
}

function showcaseHTML() {
  const notes = Object.entries(FOOTNOTES).filter(([, text]) => text).map(([mark, text]) => `<p><sup>${e(mark)}</sup> ${e(text)}</p>`).join("");
  return `<section class="lw-section" id="showcase" data-page hidden>
    <div class="lw-container">
      ${headHTML(SHOWCASE)}
      <div class="lw-shows">${SHOWCASE.items.map(showcaseItemHTML).join("")}</div>
      ${notes ? `<div class="lw-notes">${notes}</div>` : ""}
    </div>
  </section>`;
}

const industriesHTML = () => `<section class="lw-section" id="industries" data-page hidden>
  <div class="lw-container">
    ${headHTML(INDUSTRIES)}
    <div class="lw-cards lw-cards-5">${INDUSTRIES.items.map((item) => `<article class="lw-card lw-card-small">
      <span class="lw-card-icon">${icon(item.icon)}</span><h3>${e(item.title)}</h3><p>${e(item.text)}</p></article>`).join("")}</div>
  </div>
</section>`;

function demoHTML() {
  const f = DEMO.fields;
  const field = (name, label, type, autocomplete) => `<label class="lw-field"><span class="lw-visually-hidden">${e(label)}</span>
    <input name="${name}" type="${type}" placeholder="${e(label)}*" autocomplete="${autocomplete}" required /></label>`;
  const options = [...INDUSTRIES.items.map((item) => item.title), DEMO.other].map((title) => `<option>${e(title)}</option>`).join("");
  return `<section class="lw-section" id="demo" data-page hidden>
    <div class="lw-container lw-demo">
      <div class="lw-demo-text">
        <p class="lw-eyebrow">${e(DEMO.eyebrow)}</p>
        <h2>${e(DEMO.title)}</h2>
        <p>${e(DEMO.lead)}</p>
        <div class="lw-expect">
          <h3>${e(DEMO.expectTitle)}</h3>
          <ol>${DEMO.expect.map((text) => `<li>${e(text)}</li>`).join("")}</ol>
        </div>
      </div>
      <form class="lw-form" id="lw-demo-form" novalidate>
        ${field("email", f.email, "email", "email")}
        ${field("phone", f.phone, "tel", "tel")}
        ${field("firstName", f.firstName, "text", "given-name")}
        ${field("lastName", f.lastName, "text", "family-name")}
        ${field("company", f.company, "text", "organization")}
        <label class="lw-field"><span class="lw-visually-hidden">${e(f.mapping)}</span>
          <select name="mapping" required><option value="" selected disabled>${e(f.mapping)}*</option>${options}</select>${icon("chevron")}</label>
        <label class="lw-field lw-field-wide"><span class="lw-visually-hidden">${e(f.details)}</span>
          <textarea name="details" rows="4" placeholder="${e(f.details)}"></textarea></label>
        <label class="lw-check lw-field-wide"><input name="updates" type="checkbox" /><span>${e(DEMO.consent)}</span></label>
        <div class="lw-field-wide lw-form-foot">
          <button class="lw-button lw-button-large" type="submit">${e(DEMO.submit)}</button>
          <p class="lw-form-status" id="lw-demo-status" role="status" hidden></p>
        </div>
      </form>
    </div>
  </section>`;
}

// Footer: the logo and office address, then the lists of solutions, industries
// and showcase maps.
function footerHTML() {
  const list = (title, target, items, className = "") => `<div class="lw-footer-col">
    <h3><a href="#${e(target)}">${e(title)}</a></h3>
    <ul class="lw-footer-list${className}">${items.map((item) => `<li><a href="#${e(item.target)}">${e(item.label)}</a></li>`).join("")}</ul>
  </div>`;
  return `<footer class="lw-footer">
    <div class="lw-container lw-footer-grid">
      <div class="lw-footer-place">
        ${brandHTML()}
        <p class="lw-footer-tagline">${e(FOOTER.tagline)}</p>
        <address>${icon("pin")}<strong>${e(BRAND.city)}</strong>${BRAND.address.map((line) => `<span>${e(line)}</span>`).join("")}</address>
      </div>
      ${list(SOLUTIONS.eyebrow, "solutions", SOLUTIONS.items.map((item) => ({ label: item.title, target: `solution-${item.id}` })))}
      ${list(INDUSTRIES.eyebrow, "industries", INDUSTRIES.items.map((item) => ({ label: item.title, target: "industries" })), " lw-footer-list-2")}
      <div class="lw-footer-col">
        <h3><a href="#showcase">${e(SHOWCASE.eyebrow)}</a></h3>
        <ul class="lw-footer-list">${SHOWCASE.items.map((item) => `<li><a href="#show-${e(item.id)}">${e(`${item.name}, ${item.kind}`)}</a></li>`).join("")}</ul>
        <h3>${e(FOOTER.contact)}</h3>
        <ul class="lw-footer-list"><li><a href="mailto:${e(BRAND.email)}">${e(BRAND.email)}</a></li><li><a href="#demo">${e(DEMO.cta)}</a></li></ul>
      </div>
    </div>
    <div class="lw-container"><p class="lw-footer-base">© ${new Date().getFullYear()} ${e(BRAND.company)}</p></div>
  </footer>`;
}

// ---- Behaviour ---------------------------------------------------------------

function setupHeader(root) {
  const header = root.querySelector("#lw-header");
  const burger = root.querySelector(".lw-burger");
  const menus = Array.from(root.querySelectorAll("[data-menu]"));
  const desktop = window.matchMedia("(min-width: 961px) and (pointer: fine)");

  const setMenu = (menu, open) => {
    menu.toggleAttribute("data-open", open);
    menu.querySelector("button").setAttribute("aria-expanded", String(open));
  };
  const closeMenus = (except) => menus.forEach((menu) => { if (menu !== except) setMenu(menu, false); });
  const setNav = (open) => {
    header.toggleAttribute("data-nav-open", open);
    burger.setAttribute("aria-expanded", String(open));
  };

  menus.forEach((menu) => {
    menu.querySelector("button").addEventListener("click", () => { const open = !menu.hasAttribute("data-open"); closeMenus(menu); setMenu(menu, open); });
    menu.addEventListener("mouseenter", () => { if (desktop.matches) { closeMenus(menu); setMenu(menu, true); } });
    menu.addEventListener("mouseleave", () => { if (desktop.matches) setMenu(menu, false); });
  });
  burger.addEventListener("click", () => setNav(!header.hasAttribute("data-nav-open")));
  header.addEventListener("click", (event) => { if (event.target.closest("a")) { closeMenus(); setNav(false); } });
  document.addEventListener("click", (event) => { if (!header.contains(event.target)) closeMenus(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeMenus(); setNav(false); } });

  const onScroll = () => header.toggleAttribute("data-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

// One page at a time. The address (#solutions, #showcase, #solution-indoor-map,
// ...) names a page or something inside one; without it the hero is shown.
function setupPages(root) {
  const pages = Array.from(root.querySelectorAll("[data-page]"));
  const links = Array.from(root.querySelectorAll("[data-nav]"));
  function show() {
    let target = null;
    try { target = root.querySelector(`#${CSS.escape(decodeURIComponent(window.location.hash.slice(1)))}`); } catch (_) { /* not a name on this page */ }
    const page = target?.closest("[data-page]") || pages[0];
    pages.forEach((item) => { item.hidden = item !== page; });
    links.forEach((link) => { if (link.dataset.nav === page.id) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
    if (target && target !== page) target.scrollIntoView({ behavior: "instant", block: "start" });
    else window.scrollTo({ top: 0, behavior: "instant" });
  }
  window.addEventListener("hashchange", show);
  show();
}

// The feature card of the first page shows one feature at a time. An arrow, a
// dot, a swipe or the left and right keys change it. Until the visitor does
// that, the card moves on by itself every FEATURES.seconds: the ring around the
// current dot fills meanwhile (a CSS animation, which is the timer too) and
// stands still while the pointer or the keyboard is on the card, or the card is
// off the screen. Once the visitor has chosen a feature the card stays on it.
// With "reduce motion" set, or seconds: 0, it never moves by itself.
function setupFeatures(root) {
  const slider = root.querySelector(".lw-slider");
  if (!slider) return;
  const texts = Array.from(slider.querySelectorAll(".lw-feat-text"));
  const pictures = Array.from(slider.querySelectorAll(".lw-feat-picture"));
  const dots = Array.from(slider.querySelectorAll(".lw-slider-dot"));
  const live = slider.querySelector(".lw-slider-texts");
  const count = texts.length;
  let current = 0;

  // `step` is the side the new feature comes in from: 1 from the right, -1 from the left.
  function show(index, step) {
    const next = ((index % count) + count) % count;
    if (next === current) return;
    const incoming = texts[next];
    incoming.style.transition = "none";
    incoming.dataset.side = step > 0 ? "after" : "before";
    void incoming.offsetWidth; // it stands on its side before it moves in
    incoming.style.transition = "";
    texts[current].dataset.side = step > 0 ? "before" : "after";
    for (const stack of [texts, pictures]) {
      stack[current].removeAttribute("data-active");
      stack[next].setAttribute("data-active", "");
    }
    dots[current].removeAttribute("aria-current");
    dots[next].setAttribute("aria-current", "true");
    current = next;
  }

  const stopAuto = () => { slider.dataset.auto = "off"; live.setAttribute("aria-live", "polite"); };
  const choose = (index, step) => { stopAuto(); show(index, step); };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (FEATURES.seconds > 0 && !reduced.matches) {
    slider.dataset.auto = "on";
    slider.style.setProperty("--lw-slider-time", `${FEATURES.seconds}s`);
    live.setAttribute("aria-live", "off");
    reduced.addEventListener?.("change", () => { if (reduced.matches) stopAuto(); });
  } else stopAuto();

  // The ring is full: the next feature.
  slider.addEventListener("animationend", (event) => {
    if (event.animationName === "lw-slider-fill" && slider.dataset.auto === "on") show(current + 1, 1);
  });
  // The reasons the ring stands still.
  const holds = new Set();
  const hold = (reason, on) => { if (on) holds.add(reason); else holds.delete(reason); slider.toggleAttribute("data-paused", holds.size > 0); };
  slider.addEventListener("pointerenter", (event) => { if (event.pointerType === "mouse") hold("pointer", true); });
  slider.addEventListener("pointerleave", () => hold("pointer", false));
  slider.addEventListener("focusin", () => hold("focus", true));
  slider.addEventListener("focusout", () => hold("focus", false));
  document.addEventListener("visibilitychange", () => hold("hidden", document.hidden));
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => hold("away", !entry.isIntersecting), { threshold: 0.2 }).observe(slider);
  }

  slider.querySelectorAll("[data-step]").forEach((button) => button.addEventListener("click", () => { const step = Number(button.dataset.step); choose(current + step, step); }));
  dots.forEach((dot, index) => dot.addEventListener("click", () => choose(index, index > current ? 1 : -1)));
  slider.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step) { event.preventDefault(); choose(current + step, step); }
  });
  // A swipe across the card (up and down still scrolls the page).
  let touch = null;
  slider.addEventListener("pointerdown", (event) => { touch = event.pointerType === "mouse" ? null : { x: event.clientX, y: event.clientY }; });
  slider.addEventListener("pointercancel", () => { touch = null; });
  slider.addEventListener("pointerup", (event) => {
    if (!touch) return;
    const dx = event.clientX - touch.x;
    const dy = event.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 44 && Math.abs(dx) > 1.5 * Math.abs(dy)) choose(current + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
  });
}

// A showcase frame (unless locked) starts as a picture with a button ("idle"). The map is loaded
// on the first click ("live"). When the frame scrolls out of view, or another
// page is opened, it is covered again ("paused"), so scrolling the page with the
// wheel never zooms a map by accident; one click gives the map back.
function setupShowcase(root) {
  const frames = Array.from(root.querySelectorAll(".lw-frame:not(.lw-frame-locked)"));
  const isFull = (frame) => document.fullscreenElement === frame || frame.classList.contains("is-expanded");

  function activate(frame) {
    if (!frame.querySelector("iframe")) {
      const map = document.createElement("iframe");
      map.src = frame.dataset.src;
      map.title = frame.dataset.title;
      map.allow = "fullscreen; geolocation; accelerometer; gyroscope; magnetometer";
      map.addEventListener("load", () => setTimeout(() => frame.classList.add("is-loaded"), 600), { once: true });
      frame.querySelector(".lw-frame-stage").prepend(map);
    }
    frame.dataset.state = "live";
  }
  function pause(frame) {
    if (frame.dataset.state !== "live" || isFull(frame)) return;
    frame.dataset.state = "paused";
    frame.querySelector("[data-cover-label]").textContent = SHOWCASE.resume;
  }
  function syncFull(frame) {
    const full = isFull(frame);
    const button = frame.querySelector("[data-full]");
    button.setAttribute("aria-pressed", String(full));
    button.querySelector("span").textContent = full ? SHOWCASE.exitFullscreen : SHOWCASE.fullscreen;
    document.documentElement.toggleAttribute("data-lw-expanded", frames.some((item) => item.classList.contains("is-expanded")));
  }
  // The Fullscreen API where the browser has it (not on iPhones); otherwise the
  // frame is stretched over the whole page.
  function toggleFull(frame) {
    if (document.fullscreenElement === frame) { document.exitFullscreen(); return; }
    if (frame.classList.contains("is-expanded")) { frame.classList.remove("is-expanded"); syncFull(frame); return; }
    activate(frame);
    const expand = () => { frame.classList.add("is-expanded"); syncFull(frame); };
    if (frame.requestFullscreen) frame.requestFullscreen().catch(expand); else expand();
  }
  const collapseAll = () => frames.filter((frame) => frame.classList.contains("is-expanded")).forEach((frame) => { frame.classList.remove("is-expanded"); syncFull(frame); });

  frames.forEach((frame) => {
    frame.querySelector("[data-start]").addEventListener("click", () => activate(frame));
    frame.querySelector("[data-full]").addEventListener("click", () => toggleFull(frame));
  });
  document.addEventListener("fullscreenchange", () => frames.forEach(syncFull));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") collapseAll(); });
  window.addEventListener("hashchange", collapseAll);
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (!entry.isIntersecting) pause(entry.target); }));
    frames.forEach((frame) => observer.observe(frame));
  }

  // A map whose organisation folder was removed is left out of the showcase.
  fetch(publicAssetUrl("data/catalog.json"), { cache: "no-cache" })
    .then((response) => (response.ok ? response.json() : null))
    .then((catalog) => {
      if (!catalog?.organisations) return;
      const known = new Set(catalog.organisations.map((org) => org.id));
      root.querySelectorAll(".lw-show").forEach((show) => { show.hidden = !known.has(show.dataset.org); });
    })
    .catch(() => { /* the showcase stays as written */ });
}

// The request as plain text, for the email.
export function demoMessage(values) {
  const f = DEMO.fields;
  return [
    `${f.firstName}: ${values.firstName || ""}`,
    `${f.lastName}: ${values.lastName || ""}`,
    `${f.company}: ${values.company || ""}`,
    `${f.email}: ${values.email || ""}`,
    `${f.phone}: ${values.phone || ""}`,
    `${f.mapping} ${values.mapping || ""}`,
    "",
    "Project details:",
    values.details || "",
    "",
    `News and updates: ${values.updates ? "yes" : "no"}`
  ].join("\n");
}

function setupDemoForm(root) {
  const form = root.querySelector("#lw-demo-form");
  const status = root.querySelector("#lw-demo-status");
  const say = (text, { mail = false, error = false } = {}) => {
    status.innerHTML = `${e(text)}${mail ? ` <a href="mailto:${e(BRAND.email)}">${e(BRAND.email)}</a>.` : ""}`;
    status.classList.toggle("is-error", error);
    status.hidden = false;
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const data = new FormData(form);
    const values = Object.fromEntries(data);
    if (!DEMO.endpoint) {
      window.location.href = `mailto:${BRAND.email}?subject=${encodeURIComponent(DEMO.subject)}&body=${encodeURIComponent(demoMessage(values))}`;
      say(DEMO.sentMail, { mail: true });
      return;
    }
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    try {
      const response = await fetch(DEMO.endpoint, { method: "POST", headers: { Accept: "application/json" }, body: data });
      if (!response.ok) throw new Error(`${response.status}`);
      form.reset();
      say(DEMO.sent);
    } catch (error) {
      console.error("The demo request could not be sent:", error);
      say(DEMO.failed, { mail: true, error: true });
    } finally {
      button.disabled = false;
    }
  });
}

// The page's font (landing.css) is already on its way: index.html asks for it.
// Waiting a moment for it lets the page be laid out once, in its own font,
// instead of first in a system font and then again when the font arrives. On a
// slow connection the page does not wait longer than this; the font is swapped
// in when it comes.
const FONT_WAIT_MS = 200;
const fontReady = () => Promise.race([
  document.fonts?.load?.("1em Manrope").catch(() => { /* the system font is used */ }),
  new Promise((resolve) => { setTimeout(resolve, FONT_WAIT_MS); })
]);

export async function showLanding() {
  const root = document.querySelector("#landing");
  document.documentElement.dataset.theme = "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#FAF4EC");
  await fontReady();
  root.innerHTML =`${navHTML()}<main>${heroHTML()}${solutionsHTML()}${showcaseHTML()}${industriesHTML()}${demoHTML()}</main>${footerHTML()}`;
  root.hidden = false;
  setupHeader(root);
  setupFeatures(root);
  setupShowcase(root);
  setupDemoForm(root);
  setupPages(root);
}
