import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { content as builtContent } from './src/content.ts';
import { renderBody, renderHead } from './src/page/render.ts';
import { INDEXNOW_KEY, robotsTxt, sitemapXml } from './src/page/seo.ts';

const publicDir = path.resolve(import.meta.dirname, 'public');
const publicFileExists = (p: string) => fs.existsSync(path.join(publicDir, decodeURI(p)));
/** The build date: the sitemap's and structured data's "last changed". */
const today = () => new Date().toISOString().slice(0, 10);

/** Renders src/content.ts into index.html, so the page is complete static HTML. */
function portfolioHtml(): Plugin {
  let server: ViteDevServer | undefined;
  return {
    name: 'portfolio-html',
    configureServer(s) {
      server = s;
      // Re-render when media files are added or removed (placeholders <-> real videos).
      s.watcher.add(publicDir);
      const reload = (file: string) => {
        if (file.startsWith(publicDir)) {
          const mod = s.moduleGraph.getModuleById(MANIFEST_RESOLVED);
          if (mod) s.moduleGraph.invalidateModule(mod);
          s.ws.send({ type: 'full-reload' });
        }
      };
      s.watcher.on('add', reload);
      s.watcher.on('unlink', reload);
    },
    async transformIndexHtml(html) {
      // In dev, load fresh copies so edits to content.ts show on reload.
      const c = server
        ? ((await server.ssrLoadModule('/src/content.ts')) as typeof import('./src/content.ts')).content
        : builtContent;
      const r = server
        ? ((await server.ssrLoadModule('/src/page/render.ts')) as typeof import('./src/page/render.ts'))
        : { renderBody, renderHead };
      return html
        .replace('%LANG%', c.site.lang)
        .replace('<!--app-head-->', r.renderHead(c, { publicFileExists, date: today(), dev: !!server }))
        .replace('<!--app-body-->', r.renderBody(c, { publicFileExists }));
    },
    generateBundle() {
      // robots.txt and sitemap.xml carry the site's address, so they are built from content.ts.
      const opts = { publicFileExists, date: today() };
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(builtContent) });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(builtContent, opts) });
      this.emitFile({ type: 'asset', fileName: `${INDEXNOW_KEY}.txt`, source: INDEXNOW_KEY });
    },
  };
}

const MANIFEST_ID = 'virtual:asset-manifest';
const MANIFEST_RESOLVED = '\0' + MANIFEST_ID;

/** Exposes which optional files exist in public/models, so the scene never requests missing ones. */
function assetManifest(): Plugin {
  return {
    name: 'asset-manifest',
    resolveId: (id) => (id === MANIFEST_ID ? MANIFEST_RESOLVED : undefined),
    load(id) {
      if (id !== MANIFEST_RESOLVED) return;
      const list = (sub: string, re: RegExp) => {
        const dir = path.join(publicDir, sub);
        return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)) : [];
      };
      const models = list('models', /\.(glb|gltf)$/i);
      const lettering = list('lettering', /\.(svg|png|webp)$/i);
      return `export const models = ${JSON.stringify(models)};\nexport const lettering = ${JSON.stringify(lettering)};`;
    },
  };
}

export default defineConfig({
  plugins: [portfolioHtml(), assetManifest()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    // The Three.js scene chunk (~165 kB gzipped) loads lazily after the content is on screen.
    chunkSizeWarningLimit: 700,
  },
});
