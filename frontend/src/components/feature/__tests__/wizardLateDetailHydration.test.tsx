import { useEffect, useRef, useState } from 'react';
import { render, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

/**
 * The cohort step hydrates twice: once from the compact overview lists while the
 * programme-detail request is in flight (the "fast" pass), then again from the
 * detail response. The compact lists are scoped to operational visibility and
 * omit archived cohorts, so the fast pass legitimately finds nothing for some
 * programmes - it wrote the marker `<key>:empty`.
 *
 * The replace gate only recognised `<key>:compact` and `<key>:compact-modules`
 * as provisional, so `:empty` locked hydration for the rest of the session: the
 * detail response arrived with cohorts and was ignored, leaving "No cohorts are
 * found in the database for this programme" on screen. It only showed up once
 * the detail became slow enough for the fast pass to win the race (a cold
 * server cache made that response take ~30s).
 *
 * The probe mirrors the wizard's gate on both the old and the fixed shape, so
 * the pattern cannot regress without the 12k-line component in the way.
 */

type Detail = { cohorts: { id: string }[] } | null;

type ProbeProps = {
  detail: Detail;
  detailLoading: boolean;
  // Compact overview cohorts for this programme; empty is the case that broke.
  compactCohorts: { id: string }[];
  gate: 'old' | 'fixed';
};

const PROGRAMME_KEY = 'PROG-1';

function HydrationProbe({ detail, detailLoading, compactCohorts, gate }: ProbeProps) {
  const hydratedProgrammeRef = useRef('');
  const hydratedFromProgrammeDetailRef = useRef(false);
  const userEditedWizardRef = useRef(false);
  const [cohortDrafts, setCohortDrafts] = useState<string[]>([]);
  // Mirrors the ref, purely so the probe can render what the gate decided.
  const [marker, setMarker] = useState('');
  const hydrations = useRef(0);

  useEffect(() => {
    const canReplaceCompactHydration = gate === 'fixed'
      ? Boolean(
        !userEditedWizardRef.current
        && detail
        && !hydratedFromProgrammeDetailRef.current
        && hydratedProgrammeRef.current.startsWith(`${PROGRAMME_KEY}:`)
      )
      : Boolean(
        !userEditedWizardRef.current
        && (
          (hydratedProgrammeRef.current === `${PROGRAMME_KEY}:compact` && detail)
          || (hydratedProgrammeRef.current === `${PROGRAMME_KEY}:compact-modules` && detail)
        )
      );

    if (cohortDrafts.length && !canReplaceCompactHydration) return;
    if (hydratedProgrammeRef.current && !canReplaceCompactHydration) return;
    // The wizard's fast path: hydrate from the compact lists while the detail loads.
    const allowFastCohortHydration = !detail && detailLoading;
    if (detailLoading && !canReplaceCompactHydration && !allowFastCohortHydration) return;
    if (!detail && !canReplaceCompactHydration && !allowFastCohortHydration) return;

    const sourceCohorts = detail?.cohorts.length ? detail.cohorts : compactCohorts;
    const drafts = sourceCohorts.map(cohort => cohort.id);

    hydrations.current += 1;
    hydratedProgrammeRef.current = `${PROGRAMME_KEY}:${detail ? 'detail' : 'compact'}`;
    hydratedFromProgrammeDetailRef.current = Boolean(detail);
    if (!drafts.length) {
      hydratedProgrammeRef.current = `${PROGRAMME_KEY}:empty`;
      setMarker(hydratedProgrammeRef.current);
      return;
    }
    setMarker(hydratedProgrammeRef.current);
    setCohortDrafts(drafts);
  }, [cohortDrafts, compactCohorts, detail, detailLoading, gate]);

  return (
    <div>
      <div data-testid="drafts">{cohortDrafts.join(',')}</div>
      <div data-testid="marker">{marker}</div>
      <div data-testid="hydrations">{hydrations.current}</div>
    </div>
  );
}

function renderProbe(gate: 'old' | 'fixed') {
  const view = render(
    <HydrationProbe gate={gate} detail={null} detailLoading compactCohorts={[]} />
  );
  const rerenderWithDetail = (detail: Detail) => view.rerender(
    <HydrationProbe gate={gate} detail={detail} detailLoading={false} compactCohorts={[]} />
  );
  return { view, rerenderWithDetail };
}

describe('cohort hydration after a late programme detail', () => {
  it('hydrates from the detail response that lands after an empty compact pass', () => {
    const { view, rerenderWithDetail } = renderProbe('fixed');

    // Fast pass found nothing: the overview carries no cohort for this programme.
    expect(view.getByTestId('drafts')).toHaveTextContent('');
    expect(view.getByTestId('marker')).toHaveTextContent(`${PROGRAMME_KEY}:empty`);

    act(() => rerenderWithDetail({ cohorts: [{ id: 'COHORT-1' }, { id: 'COHORT-2' }] }));

    expect(view.getByTestId('drafts')).toHaveTextContent('COHORT-1,COHORT-2');
    expect(view.getByTestId('marker')).toHaveTextContent(`${PROGRAMME_KEY}:detail`);
  });

  it('pins the old gate as the bug: an empty compact pass swallowed the detail', () => {
    const { view, rerenderWithDetail } = renderProbe('old');

    act(() => rerenderWithDetail({ cohorts: [{ id: 'COHORT-1' }, { id: 'COHORT-2' }] }));

    expect(view.getByTestId('drafts')).toHaveTextContent('');
  });

  it('stops re-hydrating once the drafts came from the detail response', () => {
    const { view, rerenderWithDetail } = renderProbe('fixed');

    act(() => rerenderWithDetail({ cohorts: [{ id: 'COHORT-1' }] }));
    const hydrations = view.getByTestId('hydrations').textContent;
    act(() => rerenderWithDetail({ cohorts: [{ id: 'COHORT-1' }] }));

    expect(view.getByTestId('hydrations')).toHaveTextContent(String(hydrations));
    expect(view.getByTestId('drafts')).toHaveTextContent('COHORT-1');
  });

  it('keeps a detail response that genuinely has no cohorts empty', () => {
    const { view, rerenderWithDetail } = renderProbe('fixed');

    act(() => rerenderWithDetail({ cohorts: [] }));

    expect(view.getByTestId('drafts')).toHaveTextContent('');
    expect(view.getByTestId('marker')).toHaveTextContent(`${PROGRAMME_KEY}:empty`);
  });
});
