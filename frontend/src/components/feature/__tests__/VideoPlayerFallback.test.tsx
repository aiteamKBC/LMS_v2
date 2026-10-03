import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VideoPlayer, parseVideoUrl } from '../VideoPlayer';

describe('Drive viewing without download permission', () => {
  it('opens the permitted preview after a stream failure without recording playback or completion', () => {
    const onEnded = vi.fn(), onProgress = vi.fn(), onUnsupported = vi.fn(), onPlayingChange = vi.fn();
    const { container, rerender } = render(<VideoPlayer parsed={parseVideoUrl('https://drive.google.com/file/d/1234567890/view')}
      title="Lecture" onEnded={onEnded} onProgress={onProgress} onUnsupported={onUnsupported} onPlayingChange={onPlayingChange} />);
    expect(container.querySelector('iframe')).toBeNull();
    fireEvent.error(container.querySelector('video')!);
    expect(screen.getByTitle('Lecture')).toHaveAttribute('src', 'https://drive.google.com/file/d/1234567890/preview');
    expect(onUnsupported).toHaveBeenCalledOnce();
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    expect(onProgress).not.toHaveBeenCalled();
    expect(onEnded).not.toHaveBeenCalled();
    rerender(<VideoPlayer parsed={parseVideoUrl('https://drive.google.com/file/d/0987654321/view')} title="Next lecture" />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('video')).toHaveAttribute('src', '/learner_api/media/google-drive/0987654321/');
  });

  it('keeps successful direct playback in the native player', () => {
    const { container } = render(<VideoPlayer parsed={parseVideoUrl('https://drive.google.com/file/d/1234567890/view')} title="Lecture" />);
    fireEvent.loadedMetadata(container.querySelector('video')!);
    expect(container.querySelector('video')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });
});

it.each([false, true])('counts native video only during audible playback (muted=%s)', (muted) => {
  const onPlayingChange = vi.fn();
  const { container } = render(<VideoPlayer parsed={parseVideoUrl('https://example.test/lesson.mp4')} title="Lesson" onPlayingChange={onPlayingChange} />);
  const video = container.querySelector('video')!;
  video.muted = muted;
  fireEvent.play(video);
  expect(onPlayingChange).not.toHaveBeenCalledWith(true);
  fireEvent.playing(video);
  expect(onPlayingChange).toHaveBeenLastCalledWith(!muted);
  fireEvent.volumeChange(video);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(onPlayingChange).toHaveBeenLastCalledWith(!muted);
  for (const event of ['waiting', 'seeking', 'emptied', 'pause', 'error']) {
    fireEvent.playing(video);
    fireEvent(video, new Event(event));
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
  }
});


it('tracks YouTube playing state in a hidden tab and stops for buffering or pause', async () => {
  const onPlayingChange = vi.fn();
  let stateChange: ((event: { data: number }) => void) | undefined;
  window.YT = {
    PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
    Player: class {
      constructor(_element: HTMLElement | string, options: unknown) {
        stateChange = (options as { events: { onStateChange: typeof stateChange } }).events.onStateChange;
      }
      getDuration() { return 600; }
      getCurrentTime() { return 0; }
      isMuted() { return false; }
      getVolume() { return 100; }
      destroy() { /* No external player in this test. */ }
    },
  };
  const { unmount } = render(<VideoPlayer parsed={parseVideoUrl('https://youtube.com/watch?v=lesson12345')} title="Lesson" onPlayingChange={onPlayingChange} />);
  try {
    await waitFor(() => expect(stateChange).toBeDefined());
    stateChange!({ data: 1 });
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
    stateChange!({ data: 3 });
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    stateChange!({ data: 1 });
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
    stateChange!({ data: 2 });
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    visible.mockRestore();
  } finally {
    unmount();
    delete window.YT;
  }
});


it('stops on mute or zero volume and resumes only while the native video is playing', () => {
  const onPlayingChange = vi.fn();
  const { container, rerender, unmount } = render(<VideoPlayer parsed={parseVideoUrl('https://example.test/lesson.mp4')} title="Lesson" onPlayingChange={onPlayingChange} />);
  const video = container.querySelector('video')!;
  fireEvent.volumeChange(video);
  expect(onPlayingChange).not.toHaveBeenCalledWith(true);
  fireEvent.playing(video);
  expect(onPlayingChange).toHaveBeenLastCalledWith(true);
  video.muted = true;
  fireEvent.volumeChange(video);
  expect(onPlayingChange).toHaveBeenLastCalledWith(false);
  video.muted = false;
  fireEvent.volumeChange(video);
  expect(onPlayingChange).toHaveBeenLastCalledWith(true);
  video.volume = 0;
  fireEvent.volumeChange(video);
  expect(onPlayingChange).toHaveBeenLastCalledWith(false);
  video.volume = 0.5;
  fireEvent.volumeChange(video);
  expect(onPlayingChange).toHaveBeenLastCalledWith(true);
  for (const event of ['waiting', 'seeking', 'emptied', 'pause', 'ended', 'error']) {
    fireEvent.playing(video);
    fireEvent(video, new Event(event));
    video.muted = true;
    fireEvent.volumeChange(video);
    video.muted = false;
    fireEvent.volumeChange(video);
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
  }
  fireEvent.playing(video);
  rerender(<VideoPlayer parsed={parseVideoUrl('https://example.test/next.mp4')} title="Next" onPlayingChange={onPlayingChange} />);
  expect(onPlayingChange).toHaveBeenLastCalledWith(false);
  fireEvent.volumeChange(container.querySelector('video')!);
  expect(onPlayingChange).toHaveBeenLastCalledWith(false);
  fireEvent.playing(container.querySelector('video')!);
  unmount();
  expect(onPlayingChange).toHaveBeenLastCalledWith(false);
});

it('rechecks YouTube mute and volume without requiring a playback state change', async () => {
  vi.useFakeTimers();
  const onPlayingChange = vi.fn();
  let stateChange: ((event: { data: number }) => void) | undefined;
  let muted = true;
  let volume = 100;
  window.YT = {
    PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
    Player: class {
      constructor(_element: HTMLElement | string, options: unknown) {
        stateChange = (options as { events: { onStateChange: typeof stateChange } }).events.onStateChange;
      }
      getDuration() { return 600; }
      getCurrentTime() { return 5; }
      isMuted() { return muted; }
      getVolume() { return volume; }
      destroy() { /* No external player in this test. */ }
    },
  };
  const { unmount } = render(<VideoPlayer parsed={parseVideoUrl('https://youtube.com/watch?v=lesson12345')} title="Lesson" onPlayingChange={onPlayingChange} />);
  try {
    await Promise.resolve();
    stateChange!({ data: 1 });
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    muted = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
    muted = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    muted = false;
    volume = 0;
    await vi.advanceTimersByTimeAsync(500);
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    volume = 50;
    await vi.advanceTimersByTimeAsync(500);
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
    for (const state of [3, 2, 0]) {
      stateChange!({ data: state });
      muted = true;
      await vi.advanceTimersByTimeAsync(500);
      muted = false;
      await vi.advanceTimersByTimeAsync(500);
      expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    }
  } finally {
    unmount();
    delete window.YT;
    vi.useRealTimers();
  }
});
