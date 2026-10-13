import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanNarrationText, narrationFromHtml, narrationFromPdf, useReadingNarration } from './readingNarration';
import { ComponentBody } from './page';

vi.mock('mammoth/mammoth.browser', () => ({ convertToHtml: async () => ({
  value: '<h1>Introduction</h1><p>First <strong>important</strong> paragraph.</p><p>________</p><p>Second paragraph.</p>',
}) }));

const speak = vi.fn<(utterance: SpeechSynthesisUtterance) => void>();
const cancel = vi.fn();
beforeEach(() => {
  vi.stubGlobal('speechSynthesis', { speak, cancel });
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    text: string;
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) { this.text = text; }
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('removes decorative rules while keeping meaningful punctuation and numbers', () => {
  expect(cleanNarrationText('A-B costs -12.5. ___ Next ----- part.')).toBe('A-B costs -12.5. Next part.');
  expect(cleanNarrationText(' _ _ _ _ ')).toBe('');
});

it('preserves heading, paragraph, list and inline text order without speaking controls', () => {
  const root = document.createElement('div');
  root.innerHTML = '<h2>Introduction</h2><p>First <strong>important</strong> sentence.</p><p>_____</p><ul><li>One</li><li>Two</li></ul><button>Download</button><div hidden>Hidden</div><p>Final.</p>';
  expect(narrationFromHtml(root)).toEqual([
    { text: 'Introduction', pauseMs: 900 },
    { text: 'First important sentence.', pauseMs: 650 },
    { text: 'One', pauseMs: 650 }, { text: 'Two', pauseMs: 650 }, { text: 'Final.', pauseMs: 650 },
  ]);
});

it('keeps plain-text paragraphs separated', () => {
  const root = document.createElement('pre');
  root.textContent = 'First line\nwrapped line.\n\n____\n\nNext paragraph.';
  expect(narrationFromHtml(root).map(block => block.text)).toEqual(['First line wrapped line.', 'Next paragraph.']);
});

it('uses PDF paragraph gaps and skips separator rules without pausing at every wrapped line', () => {
  const item = (str: string, y: number) => ({ str, transform: [12, 0, 0, 12, 0, y], height: 12, hasEOL: true });
  expect(narrationFromPdf([item('First wrapped', 700), item('paragraph.', 686), item('------', 665), item('Second paragraph.', 640)]))
    .toEqual([{ text: 'First wrapped paragraph.', pauseMs: 650 }, { text: 'Second paragraph.', pauseMs: 650 }]);
});

describe('narration playback', () => {
  beforeEach(() => vi.useFakeTimers());
  const blocks = [{ text: 'Heading', pauseMs: 900 }, { text: 'First paragraph.', pauseMs: 650 }, { text: 'Second paragraph.', pauseMs: 650 }];
  const end = (index: number) => act(() => speak.mock.calls[index][0].onend?.({} as SpeechSynthesisEvent));

  it('waits after headings and paragraphs, then finishes cleanly', async () => {
    const { result } = renderHook(() => useReadingNarration('reading'));
    await act(async () => result.current.read(() => blocks));
    expect(speak.mock.calls[0][0].text).toBe('Heading');
    end(0);
    act(() => vi.advanceTimersByTime(899));
    expect(speak).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(speak.mock.calls[1][0].text).toBe('First paragraph.');
    end(1);
    act(() => vi.advanceTimersByTime(649));
    expect(speak).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(1));
    expect(speak.mock.calls[2][0].text).toBe('Second paragraph.');
    end(2);
    expect(result.current.speaking).toBe(false);
  });

  it('stops during a paragraph pause without restarting later', async () => {
    const { result } = renderHook(() => useReadingNarration('reading'));
    await act(async () => result.current.read(() => blocks));
    end(0);
    act(() => result.current.stop());
    act(() => vi.runAllTimers());
    expect(speak).toHaveBeenCalledTimes(1);
    expect(result.current.speaking).toBe(false);
  });

  it('cancels stale PDF text extraction when the learner changes page', async () => {
    const { result, rerender } = renderHook(({ page }) => useReadingNarration(page), { initialProps: { page: '1' } });
    let resolve!: (value: typeof blocks) => void;
    const pending = new Promise<typeof blocks>(done => { resolve = done; });
    act(() => { void result.current.read(() => pending); });
    rerender({ page: '2' });
    await act(async () => resolve(blocks));
    expect(speak).not.toHaveBeenCalled();
    expect(result.current.speaking).toBe(false);
  });

  it('cancels queued paragraphs on unmount', async () => {
    const { result, unmount } = renderHook(() => useReadingNarration('reading'));
    await act(async () => result.current.read(() => blocks));
    end(0);
    unmount();
    act(() => vi.runAllTimers());
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('stops the previous reader before starting another document', async () => {
    const first = renderHook(() => useReadingNarration('first'));
    const second = renderHook(() => useReadingNarration('second'));
    await act(async () => first.result.current.read(() => blocks));
    end(0);
    await act(async () => second.result.current.read(() => [{ text: 'Other document.', pauseMs: 650 }]));
    act(() => vi.runAllTimers());
    expect(first.result.current.speaking).toBe(false);
    expect(speak.mock.calls.map(([utterance]) => utterance.text)).toEqual(['Heading', 'Other document.']);
  });

  it('shows an error and stops the queue when the speech engine fails', async () => {
    const { result } = renderHook(() => useReadingNarration('reading'));
    await act(async () => result.current.read(() => blocks));
    act(() => speak.mock.calls[0][0].onerror?.({} as SpeechSynthesisErrorEvent));
    act(() => vi.runAllTimers());
    expect(result.current.speechError).toContain('Could not read');
    expect(result.current.speaking).toBe(false);
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it('does not start speech for decorative rules alone', async () => {
    const { result } = renderHook(() => useReadingNarration('reading'));
    await act(async () => result.current.read(() => [{ text: '_______', pauseMs: 650 }]));
    expect(speak).not.toHaveBeenCalled();
    expect(result.current.speechError).toContain('No readable text');
  });
});

it('reads converted Word content from the Reading button without including download or toolbar labels', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })));
  render(<ComponentBody component={{ componentId: 'WORD', type: 'reading', resourceUrl: '/reading.docx' } as never}
    contentKind="reading" parsed={null} title="Reading" onDuration={vi.fn()} onProgress={vi.fn()}
    onPlayingChange={vi.fn()} onEnded={vi.fn()} onUnsupported={vi.fn()} />);
  await screen.findByText('Introduction');
  fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
  await waitFor(() => expect(speak).toHaveBeenCalledOnce());
  expect(speak.mock.calls[0][0].text).toBe('Introduction');
  fireEvent.click(screen.getByRole('button', { name: 'Stop reading' }));
  expect(cancel).toHaveBeenCalled();
});
