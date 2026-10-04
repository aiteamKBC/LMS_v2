import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { buildLearnersPdf } from './exportPdf';
import type { Learner } from '../types';

const logo = { format: 'PNG' as const, data: new Uint8Array(readFileSync('public/assets/kbc-logo.png')) };

const learner: Learner = {
  id: 'synthetic-1', name: 'Synthetic Learner', initials: 'SL', employer: 'Example Employer', cohortId: 'c1', cohortName: 'Example Cohort',
  group: 'Example Group', status: 'on-track', enrollmentStatus: 'active', riskFlags: [], overallProgress: 12, overallProgressAvailable: true,
  attendanceRate: 80, attendanceRateAvailable: true, componentsCompleted: 8, componentsPlanned: 10,
  otjhCompleted: 70, otjhTarget: 90, ksbProgress: 65, ksbProgressAvailable: true, ksbCompleted: 13, ksbTarget: 20,
  otjhTargetAsOfToday: 80, otjhProgressAsOfToday: 87.5, otjhRagStatus: 'on-track',
  evidenceCount: 2, nextCoaching: '--', nextReview: '--', lastContact: '--', lastAttendanceDate: '--',
  lastActivity: '19 Sep 2026', lastProgressReview: '--', lastReview: '--', lastCoachingSession: '--', lastSubmittedEvidence: '--',
  recentFlag: null, progressVariance: '--', startDate: '01 Jan 2026', gatewayReviewDate: '01 Jan 2027', plannedEndDate: '01 Feb 2027',
  rawProgramStatus: 'Delivery', programmeName: 'Project Manager Level 4', liveAttendanceRate: 88,
};

function pdfText(doc: ReturnType<typeof buildLearnersPdf>) {
  const pdf = doc.output();
  return [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    try {
      const stream = inflateSync(Buffer.from(match[1], 'binary')).toString('latin1');
      return [...stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)]
        .map(text => text[1].replace(/\\([\\()])/g, '$1')).join(' ');
    } catch { return ''; }
  }).join('\n');
}

describe('coach learners PDF', () => {
  it('places OTJH before its calculated progress and omits component and group columns', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
    const content = pdfText(buildLearnersPdf([learner], 'Coach Example', logo));
    vi.useRealTimers();

    for (const value of [
      'Coach Learners', 'Learner caseload export', 'GENERATED', '04 Oct 2026',
      'LEARNERS INCLUDED', 'PREPARED BY', 'Coach Example', 'Synthetic Learner',
      'OTJH', '70h / 80h', 'OTJH Progress', '88%',
      'Start date', '01 Jan 2026', 'Planned end date', '01 Feb 2027', 'Page 1 of 1',
    ]) expect(content).toContain(value);
    expect(content).not.toMatch(/\bRisk\b/);
    expect(content).not.toMatch(/\bKSB\b/);
    expect(content).not.toMatch(/\bComponents\b/);
    expect(content).not.toMatch(/\bGroup\b/);
    expect(content).not.toContain('Example Group');
    expect(content).not.toContain('01 Jan 2027');
    expect(content.indexOf('OTJH')).toBeLessThan(content.indexOf('OTJH Progress'));
    expect(content.indexOf('70h / 80h')).toBeLessThan(content.indexOf('88%'));
    expect(content).not.toContain('12%');
  });

  it('keeps every learner when the table continues onto later pages', () => {
    const learners = Array.from({ length: 46 }, (_, index) => ({
      ...learner,
      id: String(index + 1),
      name: `Synthetic Learner ${String(index + 1).padStart(2, '0')}`,
    }));
    const doc = buildLearnersPdf(learners, 'Coach Example', logo);
    const content = pdfText(doc);

    expect(doc.getNumberOfPages()).toBe(2);
    for (const item of learners) expect(content).toContain(item.name);
    expect(content).toContain('Coach learners continued');
    expect(content).toContain('Page 2 of 2');
  });

  it('excludes onboarding, entered EPA and withdrawn learners from the PDF', () => {
    const learners = [
      { ...learner, id: 'active', name: 'Included Learner', rawProgramStatus: 'Delivery' },
      { ...learner, id: 'onboarding', name: 'Onboarding Learner', rawProgramStatus: 'Onboarding Stage' },
      { ...learner, id: 'epa', name: 'EPA Learner', rawProgramStatus: 'Entered-EPA' },
      { ...learner, id: 'withdrawn', name: 'Withdrawn Learner', rawProgramStatus: 'Withdrawn' },
      { ...learner, id: 'fallback-withdrawn', name: 'Fallback Withdrawn', rawProgramStatus: '--', enrollmentStatus: 'withdrawn' as const },
    ];
    const content = pdfText(buildLearnersPdf(learners, 'Coach Example', logo));

    expect(content).toContain('Included Learner');
    expect(content).not.toContain('Onboarding Learner');
    expect(content).not.toContain('EPA Learner');
    expect(content).not.toContain('Withdrawn Learner');
    expect(content).not.toContain('Fallback Withdrawn');
    expect(content).toContain('LEARNERS INCLUDED PREPARED BY 1 Coach Example');
  });
});
