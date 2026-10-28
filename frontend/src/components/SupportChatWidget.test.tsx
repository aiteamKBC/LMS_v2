import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportChatWidget } from './SupportChatWidget';

const player = vi.hoisted(() => ({
  destroy: vi.fn(),
  goToAndStop: vi.fn(),
  loadAnimation: vi.fn(),
}));

vi.mock('lottie-web/build/player/lottie_light', () => ({
  default: { loadAnimation: player.loadAnimation },
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ auth: { account: { email: 'learner@example.test' } } }),
}));

beforeEach(() => {
  player.loadAnimation.mockReturnValue({
    destroy: player.destroy,
    goToAndStop: player.goToAndStop,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('support robot animation', () => {
  it('uses the SVG light player and destroys it when the widget unmounts', () => {
    const { unmount } = render(<SupportChatWidget />);

    expect(player.loadAnimation).toHaveBeenCalledOnce();
    expect(player.loadAnimation).toHaveBeenCalledWith(expect.objectContaining({
      renderer: 'svg',
      loop: true,
      autoplay: true,
    }));

    unmount();
    expect(player.destroy).toHaveBeenCalledOnce();
  });

  it('holds the first frame when reduced motion is requested', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<SupportChatWidget />);

    expect(player.loadAnimation).toHaveBeenCalledWith(expect.objectContaining({
      loop: false,
      autoplay: false,
    }));
    expect(player.goToAndStop).toHaveBeenCalledWith(0, true);
  });
});
