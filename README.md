# Katarzyna Kardyś · portfolio

A voyage across a low-poly mountain lake. The page is a sequence of chapters (pier, five projects,
web, about, harbour); each chapter is a stop on the lake. Scrolling is the wind: the sailboat sails from
stop to stop, driven by the apparent-wind model from my UE5 sailing prototype. At each stop the camera
settles into a staged shot, the chapter word is painted on the water behind the boat, and the
project's details are typeset straight onto the scene as chart annotations (title; Design, with a line
to the sail; Code, with a line to the buoy). The buoy carries a screen that plays the project's clip;
click it, or "Watch clip", to see it full size. A **List view** switch shows everything as a plain page.

Stack: Vite, TypeScript, Three.js. Static site, deployed to Cloudflare (Workers static assets).

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # wind-model and voyage unit tests (Node's built-in runner, no extra dependencies)
npm run build      # type-check + build to dist/
npm run preview    # serve dist/ locally
npm run deploy     # build + deploy to Cloudflare
```

`npm run dev` also serves **/models.html**, a 3D preview of the boat and the village (orbit, dusk toggle), handy for checking models.

Useful URL flags while testing: `?quality=high|low|static` forces a detail level (and disables the
automatic frame-rate fallback), `?debug=1` opens the Debug view, `?perf` exposes `window.__perf()`.

## Editing content

Everything you read on the page lives in **`src/content.ts`**: name, tagline, the word painted at
the pier (`hero.word`, "I like building good stuff"), projects (title, engine
tag, Design note, Code note, links, video paths), the web chapter
(internship, sites, stack), about, contact links (the first one, LinkedIn, is set larger), and the
harbour line. There is no email on the page on purpose.
At build time it is rendered into plain HTML (`src/page/render.ts`), so the page is readable before,
or without, any JavaScript. In `npm run dev`, saving `content.ts` reloads the page.

Keep each project's `id` stable: it names the video files, the chapter's stop on the lake and the
scene moment (`src/scene/moments/registry.ts`). Each project also has a `chapter` (short name in the
chapter row) and a `word` (the big lettered word painted on the lake at its stop).

**Web chapter** (`content.web`): the websites from the fullstack internship, one stop after the
projects. Fill in `label`, `meta` (year, company), `intro`, `stack` and `sites` (name, live address,
one line each). Its id stays `web`.

## Type and lettering

- **Lettering:** Sedgwick Ave Display (Google Fonts, OFL), a dry brush-marker face used as a stand-in
  for your own lettering.
- **Interface:** Cabinet Grotesk (Indian Type Foundry via Fontshare, ITF Free Font License, free for
  commercial use).
- Both are self-hosted in `public/fonts/`.

**Your own lettering.** Draw a chapter word (Procreate, Illustrator, ink scanned and traced), export it
as `public/lettering/<chapter id>.svg` (or `.png` / `.webp` with transparency), and it replaces the brush
font for that chapter, both on the lake and in the static fallback. Chapter ids: `pier`, `sailing`, `chery`,
`escape-from-weii`, `multiplayer-sumo`, `thesis`, `web`, `about`. Use a light colour (it stands on the
water); a wide artboard around 3.4 : 1 fills the space best.

`content.site.url` is the page's address: the canonical link, the link-preview image, the structured
data, robots.txt and the sitemap are all built from it (see Search engines below).

## Videos (`public/videos/`)

Until a project's files exist, its card shows a styled placeholder (no broken player).

| Project | Files |
| --- | --- |
| Sailing prototype | `sailing.mp4`, `sailing.webm`, `sailing.jpg` |
| Chery the Game | `chery.mp4`, `chery.webm`, `chery.jpg` |
| EscapeFromWEII | `escape-from-weii.mp4`, `escape-from-weii.webm`, `escape-from-weii.jpg` |
| Multiplayer Sumo | `multiplayer-sumo.mp4`, `multiplayer-sumo.webm`, `multiplayer-sumo.jpg` |
| BSc thesis | `thesis.mp4`, `thesis.webm`, `thesis.jpg` |
| Web chapter | `web.mp4`, `web.webm` (a short screen recording), or just `web.jpg` (a screenshot) |

- **1280×720**, 16:9 (cards are shown up to ~670 CSS px wide, so this is sharp on 2× screens).
- **6–10 seconds**, cut so the last frame flows into the first (it loops), 30 fps, **no audio** (muted anyway).
- Aim for **under ~2.5 MB per file**. The `.jpg` is the still shown before the clip loads and when
  the visitor prefers reduced motion. **A `.jpg` alone is enough:** without a clip, the screen on the
  lake (and the card in the list view) shows the still instead of the placeholder.

With ffmpeg (replace `in.mov` and the name; `-ss` picks the start, `-t` the length):

```sh
ffmpeg -ss 3 -t 8 -i in.mov -vf "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30" \
  -c:v libx264 -profile:v high -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart -an sailing.mp4
