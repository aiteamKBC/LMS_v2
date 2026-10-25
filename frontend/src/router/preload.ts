import { matchRoutes, type RouteObject } from 'react-router-dom';
import type { ReactElement } from 'react';

/** Prepare code only after intent to navigate from the Curriculum workspace.
 * No route is mounted here: data reads, access gates and saves keep their
 * existing navigation lifecycle. lazyRoute reuses an in-flight chunk and owns
 * retries on actual navigation; a speculative failure must not reload this page.
 */
export function installCurriculumRoutePreloading(routes: RouteObject[]): () => void {
  const prepare = (event: Event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download') || (link.getAttribute('target') && link.getAttribute('target') !== '_self')) return;
    if (!document.querySelector('.workspace-shell[data-workspace-role="curriculum"]')) return;
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    let url: URL;
    try { url = new URL(link.getAttribute('href') || '', window.location.href); } catch { return; }
    if (url.origin !== window.location.origin || !/^\/(?:curriculum(?:\/|$)|workspace\/curriculum(?:\/|$))/.test(url.pathname)) return;
    if (url.pathname === window.location.pathname) return;
    for (const match of matchRoutes(routes, url.pathname) || []) {
      const element = match.route.element as ReactElement | undefined;
      const type = element?.type as { preload?: () => Promise<unknown> } | undefined;
      void type?.preload?.().catch(() => { /* Navigation still owns errors and stale-chunk recovery. */ });
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
