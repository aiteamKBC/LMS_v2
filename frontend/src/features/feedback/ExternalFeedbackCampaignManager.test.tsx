import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { FeedbackForm } from '@/api/feedback';
import { externalFeedbackApi } from '@/api/externalFeedback';
import { ExternalFeedbackCampaignManager } from './ExternalFeedbackCampaignManager';

vi.mock('@/api/externalFeedback', () => ({ externalFeedbackApi: { list: vi.fn(), detail: vi.fn(), preview: vi.fn(), create: vi.fn(), createManual: vi.fn(), send: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(externalFeedbackApi.list).mockResolvedValue({ campaigns: [] }); });
const forms = [
  { id: 1, title: 'Information form', formType: 'information_session', status: 'published', version: 2 },
  { id: 2, title: 'Commitment form', formType: 'commitment_meeting', status: 'published', version: 1 },
  { id: 3, title: 'Event form', formType: 'post_event', status: 'published', version: 1 },
] as FeedbackForm[];

it('keeps published forms separated by campaign type', async () => {
  const user = userEvent.setup();
  render(<ExternalFeedbackCampaignManager forms={forms} />);
  const formSelect = screen.getByRole('combobox', { name: 'Published form' });
  expect(formSelect).toHaveTextContent('Information form');
  expect(formSelect).not.toHaveTextContent('Commitment form');
  expect(formSelect).not.toHaveTextContent('Event form');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'commitment_meeting');
  expect(formSelect).toHaveTextContent('Commitment form');
  expect(formSelect).not.toHaveTextContent('Information form');
});

it('shows all four validation groups before campaign creation', async () => {
  const user = userEvent.setup();
  vi.mocked(externalFeedbackApi.preview).mockResolvedValue({ preview: {
    valid: [{ row: 2, name: 'Valid', email: 'valid@example.test' }],
    invalidEmails: [{ row: 3, name: 'Bad', email: 'bad' }],
    missingRows: [{ row: 4, name: '', email: 'missing@example.test', missing: 'Name' }],
    duplicates: [{ row: 5, name: 'Again', email: 'valid@example.test' }],
    counts: { valid: 1, invalidEmails: 1, missingRows: 1, duplicates: 1 }, truncated: false,
  } });
  render(<ExternalFeedbackCampaignManager forms={forms} />);
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Welcome');
  await user.type(screen.getByLabelText('Date'), '2026-10-17');
  await user.upload(screen.getByLabelText('Recipient file'), new File(['rows'], 'recipients.csv', { type: 'text/csv' }));
  await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
  expect((await screen.findAllByText('Invalid emails')).length).toBeGreaterThan(0);
  expect(screen.getByText('Missing required values')).toBeVisible();
  expect(screen.getByText('Duplicate emails (case-insensitive)')).toBeVisible();
  expect(externalFeedbackApi.create).not.toHaveBeenCalled();
});

it('creates and immediately sends a small manually entered audience', async () => {
  const user = userEvent.setup();
  vi.mocked(externalFeedbackApi.createManual).mockResolvedValue({
    campaign: {
      id: 9, campaignType: 'information_session', name: 'Welcome', sessionDate: '2026-10-17', status: 'open',
      form: { id: 1, title: 'Information form', version: 2, formType: 'information_session' },
      recipientCount: 1, counts: { pending: 0, sent: 1, opened: 0, submitted: 0, failed: 0 },
      createdBy: 'Staff', createdAt: '2026-10-17T10:00:00Z', updatedAt: '2026-10-17T10:00:00Z', recipients: [],
    },
    preview: { valid: [], invalidEmails: [], missingRows: [], duplicates: [], counts: { valid: 1, invalidEmails: 0, missingRows: 0, duplicates: 0 }, truncated: false },
    delivery: { attempted: 1, sent: 1, failed: 0, remaining: 0 },
  });
  render(<ExternalFeedbackCampaignManager forms={forms} />);
  await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Welcome');
  await user.type(screen.getByLabelText('Date'), '2026-10-17');
  await user.type(screen.getByRole('textbox', { name: 'Manual recipients' }), 'Alex Morgan, alex@example.com');
  await user.click(screen.getByRole('button', { name: 'Create campaign & send now' }));
  expect(externalFeedbackApi.createManual).toHaveBeenCalledWith(expect.objectContaining({
    campaignType: 'information_session', name: 'Welcome', formId: 1,
    manualRecipients: 'Alex Morgan, alex@example.com',
  }));
  expect(await screen.findByText('1 sent; 0 failed.')).toBeVisible();
});