ffmpeg -ss 3 -t 8 -i in.mov -vf "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30" \
  -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -an sailing.webm
ffmpeg -ss 1 -i sailing.mp4 -frames:v 1 -q:v 3 sailing.jpg
```

With the live scene a clip plays on the screen at its stop (and only there); "Watch clip" opens it
full size. In the static picture and the list view it plays inline, loads only when it nears the
screen, plays only while visible, and has a play/pause button. Until a clip exists the screen shows
"Clip in production".

## Blender models (`public/models/`)

Everything is procedural by default. Drop a `.glb` in `public/models/` and it replaces its
procedural counterpart; the build lists which files exist, so missing ones are never requested.
Export as **glTF Binary (.glb)**, +Y up (Blender's default), metres, modifiers applied,
**no Draco compression**. Keep it low-poly.

Axes: Blender (x, y, z) = three.js (x, −z, y). Blender +Y is "forward" on the lake.

| File | Object names | Notes |
| --- | --- | --- |
| `boat.glb` | `Hull` (required), `Mast`, `Boom` | Boat space: origin on the waterline amidships, **bow toward +Y**. Hull ≈ 4.6 m long (stem to stem), 1.6 m beam. Mast at y = 0.95. `Boom` origin at the gooseneck (where it meets the mast, 1.15 m up), boom pointing aft (−Y). The gaff and the sail stay procedural: the sail is shaped live by the wind model (luff 3.0 m, foot 2.95 m, gaff 2.3 m at 50°). |
| `cabin.glb` | any; optional `CabinWindow`, `Chimney` | Replaces the fisherman's house, boathouse, jetty and props. Model in **world coordinates**: the house stands around (−14.5, −9.5), the boat's berth at the jetty end is (3, −10), jetty deck at z = 0.85. A mesh named `CabinWindow` glows at dusk; an object named `Chimney` is where the smoke rises. |
| `harbour.glb` | any; optional meshes `Lamp…`, optional empty `Sign` | Replaces the fishing village. World coordinates: the boat's final berth is (2, 312); the quay is around (4, 346) and the houses on stilts stand at y ≈ 339. Meshes whose names start with `Lamp` light up at sunset; the empty `Sign` sets where the "Want to be my crewmate?" board hangs. |
| `tree.glb` | first mesh | Used for every pine (instanced). Origin at the trunk base, 6–8 m tall, with its own material. |
| `island.glb` | `Island`, `Door` | For the EscapeFromWEII moment. Origin at the island centre, waterline at z = 0; the door's opening faces −Y, about 3.3 m tall. |

The terrain and water stay procedural: the lake is shaped around the boat's route.

## How it works

```
src/
  content.ts            all text, links and media paths
  main.ts               page bootstrap: videos, List view, Debug view, frame loop, lazy scene, fallbacks
  page/render.ts        build-time HTML renderer (chapters, labels, chapter row, <head>)
  page/seo.ts           structured data (JSON-LD), robots.txt and sitemap.xml, built from content.ts
  page/voyage.ts        chapter controller: stage weights, chapter row, annotation lines, map tags
  page/chapters.ts      text colour per chapter (dark ink on bright scenes, cream on dark ones)
  page/videos.ts        lazy video player
  wind/wind.ts          apparent-wind model (pure functions) + wind.test.ts
  sim/route.ts          the route, arc-length parameterised
  sim/voyage.ts         scroll position → route target, holding at each stop (+ voyage.test.ts)
  sim/stops.ts          where each chapter's stop sits along the route
  sim/boatSim.ts        route target → boat position/velocity → wind sample, every frame
  debug/hud.ts          Debug view HUD (works without WebGL too)
  scene/                Three.js scene, loaded as a separate chunk
    world.ts            lake shape, terrain heights, wave function (shared with the water shader)
    paint.ts            the painted look: aerial perspective, soft light, terrain colour ramps, wind sway
    terrain.ts          indexed terrain grid and the distant mountain rings (coloured in the shader)
    water.ts            lake shader: ripples, sky + mountain reflections, sun glitter, shore and hull foam
    vegetation.ts       instanced pines, birches, reeds, rocks and small islands
    life.ts             chimney smoke, fireflies at dusk, birds, window glow, moored boats
    mergeStatic.ts      bakes static props into single meshes (fewer draw calls)
    compile.ts          shader warm-up spread over frames (a few materials per frame)
    boat.ts             the sailboat; boatDesigns.ts holds the clinker double-ender and its gaff rig
    village.ts          fisherman's house, boathouse, jetties and the harbour village on stilts
    wake, atmosphere (golden hour → sunset, clouds, chapter colour worlds)
    stages.ts           camera shot, framing and colour world for each chapter's stop
    chapterProps.ts     the painted chapter words, the buoys and the clip screens on them
    cameraRig.ts        follow camera that settles into each stop's shot
    debugOverlay.ts     wind vectors drawn as a vector sum, route, wireframe pass
    models.ts           optional Blender models
    quality.ts          tier detection (high / low / static)
    moments/            one chunk per moment, loaded and warmed up before the scene fades in
