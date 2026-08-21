/**
 * The route-level loading fallback's contract.
 *
 * Every route is `lazy()` and the boundary above it is keyed by pathname, so on
 * a cold navigation React mounts a brand-new Suspense boundary and therefore
 * DOES show this fallback — react-router 7 wraps Link navigation in
 * startTransition, but a newly-mounted boundary has no revealed content to
 * preserve, so the transition cannot suppress it. That makes PageSkeleton the
 * first thing the user sees on every uncached page.
 *
 * It used to render a hero, four stat cards and a six-row table — "a typical
 * workspace page". Nothing at the router level knows the shape of the page being
 * fetched, so on the many pages that are not tables that was a grey mock-up of a
 * DIFFERENT page, which is what got reported as the site loading the wrong page
 * for a second. These tests pin the fix: chrome only, and chrome that matches
 * the real shell so the swap moves nothing.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PageSkeleton } from '../Skeletons';
import { SIDEBAR_RAIL_WIDTH } from '../Sidebar';

describe('PageSkeleton', () => {
  it('does not imply a page shape it cannot know', () => {
    const { container } = render(<PageSkeleton />);
    // A table is the specific thing that made this read as another page.
    expect(container.querySelector('table')).toBeNull();
    // Nor a card/stat grid, which is the same mistake in a different layout.
    expect(container.querySelector('.grid')).toBeNull();
  });

  it('reserves the real shell chrome so the swap to the page moves nothing', () => {
    const { container } = render(<PageSkeleton />);

    // The rail comes from the same constant the real sidebar uses, so it cannot drift.
    const rail = container.querySelector<HTMLElement>(`[style*="width"]`);
    expect(rail?.style.width).toBe(`${SIDEBAR_RAIL_WIDTH}px`);

    // Header.tsx is h-14 and the shell's breadcrumb strip is h-8. Both used to
    // be missing or wrong here, which shifted the page vertically on every
    // navigation and then shifted it back.
    expect(container.querySelector('.h-14')).not.toBeNull();
    expect(container.querySelector('.h-8')).not.toBeNull();
  });

  it('announces itself as busy rather than as content', () => {
    const { container } = render(<PageSkeleton />);
    const root = container.firstElementChild;
    expect(root?.getAttribute('aria-busy')).toBe('true');
    expect(root?.getAttribute('aria-label')).toBe('Loading page');
  });
});
