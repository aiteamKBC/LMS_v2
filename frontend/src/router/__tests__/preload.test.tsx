import { createElement, Suspense, type ComponentType } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { RouteObject } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installCurriculumRoutePreloading, installLearnerRoutePreloading } from '../preload';
import { lazyRoute } from '../lazyRoute';

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  cleanups.splice(0).forEach(cleanup => cleanup());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(role = 'curriculum') {
  document.body.innerHTML = `<main class="workspace-shell" data-workspace-role="${role}"><a href="/curriculum/courses?view=table"><span>Courses</span></a></main>`;
  const renderPage = vi.fn(() => null);
  const loader = vi.fn().mockResolvedValue({ default: renderPage });
  const Page = lazyRoute(loader);
  const routes: RouteObject[] = [{ children: [{ path: '/curriculum/courses', element: createElement(Page) }] }];
  cleanups.push(installCurriculumRoutePreloading(routes));
  return { loader, renderPage, Page, link: document.querySelector('a')! };
}

describe('Curriculum route preparation', () => {
  it.each(['pointerover', 'focusin', 'pointerdown'])('starts the destination chunk on %s without rendering the page', async event => {
    const { loader, renderPage, link } = setup();
    link.firstElementChild!.dispatchEvent(new Event(event, { bubbles: true }));
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(renderPage).not.toHaveBeenCalled();
  });

  it('shares the same chunk across intent events and actual navigation', async () => {
    const { loader, Page, link, renderPage } = setup();
    for (const event of ['pointerover', 'focusin', 'pointerdown']) link.dispatchEvent(new Event(event, { bubbles: true }));
    await Page.preload();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(renderPage).not.toHaveBeenCalled();
    render(createElement(Suspense, { fallback: 'Loading' }, createElement(Page)));
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('keeps non-Curriculum workspaces and unrelated or special links outside the new behavior', async () => {
    const { link, loader } = setup('coach');
    link.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(loader).not.toHaveBeenCalled();
    document.querySelector('main')!.setAttribute('data-workspace-role', 'curriculum');
    for (const href of ['/learner/dashboard', '/curriculum-tools', 'https://external.example/curriculum/courses']) {
      link.href = href;
      link.dispatchEvent(new Event('pointerover', { bubbles: true }));
    }
    link.href = '/curriculum/courses';
    link.setAttribute('download', '');
    link.dispatchEvent(new Event('pointerover', { bubbles: true }));
    link.removeAttribute('download');
    link.target = '_blank';
    link.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await Promise.resolve();
    expect(loader).not.toHaveBeenCalled();
  });

  it('honors data saver and removes its listeners on cleanup', () => {
    const { link, loader } = setup();
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    link.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(loader).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    cleanups.splice(0).forEach(cleanup => cleanup());
    link.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(loader).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'kept-preview'])('ignores a %s Curriculum builder beneath another workspace', async mode => {
    const { loader } = setup();
    const workspace = document.querySelector('main')!;
    const slot = document.createElement('div');
    workspace.before(slot);
    slot.append(workspace);
    if (mode === 'hidden') slot.hidden = true;
    else { slot.style.display = 'none'; slot.setAttribute('aria-hidden', 'true'); }
    const returnLink = document.createElement('a');
    returnLink.href = '/curriculum/courses';
    document.body.append(returnLink);
    returnLink.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(loader).not.toHaveBeenCalled();
    slot.hidden = false;
    slot.style.display = 'contents';
    slot.removeAttribute('aria-hidden');
    returnLink.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
  });

  it('leaves speculative failures to navigation and allows the next attempt to retry', async () => {
    const { link, loader, Page } = setup();
    loader.mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'));
    link.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    await expect(Page.preload()).resolves.toEqual({ default: expect.any(Function) });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('leaves the existing learner preloader available without a Curriculum shell', async () => {
    document.body.innerHTML = '<a href="/learner/materials">Materials</a>';
    const preload = vi.fn().mockResolvedValue(undefined);
    const Page = Object.assign(() => null, { preload }) as ComponentType & { preload: typeof preload };
    cleanups.push(installLearnerRoutePreloading([{ path: '/learner/materials', element: createElement(Page) }]));
    document.querySelector('a')!.dispatchEvent(new Event('focusin', { bubbles: true }));
    await Promise.resolve();
    expect(preload).toHaveBeenCalledTimes(1);
  });
});
