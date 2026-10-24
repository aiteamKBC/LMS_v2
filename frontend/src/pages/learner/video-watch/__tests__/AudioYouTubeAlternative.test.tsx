import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AudioYouTubeAlternative } from '../AudioYouTubeAlternative';

describe('separate audio alternative', () => {
  it('labels the external route and stops local playback when followed', () => {
    const leave = vi.fn();
    render(<AudioYouTubeAlternative url="https://youtu.be/abcdefghijk?t=8" onLeave={leave} />);
    const link = screen.getByRole('link', { name: 'Listen to this recording on YouTube' });
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcdefghijk');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(link);
    expect(leave).toHaveBeenCalledOnce();
  });
  it('does not render untrusted provider URLs', () => {
    render(<AudioYouTubeAlternative url="https://youtube.com.evil.test/watch?v=abcdefghijk" onLeave={vi.fn()} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