```

- **Scroll is never touched.** The page scrolls natively; the scene only reads `scrollY`. Each
  chapter is a tall section whose stage is `position: sticky`, so it holds on screen while you
  scroll through it (no scroll hijacking, no smooth-scroll library).
- **Wind model** (`src/wind/wind.ts`): true wind drifts in strength and direction over tens of
  seconds; wind from motion is minus the boat's velocity (from scroll speed); apparent wind is their
  sum. The boom eases to half the apparent wind angle on the leeward side; the sail fills with apparent
  wind speed and cannot fill head to wind. Stop scrolling and only the true wind is left: the sail
  goes slack and flaps gently.
- **Moments** (`src/scene/moments/`): pixel-art pass (Chery), fog and a lit door (EscapeFromWEII),
  a ghost boat replaying 10 Hz snapshots 350 ms late (Multiplayer Sumo), a scripted agent with ray
  sensors sailing alongside (thesis), a fishing net whose knots light up like network nodes with
  packets hopping along its threads (web), sunset + lamps + the crew sign (harbour). Each is its own
  chunk, loaded while the page still shows the poster; if one fails, the page carries on without it.
- **Smooth transitions:** the chapter stage weights (camera shot, colour world, words, notes) ease
  toward the scroll position over about half a second, so a mouse-wheel notch glides instead of
  stepping. Every shader is compiled and drawn once (into a single pixel) and every word texture is
  uploaded before the scene fades in, so nothing compiles mid-voyage.
- **Fallbacks:** with `prefers-reduced-motion`, no WebGL 2, a software renderer, data saver or a
  low-end device, the canvas is never created and the page shows a still render of the lake
  (`public/lake-poster*.jpg`). A frame-rate governor lowers resolution, then falls back to the still
  if the device can't keep up. Rendering pauses while the tab is hidden.

## Deploying to Cloudflare

`wrangler.jsonc` deploys `dist/` as Workers static assets (no server code). `public/_headers`
sets caching; `public/404.html` is the not-found page.

First time:

```sh
npm install
npx wrangler login          # opens the browser to authorise your Cloudflare account
npm run deploy              # builds, then `wrangler deploy`
```

Wrangler prints the live URL (`https://katarzyna-kardys-portfolio.<your-subdomain>.workers.dev`).
Later deploys are just `npm run deploy`. `npm run deploy:preview` uploads a new version with its own
preview URL without making it live.

