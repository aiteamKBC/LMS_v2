import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoachingKeywords, loadCoachingQuality, type CoachingKeywordQuality, type CoachingQuality } from '@/api/coachingRecordings';
import QualitySuggestion, { AiQualitySuggestion } from './QualitySuggestion';

vi.mock('@/api/coachingRecordings', () => ({ loadCoachingQuality: vi.fn(), loadCoachingKeywords: vi.fn() }));
const empty = (): CoachingQuality => ({ eventKey: 'mcr:1', state: 'not-analysed', result: null,
  retryAfter: 0, updatedAt: null, reviewOnly: true, sampled: false, unlinkedTranscriptExcluded: false });
const complete = (): CoachingQuality => ({ ...empty(), state: 'complete', result: {
  title: 'Synthetic meeting', model: 'configured', mixed: true, insufficientEvidence: false,
  uncertainty: 'Context needs review.', sampled: true, unlinkedTranscriptExcluded: false, reviewOnly: true,
  types: [{ type: 'MCM', confidence: 'medium', reason: 'Goals discussed.', evidence: ['We reviewed the learning goals.'], referenceIds: ['m'], templateBased: true },
    { type: 'SUPPORT', confidence: 'low', reason: 'Support topic.', evidence: ['Support was discussed.'], referenceIds: [], templateBased: false }],
  references: [{ id: 'm', name: 'Programme monthly template', family: 'MCM', linked: true }],
}, sampled: true });
const mount = () => render(<AiQualitySuggestion eventKey="mcr:1" context="signed-calendar-title" />);

