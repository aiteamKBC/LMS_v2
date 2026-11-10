import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { captionVtt, useCaptionTrack, type CaptionCue } from './captionTrack';

afterEach(() => vi.unstubAllGlobals());

it('keeps timing, clips negative starts and escapes transcript markup', () => {
  const text = captionVtt([{ start: -2, end: 1.234, text: '<script>private</script>', speaker: 'Tutor' },
    { start: 5, end: 2, text: 'Invalid' }]);
  expect(text).toContain('00:00:00.000 --> 00:00:01.234');
  expect(text).toContain('Tutor: &lt;script&gt;private&lt;/script&gt;');
  expect(text).not.toContain('Invalid');
});

it('releases the private caption URL when changing recordings or closing the player', async () => {
  const create = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  const Example = ({ cues }: { cues: CaptionCue[] }) => <output>{useCaptionTrack(cues)}</output>;
  const first = [{ start: 0, end: 1, text: 'One' }], second = [{ start: 2, end: 3, text: 'Two' }];
  const view = render(<Example cues={first} />);
  expect(await screen.findByText('blob:first')).toBeInTheDocument();
  await act(async () => view.rerender(<Example cues={second} />));
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:first'));
  expect(screen.getByText('blob:second')).toBeInTheDocument();
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:second');
});