Instead of deploying from your machine you can connect the GitHub repository in the dashboard
(Workers & Pages → Create → Import a repository) with build command `npm run build` and deploy
command `npx wrangler deploy`; every push to the main branch then deploys.

### Custom domain

The site is live at **https://dyskna.pl** (a custom domain on this Worker, set up in the dashboard;
deploys keep it). `content.site.url` is set to it, so the workers.dev address points search engines
there through the canonical link.

**www.dyskna.pl** redirects (301) to the bare domain, keeping the path. That is a separate one-line
Worker in `redirect/` (`dyskna-www-redirect`), deployed once with `npm run deploy:www`; it never needs
redeploying with the site.

To connect another domain:

1. Add the domain to Cloudflare (dashboard → Add a domain) and switch its nameservers at your
   registrar to the two Cloudflare gives you. Wait until the domain shows as **Active**.
2. Either in the dashboard: Workers & Pages → `katarzyna-kardys-portfolio` → Settings →
   Domains & Routes → Add → **Custom domain** → `yourdomain.com` (and again for `www.yourdomain.com`),
   or uncomment the `routes` block in `wrangler.jsonc`, put in your domain, and run `npm run deploy`.
   Cloudflare creates the DNS records and the HTTPS certificate.
3. Set `content.site.url` in `src/content.ts` to `https://yourdomain.com` and deploy again.

## Search engines

Everything is generated at build time from `src/content.ts`:

- **`<head>`:** title and description (`content.site`; keep the title under ~60 characters and the
  description under ~155), canonical link, robots, Open Graph and Twitter tags for link previews.
- **Structured data (JSON-LD):** a `ProfilePage` whose main entity is a `Person` (name, also written
  without Polish letters, job title, university, skills from `site.knowsAbout`, and the contact
  links as `sameAs` profiles), plus the projects as a list of works.
- **`/robots.txt`** and **`/sitemap.xml`**: the page, with each project clip listed as a video.
  Cloudflare's managed robots.txt adds its content-signals preamble in front; it does not block search.
- **Site name:** `WebSite` structured data (`site.siteName`, `site.siteNameAlternates`) tells
  Google what to call the site in results.
- **IndexNow:** `npm run deploy` ends with `npm run indexnow` (`scripts/indexnow.ts`), which tells
  Bing (and through it DuckDuckGo and Yahoo), Yandex and others that the page changed; the key file
  `/<key>.txt` is generated with the build. Google does not take IndexNow.
- **`public/og.jpg`** (1200 × 630): the image link previews show. It is a screenshot of the opening
  shot without the bar; retake it when the opening changes, and update `site.imageAlt` with it.
- `public/apple-touch-icon.png` (180 × 180) is the favicon for iPhone home screens.

After the first deploy (and after connecting a domain):

1. Open [Google Search Console](https://search.google.com/search-console) → Add property →
   **Domain** → `dyskna.pl`. The domain's DNS is on Cloudflare, so Search Console offers to verify
   through Cloudflare: sign in there and approve, and it adds the TXT record itself.
2. Sitemaps → submit `sitemap.xml`. URL inspection → paste the address → **Request indexing**.
3. Link the page from LinkedIn (Contact info → Website), GitHub (profile website) and itch.io: links
   from your own profiles are the strongest signal that the page is yours.
4. Check link previews with the [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/);
   it also refreshes LinkedIn's cached preview after og.jpg changes.
