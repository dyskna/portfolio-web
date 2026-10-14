/**
 * Tells the IndexNow search engines (Bing, Yandex, Seznam, Naver; Bing also feeds DuckDuckGo and
 * Yahoo) that the live page changed, so they fetch it within minutes instead of whenever they next
 * crawl. Runs after `npm run deploy`; `npm run indexnow` sends it again on its own.
 * Google does not take IndexNow: for Google, submit the sitemap in Search Console (see README).
 */
import { content } from '../src/content.ts';
import { INDEXNOW_KEY } from '../src/page/seo.ts';

const site = new URL(content.site.url);
const body = {
  host: site.host,
  key: INDEXNOW_KEY,
  keyLocation: `${site.origin}/${INDEXNOW_KEY}.txt`,
  urlList: [`${site.origin}/`],
};

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});
// 200 = received, 202 = received and the key is still being checked; anything else is a problem.
const ok = res.status === 200 || res.status === 202;
console.log(`IndexNow: ${res.status} ${res.statusText}${ok ? '' : ` ${await res.text()}`}`);
if (!ok) process.exitCode = 1;
