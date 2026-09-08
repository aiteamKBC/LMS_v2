import { describe, expect, it } from 'vitest';

import { waitingCopy, type LearnerAccessGate } from '../learnerAccessGate';

// ---------------------------------------------------------------------------
// The waiting page has to say the real reason. It used to say "your programme
// is scheduled to start on <date>" whatever the hold-up was — so a learner
// whose start date had passed months ago, waiting only on a learning plan, was
// told to sit tight for a date already behind them.
// ---------------------------------------------------------------------------

const gate = (overrides: Partial<LearnerAccessGate> = {}): LearnerAccessGate => ({
  blocked: true,
  reasons: [],
  startDate: '',
  outstandingDocuments: [],
  ...overrides,
});

describe('waitingCopy', () => {
  it('names the learning plan when that is what is missing', () => {
    // The reported learner: start date 1 May 2025, no plan assigned.
    const copy = waitingCopy(
      gate({ reasons: ['plan'], startDate: '2025-05-01' }),
      { commercial: true },
    );

    expect(copy.title).toBe('Your learning plan is being prepared');
    expect(copy.lines[0]).toMatch(/has not assigned your learning plan/);
    expect(copy.steps[0]).toMatch(/assigns your learning plan/);
  });

  it('says a passed start date has passed instead of promising it', () => {
    const copy = waitingCopy(
      gate({ reasons: ['plan'], startDate: '2025-05-01' }),
      { commercial: true },
    );

    expect(copy.lines.join(' ')).toMatch(/1 May 2025 has already passed/);
    // And never the old claim.
    expect(copy.lines.join(' ')).not.toMatch(/scheduled to start on/);
  });

  it('still promises a start date that is genuinely ahead', () => {
    const copy = waitingCopy(
      gate({ reasons: ['start-date-future'], startDate: '2099-01-05' }),
      { commercial: true },
    );

    expect(copy.title).toBe('Your programme starts soon');
    expect(copy.lines[0]).toMatch(/scheduled to start on 5 January 2099/);
  });

  it('says the start date is unset when it is', () => {
    const copy = waitingCopy(gate({ reasons: ['start-date-missing'] }), { commercial: true });

    expect(copy.title).toBe('Your start date has not been set yet');
    expect(copy.lines[0]).toMatch(/has not been confirmed/);
  });

  it('names the unsigned documents for an apprenticeship learner', () => {
    const copy = waitingCopy(gate({
      reasons: ['documents', 'start-date-future'],
      startDate: '2099-01-05',
      outstandingDocuments: ['Training Plan', 'Written Agreement'],
    }));

    expect(copy.title).toBe('Your enrolment paperwork is still being completed');
    expect(copy.lines[0]).toMatch(/Training Plan, Written Agreement/);
    // The date still gets its own line — both are true at once.
    expect(copy.lines.join(' ')).toMatch(/5 January 2099/);
  });

  it('lists every reason, in the order they have to be resolved', () => {
    const copy = waitingCopy(gate({
      reasons: ['documents', 'plan', 'start-date-future'],
      startDate: '2099-01-05',
      outstandingDocuments: ['Individual Learner Record'],
    }));

    expect(copy.lines).toHaveLength(3);
    expect(copy.lines[0]).toMatch(/documents/);
    expect(copy.lines[1]).toMatch(/learning plan/);
    expect(copy.lines[2]).toMatch(/scheduled to start/);
  });

  it('falls back to the plain waiting message when nothing is blocking', () => {
    // Also what an older response with no gate at all gets.
    const copy = waitingCopy(undefined, { commercial: true });

    expect(copy.title).toBe('Your programme starts soon');
    expect(copy.lines[0]).toMatch(/has not been set yet/);
    expect(copy.steps.at(-1)).toMatch(/activate automatically/);
  });

  it('closes with how access opens, per kind of learner', () => {
    const commercial = waitingCopy(gate({ reasons: ['plan'] }), { commercial: true });
    const apprentice = waitingCopy(gate({ reasons: ['plan'] }));

    expect(commercial.steps.at(-1)).toMatch(/access activates automatically/);
    expect(apprentice.steps.at(-1)).toMatch(/training plan and learning materials/);
  });
});
