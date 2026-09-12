import { matchRoutes, type RouteObject } from 'react-router-dom';
import type { ReactElement } from 'react';

export function installLearnerRoutePreloading(routes: RouteObject[]): () => void {
  const prepare = (event: Event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download')) return;
    const url = new URL(link.getAttribute('href') || '', window.location.href);
    if (url.origin !== window.location.origin || !(/^\/learner(?:\/|$)|^\/workspace\/learner(?:\/|$)/.test(url.pathname))) return;
    const matched = matchRoutes(routes, url.pathname);
    for (const match of matched || []) {
      const element = match.route.element as ReactElement | undefined;
      const type = element?.type as { preload?: () => Promise<unknown> } | undefined;
      void type?.preload?.().catch(() => { /* Actual navigation owns errors. */ });
    }
  };
  document.addEventListener('pointerover', prepare);
  document.addEventListener('focusin', prepare);
  document.addEventListener('pointerdown', prepare);
  return () => {
    document.removeEventListener('pointerover', prepare);
    document.removeEventListener('focusin', prepare);
    document.removeEventListener('pointerdown', prepare);
  };
}
