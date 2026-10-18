import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { externalFeedbackApi, type ExternalCampaignType } from '@/api/externalFeedback';
import { PublicExternalFeedback } from './PublicExternalFeedback';

vi.mock('@/api/externalFeedback', () => ({ externalFeedbackApi: { publicAccess: vi.fn(), submit: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

function response(campaignType: ExternalCampaignType) {
  return {
    campaign: { id: 4, campaignType, name: campaignType === 'information_session' ? 'October Information Session' : 'Initial Commitment Meeting', sessionDate: '2026-10-17' },
    recipient: { name: 'External Guest' }, expiresAt: '2026-11-17T00:00:00Z',
    form: { id: 7, title: 'Tell us what you think', description: '', instructions: '', sections: [{ id: 1, title: 'Feedback', description: '', questions: [{ id: 11, type: 'short_text' as const, text: 'Comments', required: true, helpText: '', config: {} }] }], response: { id: null, status: 'not_started' as const, answers: {}, submittedAt: null } },
  };
}

it.each([
  ['information_session' as const, 'Information Session feedback'],
  ['commitment_meeting' as const, 'Commitment Meeting feedback'],
])('renders the isolated %s public experience', async (campaignType, label) => {
  vi.mocked(externalFeedbackApi.publicAccess).mockResolvedValue(response(campaignType));
  render(<PublicExternalFeedback token="personal-token" />);
  expect(await screen.findByText(label)).toBeVisible();
  expect(screen.getByText('External Guest', { exact: false })).toBeVisible();
  expect(externalFeedbackApi.publicAccess).toHaveBeenCalledWith('personal-token');
});

it('submits once through the token-scoped endpoint', async () => {
  const user = userEvent.setup();
  vi.mocked(externalFeedbackApi.publicAccess).mockResolvedValue(response('information_session'));
  vi.mocked(externalFeedbackApi.submit).mockResolvedValue({ response: { id: 20, status: 'completed', submittedAt: '2026-10-17T12:00:00Z' } });
  render(<PublicExternalFeedback token="personal-token" />);
  await user.type(await screen.findByRole('textbox', { name: /Comments/ }), 'Helpful');
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByText(/has been submitted/)).toBeVisible();
  expect(externalFeedbackApi.submit).toHaveBeenCalledWith('personal-token', { '11': 'Helpful' });
});
