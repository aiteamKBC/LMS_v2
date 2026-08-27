import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KsbExcelPanel } from '../KsbExcelPanel';

const PROMPT = 'You are an expert UK apprenticeship curriculum designer. Map KSBs to "Digital Marketing".';

/**
 * Point navigator.clipboard at a stub for one test, then put it back. Call this
 * AFTER userEvent.setup(), which installs a clipboard stub of its own and would
 * otherwise replace this one.
 */
function stubClipboard(writeText: (text: string) => Promise<void>) {
  const prior = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
  return () => {
    if (prior) Object.defineProperty(window.navigator, 'clipboard', prior);
    else Reflect.deleteProperty(window.navigator as unknown as Record<string, unknown>, 'clipboard');
  };
}

function renderPanel(overrides: Partial<Parameters<typeof KsbExcelPanel>[0]> = {}) {
  const onExport = vi.fn();
  const onImport = vi.fn();
  render(<KsbExcelPanel prompt={PROMPT} profileCount={12} onExport={onExport} onImport={onImport} {...overrides} />);
  return { onExport, onImport };
}

describe('KsbExcelPanel', () => {
  it('fires the export and import handlers when their buttons are pressed', async () => {
    const user = userEvent.setup();
    const { onExport, onImport } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('copies the prompt and confirms, then goes back to the idle label', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restore = stubClipboard(writeText);
    try {
      renderPanel();

      await user.click(screen.getByRole('button', { name: 'Copy ChatGPT prompt' }));
      expect(writeText).toHaveBeenCalledWith(PROMPT);
      expect(await screen.findByRole('button', { name: 'Prompt copied' })).toBeInTheDocument();
      // The confirmation reverts on its own after 1.8s.
      expect(await screen.findByRole('button', { name: 'Copy ChatGPT prompt' }, { timeout: 3000 })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('opens the prompt for manual copying when the clipboard is blocked', async () => {
    const user = userEvent.setup();
    const restore = stubClipboard(() => Promise.reject(new Error('denied')));
    try {
      renderPanel();
      expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Copy ChatGPT prompt' }));

      expect(await screen.findByText(PROMPT)).toBeInTheDocument();
      // It stays the idle label — nothing was actually copied.
      expect(screen.getByRole('button', { name: 'Copy ChatGPT prompt' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Hide prompt' })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('toggles the prompt preview open and shut', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview prompt' }));
    expect(screen.getByText(PROMPT)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide prompt' }));
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
  });

  it('warns only when no KSB profile backs the prompt', () => {
    const { unmount } = render(<KsbExcelPanel prompt={PROMPT} profileCount={0} onExport={vi.fn()} onImport={vi.fn()} />);
    expect(screen.getByText(/No KSB source is set/)).toBeInTheDocument();
    unmount();

    renderPanel({ profileCount: 12 });
    expect(screen.queryByText(/No KSB source is set/)).not.toBeInTheDocument();
  });
});
