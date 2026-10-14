/**
 * Project clips: sources are attached only when a card nears the viewport,
 * and clips play only while visible. With reduced motion they never autoplay;
 * the play button is always there so any clip can be paused or started.
 */
export function initVideos(reducedMotion: boolean): void {
  const videos = [...document.querySelectorAll<HTMLVideoElement>('video.lazy-video')];
  if (!videos.length) return;

  const userPaused = new WeakSet<HTMLVideoElement>();
  const visible = new WeakSet<HTMLVideoElement>();

  const attachSources = (v: HTMLVideoElement) => {
    if (v.dataset.loaded) return;
    v.dataset.loaded = '1';
    v.querySelectorAll<HTMLSourceElement>('source[data-src]').forEach((s) => {
      s.src = s.dataset.src!;
    });
    v.load();
  };

  const setButton = (v: HTMLVideoElement) => {
    const btn = v.parentElement?.querySelector<HTMLButtonElement>('.video-toggle');
    if (!btn) return;
    const title = btn.getAttribute('aria-label')!.replace(/^(Play|Pause) video: /, '');
    const playing = !v.paused;
    btn.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} video: ${title}`);
    btn.firstElementChild!.textContent = playing ? '❚❚' : '▶';
  };

  const tryPlay = (v: HTMLVideoElement) => {
    attachSources(v);
    v.play().catch(() => setButton(v));
  };

  const near = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          attachSources(e.target as HTMLVideoElement);
          near.unobserve(e.target);
        }
      }
    },
    { rootMargin: '600px 0px' },
  );

  const inView = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting) {
          visible.add(v);
          if (!reducedMotion && !userPaused.has(v)) tryPlay(v);
        } else {
          visible.delete(v);
          v.pause();
        }
      }
    },
    { threshold: 0.3 },
  );

  for (const v of videos) {
    near.observe(v);
    inView.observe(v);
    v.addEventListener('play', () => setButton(v));
    v.addEventListener('pause', () => setButton(v));

    const btn = v.parentElement?.querySelector<HTMLButtonElement>('.video-toggle');
    if (btn) {
      btn.hidden = false;
      btn.addEventListener('click', () => {
        if (v.paused) {
          userPaused.delete(v);
          tryPlay(v);
        } else {
          userPaused.add(v);
          v.pause();
        }
      });
    }
  }

  document.addEventListener('visibilitychange', () => {
    for (const v of videos) {
      if (document.hidden) v.pause();
      else if (visible.has(v) && !reducedMotion && !userPaused.has(v)) tryPlay(v);
    }
  });
}
