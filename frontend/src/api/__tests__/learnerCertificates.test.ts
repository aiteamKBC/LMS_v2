import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllCachedResources } from '../cachedRequest';
import { fetchLearnerCertificateTemplate, issueLearnerModuleCertificate } from '../learnerCertificates';

describe('learner certificate requests', () => {
  beforeEach(() => {
    clearAllCachedResources();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    clearAllCachedResources();
    vi.unstubAllGlobals();
  });

  it('loads the summary contract instead of the full certificate artwork', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ configured: false, template: null, csrfToken: 'csrf-token' })));
    await expect(fetchLearnerCertificateTemplate('commercial', '101')).resolves.toMatchObject({ csrfToken: 'csrf-token' });
    expect(fetch).toHaveBeenCalledWith('/learner_api/certificates/commercial/101/template/?summary=1', expect.any(Object));
  });

  it('sends the CSRF token when issuing a module certificate', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ configured: true, template: null, certificate: null, issued: true })));
    await issueLearnerModuleCertificate('commercial', '101', 'current:MOD-1', 'csrf-token');
    expect(fetch).toHaveBeenCalledWith('/learner_api/certificates/commercial/101/modules/current%3AMOD-1/issue/', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRFToken': 'csrf-token', 'X-Requested-With': 'XMLHttpRequest' },
    }));
  });

  it('does not issue without request verification', async () => {
    await expect(issueLearnerModuleCertificate('commercial', '101', 'current:MOD-1', '')).rejects.toThrow('Request verification is unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });
});
