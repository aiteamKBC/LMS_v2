import { fireEvent, render, screen } from '@testing-library/react';
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
