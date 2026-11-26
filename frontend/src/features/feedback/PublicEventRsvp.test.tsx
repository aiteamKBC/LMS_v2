import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { eventFeedbackApi } from '@/api/eventFeedback';
import { PublicEventRsvp } from './PublicEventRsvp';

vi.mock('@/api/eventFeedback', () => ({
  eventFeedbackApi: { publicRsvp: vi.fn(), savePublicRsvp: vi.fn(), uploadPublicRsvpPhoto: vi.fn(), removePublicRsvpPhoto: vi.fn(), loadPublicRsvpPhoto: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(eventFeedbackApi.publicRsvp).mockResolvedValue({
    event: { id: 2, title: 'Leadership Day', date: '2 Oct 2026', time: '10:00 - 12:00', location: 'London' },
    recipient: { name: 'Guest Person' }, rsvpStatus: 'no_response', expiresAt: '2026-11-01T10:00:00Z',
    form: {
      id: 8, title: 'Event RSVP', description: 'Tell us your plans', instructions: '',
      allowSaveContinue: false, allowEditAfterSubmission: true,
      sections: [{ id: 1, title: 'Details', description: '', questions: [
        { id: 10, type: 'short_text', text: 'Dietary needs', required: false, helpText: '', config: {} },
        { id: 11, type: 'photo_upload', text: 'Upload a photo', required: false, helpText: '', config: {} },
      ] }],
      response: { id: null, status: 'not_started', answers: {}, submittedAt: null },
    },
  });
  vi.mocked(eventFeedbackApi.savePublicRsvp).mockResolvedValue({
    rsvpStatus: 'yes', response: { id: 22, status: 'completed', submittedAt: '2026-10-01T10:00:00Z' },
  });
  vi.mocked(eventFeedbackApi.uploadPublicRsvpPhoto).mockResolvedValue({ uploadId: 'photo-id', filename: 'photo.png' });
  vi.mocked(eventFeedbackApi.removePublicRsvpPhoto).mockResolvedValue(undefined);
  vi.mocked(eventFeedbackApi.loadPublicRsvpPhoto).mockRejectedValue(new Error('Photo preview unavailable in test'));
});

it('collects a changeable RSVP separately from extra form answers', async () => {
  const user = userEvent.setup();
  render(<PublicEventRsvp token="private-token" />);

  expect(await screen.findByText('Leadership Day')).toBeVisible();
  expect(await screen.findByText('Event Response')).toBeVisible();
  expect(screen.getByText('Your response')).toBeVisible();
  expect(screen.getByText('Kent Business College · Secure event response')).toBeVisible();
  expect(screen.queryByText(/\bRSVP\b/i)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'yes' }));
  await user.type(screen.getByRole('textbox', { name: /Dietary needs/ }), 'Vegetarian');
  await user.click(screen.getByRole('button', { name: 'Submit' }));

  expect(eventFeedbackApi.savePublicRsvp).toHaveBeenCalledWith('private-token', 'yes', { '10': 'Vegetarian' });
  expect(await screen.findByText(/Your response has been saved/)).toBeVisible();
});

it('enables photo selection and uploads through the private invitation endpoint', async () => {
  const user = userEvent.setup();
  const { container } = render(<PublicEventRsvp token="private-token" />);

  await screen.findByText('Choose or drop JPG, PNG or WebP (up to 20 MB)');
  const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(picker).toBeEnabled();
  const photo = new File(['image'], 'photo.png', { type: 'image/png' });
  await user.upload(picker, photo);

  expect(eventFeedbackApi.uploadPublicRsvpPhoto).toHaveBeenCalledWith('private-token', 11, photo);
  expect(await screen.findByText('photo.png')).toBeVisible();
});

it('accepts a photo dropped onto the upload area', async () => {
  const { container } = render(<PublicEventRsvp token="private-token" />);
  await screen.findByText('Choose or drop JPG, PNG or WebP (up to 20 MB)');
  const dropzone = container.querySelector('div.border-dashed')!;
  const photo = new File(['image'], 'dropped.png', { type: 'image/png' });

  fireEvent.dragEnter(dropzone, { dataTransfer: { files: [photo] } });
  expect(dropzone.className).toContain('ring-2');
  fireEvent.drop(dropzone, { dataTransfer: { files: [photo] } });

  expect(eventFeedbackApi.uploadPublicRsvpPhoto).toHaveBeenCalledWith('private-token', 11, photo);
  expect(await screen.findByText('photo.png')).toBeVisible();
});

it('removes an uploaded photo from storage and clears the answer', async () => {
  const user = userEvent.setup();
  const { container } = render(<PublicEventRsvp token="private-token" />);
  await screen.findByText('Choose or drop JPG, PNG or WebP (up to 20 MB)');
  const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  await user.upload(picker, new File(['image'], 'photo.png', { type: 'image/png' }));
  await user.click(await screen.findByRole('button', { name: 'Remove image' }));

  expect(eventFeedbackApi.removePublicRsvpPhoto).toHaveBeenCalledWith('private-token', 'photo-id');
  expect(await screen.findByText('Choose or drop JPG, PNG or WebP (up to 20 MB)')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Remove image' })).not.toBeInTheDocument();
});
