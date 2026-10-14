/**
 * Search engines: structured data (JSON-LD) for the page, robots.txt and the sitemap.
 * Everything is built from content.ts, so changing site.url updates every address here.
 */
import type { Content } from '../content.ts';

export interface SeoOptions {
  /** Checks whether a path under public/ exists, e.g. "/videos/sailing.jpg". */
  publicFileExists: (path: string) => boolean;
  /** Last change, as YYYY-MM-DD. */
  date: string;
}

const OG_IMAGE = { path: '/og.jpg', width: 1200, height: 630 };

/**
 * IndexNow key (not a secret: it is published as /<key>.txt to prove the site is ours). Bing,
 * DuckDuckGo's results, Yandex and others take the page within minutes of a ping; see
 * scripts/indexnow.ts, which runs after every deploy.
 */
export const INDEXNOW_KEY = 'a83b9f2836305296e55c6644d1af84f1';

const pageUrl = (c: Content) => `${c.site.url}/`;
export const ogImageUrl = (c: Content) => `${c.site.url}${OG_IMAGE.path}`;
export const ogImageSize = OG_IMAGE;

/** A profile, not one project page: itch.io links point at a game, so use the creator's page. */
function profile(href: string): string {
  const u = new URL(href);
  return u.hostname.endsWith('.itch.io') ? `${u.origin}/` : u.href; // u.href percent-encodes letters like ś
}

const external = (links: { href: string }[]) => links.filter((l) => /^https?:/.test(l.href)).map((l) => new URL(l.href).href);

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** WebSite (the name results show for the site) → ProfilePage → Person, plus the projects. */
export function jsonLd(c: Content, opts: SeoOptions): string {
  const url = pageUrl(c);
  const person = `${url}#person`;
  const still = (path: string) => (opts.publicFileExists(path) ? `${c.site.url}${path}` : undefined);
  const works = [
    ...c.projects.map((p) => ({
      '@type': 'CreativeWork',
      name: p.title,
      description: `${p.design} ${p.code}`,
      url: `${url}#${p.id}`,
      sameAs: external(p.links),
      image: still(p.video.poster),
      keywords: p.engine,
      creator: { '@id': person },
    })),
    ...c.web.sites.map((s) => ({
      '@type': 'WebApplication',
      name: s.name,
      description: s.text,
      url: new URL(s.href).href,
      applicationCategory: 'WebApplication',
      creator: { '@id': person },
    })),
  ];
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${url}#website`,
        url,
        name: c.site.siteName,
        alternateName: c.site.siteNameAlternates,
        inLanguage: c.site.lang,
        publisher: { '@id': person },
      },
      {
        '@type': 'ProfilePage',
        '@id': `${url}#page`,
        url,
        name: c.site.title,
        description: c.site.description,
        inLanguage: c.site.lang,
        isPartOf: { '@id': `${url}#website` },
        dateModified: opts.date,
        mainEntity: { '@id': person },
        primaryImageOfPage: { '@type': 'ImageObject', url: ogImageUrl(c), width: OG_IMAGE.width, height: OG_IMAGE.height },
        hasPart: { '@id': `${url}#projects` },
      },
      {
        '@type': 'Person',
        '@id': person,
        name: c.hero.name,
        alternateName: c.site.nameAscii,
        jobTitle: c.site.jobTitle,
        description: c.about.paragraphs[0],
        url,
        knowsAbout: c.site.knowsAbout,
        alumniOf: { '@type': 'CollegeOrUniversity', name: c.site.university },
        sameAs: c.contact.links.map((l) => profile(l.href)),
      },
      {
        '@type': 'ItemList',
        '@id': `${url}#projects`,
        name: c.projectsIntro.title,
        itemListElement: works.map((item, i) => ({ '@type': 'ListItem', position: i + 1, item })),
      },
    ],
  };
  // "<" escaped, so no text in the data can close the script tag.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function robotsTxt(c: Content): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${c.site.url}/sitemap.xml\n`;
}

/** The one page, with its project clips as video entries (so they can show in video search). */
export function sitemapXml(c: Content, opts: SeoOptions): string {
  const videos = [...c.projects, c.web]
    .filter((p) => opts.publicFileExists(p.video.mp4) && opts.publicFileExists(p.video.poster))
    .map(
      (p) => `
    <video:video>
      <video:thumbnail_loc>${xml(c.site.url + p.video.poster)}</video:thumbnail_loc>
      <video:title>${xml(`${p.title} · ${c.hero.name}`)}</video:title>
      <video:description>${xml(p.video.description)}</video:description>
      <video:content_loc>${xml(c.site.url + p.video.mp4)}</video:content_loc>
      <video:family_friendly>yes</video:family_friendly>
    </video:video>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>${xml(pageUrl(c))}</loc>
    <lastmod>${opts.date}</lastmod>${videos}
  </url>
</urlset>
`;
}
