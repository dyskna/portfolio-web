/**
 * www.dyskna.pl → https://dyskna.pl, keeping the path and query. A permanent (301) redirect, so
 * search engines treat the bare domain as the one address. Deployed on its own with
 * `npm run deploy:www`; the portfolio itself stays a static-assets Worker.
 */
const TARGET = 'https://dyskna.pl';

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    return Response.redirect(`${TARGET}${url.pathname}${url.search}`, 301);
  },
};
