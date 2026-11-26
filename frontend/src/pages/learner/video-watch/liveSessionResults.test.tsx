import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ComponentBody } from './page';
import { componentContentKind, type JourneyComponent } from '@/utils/learnerJourney';

const session: JourneyComponent = { title: 'Live lesson', type: 'live_session', expectedOtjh: 1, durationMinutes: 60,
  sessionDateTimeUtc: '2026-09-16T09:00:00Z',
  liveSessionUrl: '/learner_api/session-results/commercial/7/S1/sessions/1/join/' };
const noop = () => undefined;
function body(preview = false) {
  return <ComponentBody component={session} contentKind={componentContentKind(session.type)} title={session.title}
    parsed={null} preview={preview} onDuration={noop} onProgress={noop} onPlayingChange={noop} onEnded={noop} onUnsupported={noop} />;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-16T09:59:00Z')); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('closes Join at the session end while the page stays open, without polling', () => {
  render(body());
  expect(screen.getByRole('link', { name: /Join/ })).toHaveAttribute('href', session.liveSessionUrl);
  act(() => vi.advanceTimersByTime(60001));
  expect(screen.queryByRole('link', { name: /Join/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Session ended' })).toBeDisabled();
  expect(fetch).not.toHaveBeenCalled();
});

it('keeps preview Join disabled and never starts tracking', () => {
  render(body(true));
  expect(screen.getByRole('button', { name: 'Join is disabled in preview' })).toBeDisabled();
  expect(screen.queryByRole('link', { name: /Join/ })).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
