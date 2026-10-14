/**
 * Turns `content.ts` into static HTML. Runs at build time (and on each dev request)
 * from the Vite plugin in vite.config.ts, so all content is real HTML in index.html
 * and readable before, or without, any JavaScript.
 *
 * Structure: the page is a voyage of chapters (pier, five projects, web, about, harbour).
 * Each chapter is a tall section whose stage sticks to the screen while you scroll through it.
 * A project's details are set straight onto the scene as chart annotations (title, Design, Code),
 * each tied by a leader line to something on the lake (the mast, the sail, the buoy).
 */
import type { Content, Link, Project, ProjectVideo } from '../content.ts';
import { CHAPTER_INK } from './chapters.ts';
import { jsonLd, ogImageSize, ogImageUrl, type SeoOptions } from './seo.ts';

export interface RenderOptions {
  /** Checks whether a path under public/ exists, e.g. "/videos/sailing.mp4". */
  publicFileExists: (path: string) => boolean;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const isExternal = (href: string) => /^https?:\/\//.test(href);
const pad = (n: number) => String(n).padStart(2, '0');

/** The invite's last word, linked to the contact link it names (plain text if there is none). */
function inviteLink(c: Content): string {
  const { link: label } = c.contact.invite;
  const target = c.contact.links.find((l) => l.label === label);
  if (!target) return esc(label);
  return `<a class="ann-inline" href="${esc(target.href)}" target="_blank" rel="noopener">${esc(label)}${NEW_TAB}</a>`;
}

const NEW_TAB = '<span class="visually-hidden"> (opens in a new tab)</span>';

function link(l: Link, cls = ''): string {
  const ext = isExternal(l.href);
  const attrs = ext ? ' target="_blank" rel="noopener"' : '';
  const arrow = `<span class="arrow" aria-hidden="true">${ext ? '↗' : '→'}</span>`;
  return `<a${cls ? ` class="${cls}"` : ''} href="${esc(l.href)}"${attrs}>${esc(l.label)}${arrow}${ext ? NEW_TAB : ''}</a>`;
}

/** Short, readable form of a link target for the contact list. */
function displayHref(href: string): string {
  if (!isExternal(href)) return href.replace(/^\//, '');
  try {
    const u = new URL(href);
    return decodeURI(u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, ''));
  } catch {
    return href;
  }
}

interface Clip {
  mp4?: string;
  webm?: string;
  poster?: string;
}

/** A chapter with media on the lake: a project, or the web chapter. */
interface Media {
  id: string;
  title: string;
  video: ProjectVideo;
}

/** The chapter's media files that actually exist in public/videos (a clip, or just a still). */
function clipFor(p: Media, opts: RenderOptions): Clip | null {
  const v = p.video;
  const clip: Clip = {
    mp4: opts.publicFileExists(v.mp4) ? v.mp4 : undefined,
    webm: opts.publicFileExists(v.webm) ? v.webm : undefined,
    poster: opts.publicFileExists(v.poster) ? v.poster : undefined,
  };
  return clip.mp4 || clip.webm || clip.poster ? clip : null;
}

const hasVideo = (clip: Clip | null) => !!clip && !!(clip.mp4 || clip.webm);

/** data-clip-* attributes that tell the scene which media to show on the chapter's screen. */
function clipAttrs(clip: Clip | null): string {
  return clip
    ? ` data-clip-mp4="${esc(clip.mp4 ?? '')}" data-clip-webm="${esc(clip.webm ?? '')}" data-clip-poster="${esc(clip.poster ?? '')}"`
    : '';
}

function watchButton(id: string, clip: Clip | null, c: Content): string {
  return hasVideo(clip)
    ? `<button class="watch" type="button" data-watch="${esc(id)}">${esc(c.ui.watchClip)}<span class="arrow" aria-hidden="true">▶</span></button>`
    : '';
}

/**
 * The clip inline, for the static picture and the list view. With the live scene it plays
 * on a screen on the lake instead, and this is hidden.
 */
function inlineClip(p: Media, clip: Clip | null, c: Content): string {
  if (clip && !hasVideo(clip)) {
    return `<div class="clip"><img src="${esc(clip.poster!)}" alt="${esc(p.video.description)}" loading="lazy" decoding="async"></div>`;
  }
  if (!clip) {
    return `<div class="clip clip--empty" role="img" aria-label="${esc(p.video.description)}">
            <span aria-hidden="true">${esc(c.ui.clipPlaceholder)}</span>
          </div>`;
  }
  // Sources use data-src: videos.ts attaches them only when the clip nears the viewport.
  const sources = [
    clip.webm ? `<source data-src="${esc(clip.webm)}" type="video/webm">` : '',
    clip.mp4 ? `<source data-src="${esc(clip.mp4)}" type="video/mp4">` : '',
  ].join('');
  return `<div class="clip">
            <video class="lazy-video" muted loop playsinline preload="none" disablepictureinpicture
              ${clip.poster ? `poster="${esc(clip.poster)}"` : ''} aria-label="${esc(p.video.description)}">${sources}</video>
            <button class="video-toggle" type="button" hidden aria-label="Play video: ${esc(p.title)}">
              <span aria-hidden="true">▶</span>
            </button>
          </div>`;
}

/**
 * The chapter word, as HTML. The live scene paints it on the lake instead and hides this.
 * Hand-lettering in public/lettering/<id>.(svg|png|webp) replaces the brush font.
 */
function word(id: string, text: string, opts: RenderOptions): string {
  const file = ['svg', 'png', 'webp'].map((ext) => `/lettering/${id}.${ext}`).find(opts.publicFileExists);
  const inner = file ? `<img src="${esc(file)}" alt="" loading="lazy" decoding="async">` : esc(text);
  // A phrase (longer than the chapter words) is set smaller so it fits a phone's width.
  const kind = file ? ' chapter-word--art' : text.length > 8 ? ' chapter-word--long' : '';
  return `<p class="chapter-word${kind}" aria-hidden="true">${inner}</p>`;
}

function projectChapter(p: Project, i: number, c: Content, opts: RenderOptions): string {
  const titleId = `project-${p.id}-title`;
  const clip = clipFor(p, opts);
  const clipData = clipAttrs(clip);
  const watch = watchButton(p.id, clip, c);
  return `
    <section class="chapter" id="${esc(p.id)}" data-chapter="${esc(p.id)}" data-project="${esc(p.id)}" data-ink="${CHAPTER_INK[p.id] ?? 'light'}"${clipData} aria-labelledby="${titleId}">
      <div class="stage">
        ${word(p.id, p.word, opts)}
        <article class="annotations">
          <div class="ann ann--title">
            <p class="ann-meta"><span>${esc(c.ui.entryNo)} ${pad(i + 1)}</span><span>${esc(p.engine)}</span><span>${p.meta.map(esc).join(' · ')}</span></p>
            <h3 class="ann-title" id="${titleId}">${esc(p.title)}</h3>
          </div>
          <div class="ann ann--design" data-anchor="sail">
            <h4 class="ann-label">Design</h4>
            <p>${esc(p.design)}</p>
          </div>
          <div class="ann ann--code" data-anchor="buoy">
            <h4 class="ann-label">Code</h4>
            <p>${esc(p.code)}</p>
            <p class="ann-links">${p.links.map((l) => link(l, 'ann-link')).join(' ')}${watch}</p>
          </div>
          ${inlineClip(p, clip, c)}
        </article>
      </div>
    </section>`;
}

/** The websites from the fullstack internship: sites on the left, stack and context on the right. */
function webChapter(c: Content, opts: RenderOptions): string {
  const w = c.web;
  const clip = clipFor(w, opts);
  return `
    <section class="chapter chapter--web" id="${esc(w.id)}" data-chapter="${esc(w.id)}" data-project="${esc(w.id)}" data-ink="${CHAPTER_INK[w.id] ?? 'light'}"${clipAttrs(clip)} aria-labelledby="web-title">
      <div class="stage">
        ${word(w.id, w.word, opts)}
        <article class="annotations">
          <div class="ann ann--title">
            <p class="ann-meta"><span>${esc(c.ui.entryNo)} ${pad(c.projects.length + 1)}</span><span>${esc(w.label)}</span><span>${w.meta.map(esc).join(' · ')}</span></p>
            <h2 class="ann-title" id="web-title">${esc(w.title)}</h2>
          </div>
          <div class="ann ann--design" data-anchor="sail">
            <h3 class="ann-label">${esc(c.ui.sites)}</h3>
            <ul class="sites">
              ${w.sites
                .map(
                  (site) =>
                    `<li><p class="ann-links">${link({ label: site.name, href: site.href }, 'ann-link')}${site.clip ? watchButton(w.id, clip, c) : ''}</p><p>${esc(site.text)}</p></li>`,
                )
                .join('\n              ')}
            </ul>
          </div>
          <div class="ann ann--code" data-anchor="buoy">
            <h3 class="ann-label">${esc(c.ui.internship)}</h3>
            <p>${esc(w.intro)}</p>
            <p class="ann-links"><span class="ann-stack">${esc(w.stack)}</span></p>
          </div>
          ${inlineClip(w, clip, c)}
        </article>
      </div>
    </section>`;
}

export function renderBody(c: Content, opts: RenderOptions): string {
  const chapters = [
    { id: 'pier', href: '#top', name: c.hero.chapter },
    ...c.projects.map((p) => ({ id: p.id, href: `#${p.id}`, name: p.chapter })),
    { id: c.web.id, href: `#${c.web.id}`, name: c.web.chapter },
    { id: 'about', href: '#about', name: c.about.chapter },
    { id: 'harbour', href: '#contact', name: c.contact.chapter },
  ];

  return `
  <a class="skip-link" href="#projects">Skip to projects</a>

  <div class="scene-layer" id="scene-layer" aria-hidden="true">
    <div class="scene-poster"></div>
  </div>
  <div class="scrim" id="scrim" aria-hidden="true"></div>

  <header class="chrome">
    <a class="chrome-name" href="#top">${esc(c.hero.name)}</a>
    <nav class="chapter-nav" aria-label="${esc(c.ui.chapters)}">
      <ol>
        ${chapters
          .map(
            (ch, i) =>
              `<li><a href="${ch.href}" data-nav="${esc(ch.id)}"><span class="nav-no" aria-hidden="true">${pad(i)}</span>${esc(ch.name)}</a></li>`,
          )
          .join('\n        ')}
      </ol>
    </nav>
    <div class="chrome-actions">
      <button class="list-toggle" id="list-toggle" type="button" aria-pressed="false" hidden>${esc(c.ui.listView)}</button>
    </div>
  </header>

  <main id="main">
    <section class="chapter chapter--pier" id="top" data-chapter="pier" data-ink="${CHAPTER_INK.pier}" aria-labelledby="hero-name">
      <div class="stage">
        ${word('pier', c.hero.word, opts)}
        <div class="hero ann">
          <h1 class="hero-meta" id="hero-name">${[c.hero.name, ...c.hero.tagline.split(/(?<=\.)\s+/)]
            .map((t, i) => `<span${i === 0 ? ' class="hero-name"' : ''}>${esc(t.replace(/\.$/, ''))}</span>`)
            .join(' <i aria-hidden="true">/</i> ')}</h1>
          <p class="hero-cue"><span aria-hidden="true">↓</span> ${esc(c.hero.cue)}</p>
        </div>
      </div>
    </section>

    <div class="projects" id="projects" tabindex="-1">
      <div class="list-intro">
        <h2>${esc(c.projectsIntro.title)}</h2>
        <p>${esc(c.projectsIntro.text)}</p>
      </div>
      ${c.projects.map((p, i) => projectChapter(p, i, c, opts)).join('\n')}
    </div>

${webChapter(c, opts)}

    <section class="chapter chapter--about" id="about" data-chapter="about" data-ink="${CHAPTER_INK.about}" aria-labelledby="about-title">
      <div class="stage">
        ${word('about', c.about.word, opts)}
        <article class="annotations">
          <div class="ann ann--title">
            <p class="ann-meta"><span>${esc(c.about.label)}</span></p>
            <h2 class="ann-title" id="about-title">${esc(c.about.title)}</h2>
          </div>
          <div class="ann ann--design ann--wide">
            ${c.about.paragraphs.map((t, i) => `<p${i === 0 ? ' class="ann-lede"' : ''}>${esc(t)}</p>`).join('\n            ')}
          </div>
          <aside class="ann ann--code" data-anchor="sail" aria-labelledby="page-note-title">
            <h3 class="ann-label" id="page-note-title">${esc(c.about.pageNote.title)}</h3>
            <p>${esc(c.about.pageNote.text)}</p>
          </aside>
        </article>
      </div>
    </section>

    <section class="chapter chapter--harbour" id="contact" data-chapter="harbour" data-ink="${CHAPTER_INK.harbour}" aria-labelledby="contact-title" tabindex="-1">
      <div class="stage">
        <article class="annotations">
          <div class="ann ann--title ann--contact">
            <p class="ann-meta"><span>${esc(c.contact.label)}</span></p>
            <h2 class="contact-title" id="contact-title">${esc(c.contact.title)}</h2>
            <p class="ann-lede">${esc(c.contact.text)} ${esc(c.contact.invite.text)} ${inviteLink(c)}.</p>
          </div>
          <div class="ann ann--code ann--ledger">
            <ul class="ledger">
              ${c.contact.links
                .map((l) => {
                  const ext = isExternal(l.href);
                  return `<li><a href="${esc(l.href)}"${ext ? ' target="_blank" rel="noopener"' : ''}><span class="ledger-k">${esc(l.label)}</span><span class="ledger-v">${esc(displayHref(l.href))}</span><span class="arrow" aria-hidden="true">${ext ? '↗' : '→'}</span>${ext ? NEW_TAB : ''}</a></li>`;
                })
                .join('\n              ')}
            </ul>
            <p class="ann-footer">${esc(c.footer)}</p>
          </div>
        </article>
      </div>
    </section>
  </main>

  <div class="leaders" id="leaders" aria-hidden="true"></div>
  <button class="screen-hotspot" id="screen-hotspot" type="button" tabindex="-1" aria-hidden="true" hidden></button>
  <div class="map-tags" id="map-tags" aria-hidden="true">
    ${chapters
      .slice(1)
      .map((ch, i) => `<span class="map-tag" data-tag="${esc(ch.id)}"><b>${pad(i + 1)}</b>${esc(ch.name)}</span>`)
      .join('\n    ')}
  </div>

  <div class="rotate-hint">
    <svg class="rotate-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <g class="rotate-phone"><rect x="23" y="12" width="18" height="34" rx="3"/><path d="M30 41h4"/></g>
      <path d="M12 38a21 21 0 0 1 9-24"/><path d="M21 14l-6 0.5M21 14l-1 6"/>
    </svg>
    <p>${esc(c.ui.rotate)}</p>
    <button class="list-toggle" id="rotate-list" type="button">${esc(c.ui.listView)}</button>
  </div>

  <dialog class="clip-dialog" id="clip-dialog" aria-label="${esc(c.ui.watchClip)}">
    <div class="clip-dialog-frame"></div>
    <form method="dialog"><button class="clip-close" type="submit">${esc(c.ui.close)}</button></form>
  </dialog>

  <button class="debug-toggle" id="debug-toggle" type="button" role="switch" aria-checked="false" aria-controls="debug-hud" hidden>
    <span class="debug-toggle-box" aria-hidden="true"></span>
    <span class="debug-toggle-label">${esc(c.debug.label)}</span>
  </button>
  <aside class="debug-hud" id="debug-hud" aria-label="Debug view: wind model values" hidden></aside>
`;
}

export interface HeadOptions extends SeoOptions {
  /** The dev server: no visit counting there. */
  dev: boolean;
}

/** Cloudflare Web Analytics: one deferred script, no cookies. Only on the built site. */
function analytics(c: Content, opts: HeadOptions): string {
  const token = c.site.analyticsToken;
  if (!token || opts.dev) return '';
  return `
    <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${esc(JSON.stringify({ token }))}'></script>`;
}

export function renderHead(c: Content, opts: HeadOptions): string {
  const url = `${c.site.url}/`;
  const image = ogImageUrl(c);
  return `
    <title>${esc(c.site.title)}</title>
    <meta name="description" content="${esc(c.site.description)}">
    <meta name="author" content="${esc(c.hero.name)}">
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
    <link rel="canonical" href="${esc(url)}">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${esc(c.hero.name)}">
    <meta property="og:locale" content="${esc(c.site.locale)}">
    <meta property="og:url" content="${esc(url)}">
    <meta property="og:title" content="${esc(c.site.title)}">
    <meta property="og:description" content="${esc(c.site.description)}">
    <meta property="og:image" content="${esc(image)}">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:image:width" content="${ogImageSize.width}">
    <meta property="og:image:height" content="${ogImageSize.height}">
    <meta property="og:image:alt" content="${esc(c.site.imageAlt)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(c.site.title)}">
    <meta name="twitter:description" content="${esc(c.site.description)}">
    <meta name="twitter:image" content="${esc(image)}">
    <meta name="twitter:image:alt" content="${esc(c.site.imageAlt)}">
    <script type="application/ld+json">${jsonLd(c, opts)}</script>${analytics(c, opts)}`;
}
