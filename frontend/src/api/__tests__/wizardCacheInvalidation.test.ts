/**
 * A cached payload must never outlive the write that changed it.
 *
 * The wizard board and ILR are cached per learner, so every endpoint that
 * mutates that learner has to clear them. Miss one and the learner reopens
 * their enrolment to see pre-edit answers — a far worse failure than the extra
 * request the cache was added to avoid.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearAllCachedResources } from '../cachedRequest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import {
  fetchExtendedIlr,
  fetchWizardBootstrap,
  invalidateWizardCache,
  peekExtendedIlr,
  saveExtendedIlr,
} from '../extendedIlr';
import { fetchKsbProfile, peekKsbProfile } from '../curriculum';
import { updateEnrolmentUser, finishEnrolment } from '../enrolmentUsers';
import { updateCommercialBoard } from '../commercialUsers';
import type { IlrForm } from '@/pages/users/types';

const json = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': 'application/json' }),
  text: () => Promise.resolve(JSON.stringify(body)),
  json: () => Promise.resolve(body),
});

const ILR_BODY = { answers: null, draft: null, meta: { updatedAt: '2026-08-01T00:00:00Z' } };
/** The KSB cache is keyed on the programme, so the board has to name one. */
const PROGRAMME = 'Test Programme';
const BOOTSTRAP_BODY = {
  board: { user: { id: '20', name: 'Test' }, programme: { name: PROGRAMME } },
  ilr: ILR_BODY,
};
const KSB_BODY = {
  standard: { id: 'std-1', label: 'A standard' },
  results: [{ id: 'k1', theme: 'Theme', kind: 'Knowledge', codes: ['K1'], title: 'A competency' }],
};

/** Requests actually sent, so a cache hit is distinguishable from a round-trip. */
const urlsCalled = () => fetchMock.mock.calls.map((call) => String(call[0]));
const getsFor = (fragment: string) =>
  fetchMock.mock.calls.filter(
    (call) => String(call[0]).includes(fragment) && (call[1]?.method ?? 'GET') === 'GET',
  ).length;

beforeEach(() => {
  clearAllCachedResources();
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (String(url).includes('wizard-bootstrap')) return Promise.resolve(json(BOOTSTRAP_BODY));
    if (String(url).includes('extended-ilr')) return Promise.resolve(json(ILR_BODY));
    if (String(url).includes('ksb-profile')) return Promise.resolve(json(KSB_BODY));
    return Promise.resolve(json({ user: { id: '20', name: 'Test' } }));
  });
});