describe('Review-only meeting classification', () => {
  beforeEach(() => { vi.mocked(loadCoachingQuality).mockReset().mockResolvedValue(empty()); });

  it('loads the cache without generating and shows template and evidence for a mixed suggestion', async () => {
    vi.mocked(loadCoachingQuality).mockResolvedValueOnce(empty()).mockResolvedValueOnce(complete());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Analyse meeting type' }));
    expect(await screen.findByText(/Multiple types suggested/)).toBeInTheDocument();
    expect(loadCoachingQuality).toHaveBeenNthCalledWith(1, 'mcr:1', 'signed-calendar-title', false, expect.any(AbortSignal));
    expect(loadCoachingQuality).toHaveBeenNthCalledWith(2, 'mcr:1', 'signed-calendar-title', true);
    expect(screen.getByText('We reviewed the learning goals.')).toBeInTheDocument();
    expect(screen.getByText(/no Student Support template/)).toBeInTheDocument();
    expect(screen.getByText(/Long transcript/)).toBeInTheDocument();
    expect(screen.getByText(/Programme monthly template/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Analyse meeting type' })).not.toBeInTheDocument();
  });

  it('coalesces repeat clicks while the request is in flight', async () => {
    let finish!: (value: CoachingQuality) => void;
    vi.mocked(loadCoachingQuality).mockResolvedValueOnce(empty()).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    mount();
    const button = await screen.findByRole('button', { name: 'Analyse meeting type' });
    fireEvent.click(button); fireEvent.click(button);
    expect(loadCoachingQuality).toHaveBeenCalledTimes(2);
    await act(async () => finish(complete()));
  });

  it('reopening or checking a saved result does not issue a paid request', async () => {
    vi.mocked(loadCoachingQuality).mockResolvedValue(complete());
    mount(); await screen.findByText(/Multiple types suggested/);
    fireEvent.click(screen.getByRole('button', { name: 'Check saved analysis' }));
    await waitFor(() => expect(loadCoachingQuality).toHaveBeenCalledTimes(2));
    expect(vi.mocked(loadCoachingQuality).mock.calls.every(call => call[2] === false)).toBe(true);
  });

  it('shows missing evidence as a prerequisite without offering a generation button', async () => {
    vi.mocked(loadCoachingQuality).mockRejectedValue(new Error('No saved transcript is verified for this session time.'));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('No saved transcript');
    expect(screen.queryByRole('button', { name: 'Analyse meeting type' })).not.toBeInTheDocument();
  });

  it('shows existing work in progress without issuing another request', async () => {
    vi.mocked(loadCoachingQuality).mockResolvedValue({ ...empty(), state: 'running', retryAfter: 120 });
    mount(); expect(await screen.findByText(/already in progress/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Analyse meeting type' })).not.toBeInTheDocument();
    expect(loadCoachingQuality).toHaveBeenCalledTimes(1);
  });
});

const keywords = (): CoachingKeywordQuality => ({ ...complete(), method: 'keywords', sampled: false,
  result: { ...complete().result!, sampled: false, model: 'template-keywords-v1', analysedCharacters: 1000,
    types: [complete().result!.types[0]], mixed: false,
    keywordSignals: [{ type: 'MCM', topicCount: 2, matchedTerms: ['learning goal', 'study barrier'], evidence: ['Learning goals discussed.'],
      templateBased: true, transcriptMentioned: true, titleMentioned: false },
    { type: 'SUPPORT', topicCount: 0, matchedTerms: [], evidence: [], templateBased: false, transcriptMentioned: true, titleMentioned: false }],
  } });

describe('Keyword analysis by default', () => {
  beforeEach(() => {
    vi.mocked(loadCoachingKeywords).mockReset().mockResolvedValue(keywords());
    vi.mocked(loadCoachingQuality).mockReset().mockResolvedValue(empty());
  });
  const mountKeywords = () => render(<QualitySuggestion eventKey="mcr:1" context="signed-calendar-title" />);

  it('reads keywords once and does not request AI on opening details', async () => {
    mountKeywords();
    expect(await screen.findByText('Suggested type from keywords')).toBeInTheDocument();
    expect(screen.getByText(/Matched phrases: learning goal/)).toBeInTheDocument();
    expect(screen.getByText(/Weak signals/)).toBeInTheDocument();
    expect(screen.getByText(/No Student Support template/)).toBeInTheDocument();
    expect(loadCoachingKeywords).toHaveBeenCalledTimes(1);
    expect(loadCoachingQuality).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Analyse meeting type' })).not.toBeInTheDocument();
  });

  it('requires opening AI review and then an explicit generation action', async () => {
    vi.mocked(loadCoachingQuality).mockResolvedValueOnce(empty()).mockResolvedValueOnce(complete());
    mountKeywords();
    fireEvent.click(await screen.findByRole('button', { name: 'Open optional AI review' }));
    const button = await screen.findByRole('button', { name: 'Analyse meeting type' });
    expect(loadCoachingQuality).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadCoachingQuality).mock.calls[0][2]).toBe(false);
    fireEvent.click(button);
    expect(await screen.findByText(/Multiple types suggested/)).toBeInTheDocument();
    expect(vi.mocked(loadCoachingQuality).mock.calls[1][2]).toBe(true);
    expect(loadCoachingKeywords).toHaveBeenCalledTimes(1);
  });

  it('shows insufficient keywords without silently escalating to AI', async () => {
    const value = keywords(); value.result.types = []; value.result.insufficientEvidence = true;
    vi.mocked(loadCoachingKeywords).mockResolvedValue(value);
    mountKeywords();
    expect(await screen.findByText('Keywords are insufficient to suggest a type')).toBeInTheDocument();
    expect(loadCoachingQuality).not.toHaveBeenCalled();
  });

  it('shows possible mixed evidence without changing review or booking state', async () => {
    const value = keywords();
    value.result.types.push({ type: 'PR', confidence: 'low', reason: 'Distinct progress topics matched.',
      evidence: ['Employer feedback and workplace performance were discussed.'], referenceIds: ['p'], templateBased: true });
    value.result.references.push({ id: 'p', name: 'Programme progress template', family: 'PR', linked: false });
    value.result.keywordSignals.push({ type: 'PR', topicCount: 2, matchedTerms: ['employer feedback', 'workplace performance'],
      evidence: ['Employer feedback and workplace performance were discussed.'], templateBased: true, transcriptMentioned: false, titleMentioned: false });
    value.result.mixed = true;
    vi.mocked(loadCoachingKeywords).mockResolvedValue(value);
    mountKeywords();
    expect(await screen.findByText(/Possible multiple types/)).toBeInTheDocument();
    expect(loadCoachingQuality).not.toHaveBeenCalled();
  });

  it('exposes missing saved evidence and retries only the local reader', async () => {
    vi.mocked(loadCoachingKeywords).mockRejectedValueOnce(new Error('No verified transcript.')).mockResolvedValueOnce(keywords());
    mountKeywords(); expect(await screen.findByRole('alert')).toHaveTextContent('No verified transcript.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry keyword analysis' }));
    expect(await screen.findByText('Suggested type from keywords')).toBeInTheDocument();
    expect(loadCoachingQuality).not.toHaveBeenCalled();
  });

  it('distinguishes missing prerequisites from service errors without automatic retry or AI', async () => {
    const missing = new Error('No verified transcript.'); missing.name = 'CoachingQualityPrerequisiteError';
    vi.mocked(loadCoachingKeywords).mockRejectedValue(missing);
    mountKeywords();
    expect(await screen.findByText(/open Transcript first/i)).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(loadCoachingQuality).not.toHaveBeenCalled();
    expect(loadCoachingKeywords).toHaveBeenCalledTimes(1);
  });
});
