import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLiveDictation } from './liveDictation';

class RecognitionMock {
  static current: RecognitionMock;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() { RecognitionMock.current = this; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('live dictation', () => {
  it('emits interim speech immediately and replaces revised results without duplication', () => {
    vi.stubGlobal('SpeechRecognition', RecognitionMock);
    const onText = vi.fn();
    const onEnd = vi.fn();
    const session = startLiveDictation(onText, onEnd, vi.fn());
    const recognition = RecognitionMock.current;
    expect(recognition.interimResults).toBe(true);
    recognition.onresult?.({ results: [[{ transcript: 'I learn' }]] });
    expect(onText).toHaveBeenLastCalledWith('I learn');
    expect(recognition.stop).not.toHaveBeenCalled();
    recognition.onresult?.({ results: [[{ transcript: 'I learned' }], [{ transcript: 'to plan.' }]] });
    expect(onText).toHaveBeenLastCalledWith('I learned to plan.');
    session?.stop();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('releases recognition and ignores late results on unmount', () => {
    vi.stubGlobal('webkitSpeechRecognition', RecognitionMock);
    vi.stubGlobal('SpeechRecognition', undefined);
    const onText = vi.fn();
    const session = startLiveDictation(onText, vi.fn(), vi.fn());
    const recognition = RecognitionMock.current;
    const lateResult = recognition.onresult;
    session?.cancel();
    lateResult?.({ results: [[{ transcript: 'late words' }]] });
    expect(onText).not.toHaveBeenCalled();
    expect(recognition.abort).toHaveBeenCalledOnce();
  });

  it('returns no live session when browser recognition is unavailable', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    expect(startLiveDictation(vi.fn(), vi.fn(), vi.fn())).toBeNull();
  });

  it('reports denied microphone permission and ends the session', () => {
    vi.stubGlobal('SpeechRecognition', RecognitionMock);
    const onError = vi.fn();
    const onEnd = vi.fn();
    startLiveDictation(vi.fn(), onEnd, onError);
    RecognitionMock.current.onerror?.({ error: 'not-allowed' });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('denied'));
    expect(onEnd).toHaveBeenCalledOnce();
  });
});
