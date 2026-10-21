import { afterEach, describe, expect, it, vi } from 'vitest';
import { learningFetch } from '@/lib/personalLearning';
import { invalidateLearnerReads } from './learnerRead';
import { approveTransferRequest, getTransferPreview, getTransferReview, submitTransferRequest } from './progressTransfer';

vi.mock('@/lib/personalLearning', () => ({ learningFetch: vi.fn() }));
vi.mock('./learnerRead', () => ({ invalidateLearnerReads: vi.fn() }));
afterEach(() => vi.resetAllMocks());
describe('progress transfer API', () => {
  it('reads a cancellable review and submits identities with the review token, never client hours or completion flags', async () => {
    const controller = new AbortController();
    vi.mocked(learningFetch).mockResolvedValueOnce(new Response('{"reviewToken":"review","modules":[],"csrfToken":"csrf"}'))
      .mockResolvedValueOnce(new Response('{"request":{"status":"approved"}}'));
    await getTransferReview('R1', controller.signal);
    expect(learningFetch).toHaveBeenLastCalledWith('/learner_api/progress-transfer/requests/R1/', expect.objectContaining({ signal: controller.signal, cache: 'no-store', credentials: 'include' }));
    const decisions = { reviewToken: 'review', mappings: [{ moduleId: 'M1', sourceActivityRef: 'material:7', targetComponentId: 'C1' }] };
    await approveTransferRequest('R1', 'csrf', decisions);
    expect(learningFetch).toHaveBeenLastCalledWith('/learner_api/progress-transfer/requests/R1/', expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirm: true, ...decisions }) }));
  });
  it('uses an owned route, CSRF and credentials, and sends no client progress values', async () => {
    vi.mocked(learningFetch).mockResolvedValue(new Response(JSON.stringify({ request: { requestId: 'R1', status: 'pending' } }), { status: 200 }));
    await submitTransferRequest('commercial', '7', 'csrf');
    expect(learningFetch).toHaveBeenCalledWith('/learner_api/progress-transfer/commercial/7/', expect.objectContaining({
      credentials: 'include', method: 'POST', headers: expect.objectContaining({ 'X-CSRFToken': 'csrf' }), body: '{"confirm":true}',
    }));
    expect(invalidateLearnerReads).toHaveBeenCalledOnce();
  });
  it('does not invalidate or report success after a server rejection', async () => {
    vi.mocked(learningFetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Admin required.' }), { status: 403 }));
    await expect(approveTransferRequest('R1','csrf')).rejects.toThrow('Admin required.');
    expect(invalidateLearnerReads).not.toHaveBeenCalled();
  });
  it('refuses confirmation without a CSRF token and reads previews without caching', async () => {
    await expect(submitTransferRequest('commercial','7','')).rejects.toThrow('Reload');
    expect(learningFetch).not.toHaveBeenCalled();
    vi.mocked(learningFetch).mockResolvedValue(new Response('{"eligible":[],"requests":[],"csrfToken":"csrf"}'));
    await getTransferPreview('apprenticeship','8');
    expect(learningFetch).toHaveBeenCalledWith('/learner_api/progress-transfer/apprenticeship/8/', expect.objectContaining({cache:'no-store',credentials:'include'}));
  });
});
