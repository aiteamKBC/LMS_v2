import { useEffect, useRef, useState } from 'react';
import { render, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

/**
 * The wizard's open-time reset used to depend on startStep / initialProgrammeId /
 * initialModuleId, and selectedProgramme was derived straight from the
 * initialProgramme prop. The parent (programme-detail) rebuilds all of those on
 * every programme refetch, so a refetch landing mid-edit re-ran the reset: the
 * user was thrown back to step one and their drafts were wiped.
 *
 * These tests pin the two fixes on a probe that mirrors the wizard's pinning
 * block and reset gate, so the pattern cannot regress without the 12k-line
 * component in the way.
 */

type Props = { isOpen: boolean; startStep: string; initialProgramme: { name: string } };

function WizardResetProbe({ isOpen, startStep, initialProgramme }: Props) {
  // Mirrors the wizard: inputs pinned for the lifetime of one open session.
  const wasOpenRef = useRef(false);
  const startStepRef = useRef(startStep);
  const pinnedProgrammeRef = useRef(initialProgramme);
  if (!isOpen) {
    startStepRef.current = startStep;
    pinnedProgrammeRef.current = initialProgramme;
  }
  const pinnedStartStep = startStepRef.current;

  const [step, setStep] = useState(pinnedStartStep);
  const [draft, setDraft] = useState('');
  const resetCount = useRef(0);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    resetCount.current += 1;
    setStep(pinnedStartStep);
    setDraft('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <div>
      <div data-testid="step">{step}</div>
      <div data-testid="draft">{draft}</div>
      <div data-testid="resets">{resetCount.current}</div>
      <div data-testid="pinned">{pinnedProgrammeRef.current.name}</div>
      <button data-testid="type" onClick={() => { setStep('modules'); setDraft('my module work'); }}>type</button>
    </div>
  );
}

describe('wizard reset fires on open only', () => {
  it('keeps step and drafts when the parent rebuilds props mid-edit', () => {
    const { getByTestId, rerender } = render(
      <WizardResetProbe isOpen startStep="cohort" initialProgramme={{ name: 'Fouda-Programme' }} />,
    );
    expect(getByTestId('step').textContent).toBe('cohort');

    act(() => { getByTestId('type').click(); });
    expect(getByTestId('step').textContent).toBe('modules');
    expect(getByTestId('draft').textContent).toBe('my module work');

    // A programme refetch in the parent: new object identity, new startStep.
    rerender(<WizardResetProbe isOpen startStep="review" initialProgramme={{ name: 'Fouda-Programme' }} />);

    expect(getByTestId('step').textContent).toBe('modules');
    expect(getByTestId('draft').textContent).toBe('my module work');
    expect(getByTestId('resets').textContent).toBe('1');
    // The pinned programme ignores the refetched object while open.
    expect(getByTestId('pinned').textContent).toBe('Fouda-Programme');
  });

  it('still resets on the next open, honouring the newest startStep', () => {
    const { getByTestId, rerender } = render(
      <WizardResetProbe isOpen startStep="cohort" initialProgramme={{ name: 'A' }} />,
    );
    act(() => { getByTestId('type').click(); });
    expect(getByTestId('draft').textContent).toBe('my module work');

    rerender(<WizardResetProbe isOpen={false} startStep="group" initialProgramme={{ name: 'B' }} />);
    rerender(<WizardResetProbe isOpen startStep="group" initialProgramme={{ name: 'B' }} />);

    expect(getByTestId('step').textContent).toBe('group');
    expect(getByTestId('draft').textContent).toBe('');
    expect(getByTestId('resets').textContent).toBe('2');
    expect(getByTestId('pinned').textContent).toBe('B');
  });
});