describe('wizard payload caching', () => {
  it('opens the wizard in a single request', async () => {
    await fetchWizardBootstrap('commercial', '20');

    // Board and ILR arrive together, rather than as two separate round-trips.
    expect(urlsCalled()).toEqual(['/enrolment_api/wizard-bootstrap/commercial/20/']);
  });

  it('does not request the ILR again after the bootstrap has carried it', async () => {
    await fetchWizardBootstrap('commercial', '20');
    // WizardProvider asks for this on mount; the bootstrap already has it.
    const ilr = await fetchExtendedIlr('commercial', '20');

    expect(ilr).toEqual(ILR_BODY);
    expect(getsFor('extended-ilr')).toBe(0);
  });

  it('does not request the KSB profile again after the bootstrap has carried it', async () => {
    // The profile was the last link in a chain of round-trips: the wizard only
    // seeds its unrated rows once the saved answers have arrived, so it could not
    // even start until then. Until it landed the Skills Radar had no rows, which
    // made the step read as complete and the progress rail count it — the second
    // "loading" phase the learner saw. Carried by the bootstrap, it costs nothing.
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('wizard-bootstrap')) {
        return Promise.resolve(json({ ...BOOTSTRAP_BODY, ksbProfile: KSB_BODY }));
      }
      return Promise.resolve(json(KSB_BODY));
    });

    await fetchWizardBootstrap('commercial', '20');
    const profile = await fetchKsbProfile(PROGRAMME);

    expect(profile).toEqual(KSB_BODY);
    expect(getsFor('ksb-profile')).toBe(0);
  });

  it('still fetches the KSB profile when the bootstrap omits it', async () => {
    // An older backend does not send the field. The wizard must fall back to its
    // own request rather than seeding nothing and calling the step complete.
    await fetchWizardBootstrap('commercial', '20');
    const profile = await fetchKsbProfile(PROGRAMME);

    expect(profile).toEqual(KSB_BODY);
    expect(getsFor('ksb-profile')).toBe(1);
  });

  it('exposes cached payloads synchronously, so nothing has to flash a spinner', async () => {
    // The wizard reads these during render, not in an effect. Effects run after
    // paint, so hydrating there cost one visible frame of "Loading your answers…"
    // (and one of the Skills Radar spinner) even on a warm cache — which is what
    // made moving between steps look like a page reload.
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('wizard-bootstrap')) {
        return Promise.resolve(json({ ...BOOTSTRAP_BODY, ksbProfile: KSB_BODY }));
      }
      return Promise.resolve(json(KSB_BODY));
    });

    // Nothing cached yet: a first-frame render genuinely has to wait.
    expect(peekExtendedIlr('commercial', '20')).toBeUndefined();
    expect(peekKsbProfile(PROGRAMME)).toBeUndefined();

    await fetchWizardBootstrap('commercial', '20');

    // Now both are available without awaiting anything.
    expect(peekExtendedIlr('commercial', '20')).toEqual(ILR_BODY);
    expect(peekKsbProfile(PROGRAMME)).toEqual(KSB_BODY);
  });

  it('does not serve a peeked payload once it has been invalidated', async () => {
    // A stale peek would be worse than a spinner: the learner would see pre-edit
    // answers rendered as though they were current.
    await fetchWizardBootstrap('commercial', '20');
    expect(peekExtendedIlr('commercial', '20')).toEqual(ILR_BODY);

    invalidateWizardCache('commercial', '20');

    expect(peekExtendedIlr('commercial', '20')).toBeUndefined();
  });

  it('collapses a StrictMode double mount into one request', async () => {
    await Promise.all([
      fetchWizardBootstrap('commercial', '20'),
      fetchWizardBootstrap('commercial', '20'),
    ]);

    expect(getsFor('wizard-bootstrap')).toBe(1);
  });

  it('serves the saved answers from the write response, without refetching', async () => {
    const saved = { ...ILR_BODY, meta: { updatedAt: '2026-08-11T00:00:00Z' } };
    fetchMock.mockImplementation(() => Promise.resolve(json(saved)));

    await saveExtendedIlr('commercial', '20', {} as IlrForm);
    const after = await fetchExtendedIlr('commercial', '20');

    expect(after).toEqual(saved);
    expect(getsFor('extended-ilr')).toBe(0);
  });

  it('re-reads the board after a learner update', async () => {
    await fetchWizardBootstrap('commercial', '20');
    await updateEnrolmentUser('20', { username: 'Renamed' });
    await fetchWizardBootstrap('commercial', '20');

    expect(getsFor('wizard-bootstrap')).toBe(2);
  });

  it('re-reads the board after a commercial update', async () => {
    await fetchWizardBootstrap('commercial', '20');
    await updateCommercialBoard('20', { username: 'Renamed' });
    await fetchWizardBootstrap('commercial', '20');

    expect(getsFor('wizard-bootstrap')).toBe(2);
  });

  it('re-reads the board after enrolment is finished', async () => {
    // Activation flips programme status, which drives the learner's whole nav.
    await fetchWizardBootstrap('apprenticeship', '20');
    await finishEnrolment('20');
    await fetchWizardBootstrap('apprenticeship', '20');

    expect(getsFor('wizard-bootstrap')).toBe(2);
  });

  it('invalidates by id across both learner kinds', async () => {
    // The board endpoints take an id alone, so a write cannot know the kind.
    await fetchWizardBootstrap('commercial', '20');
    await fetchWizardBootstrap('apprenticeship', '20');
    await updateEnrolmentUser('20', { username: 'Renamed' });

    await fetchWizardBootstrap('commercial', '20');
    await fetchWizardBootstrap('apprenticeship', '20');

    expect(getsFor('wizard-bootstrap')).toBe(4);
  });
});
