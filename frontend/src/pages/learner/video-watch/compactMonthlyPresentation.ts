import type { LearnerDetail } from '@/api/learnerDetail';
import type { MonthlyAssignment } from '@/api/monthlyAssignment';

export const COMPACT_PRESENTATION_FORMAT = 'kbc-mcm-v1' as const;

/** Extractive highlights only. The complete source remains in editable speaker notes. */
export function presentationHighlights(source: string): string {
  const parts = source.split(/\n+|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const selected = [...new Set(parts)].slice(0, 4);
  const budget = Math.floor(340 / Math.max(1, selected.length));
  return selected.map(part => {
    if (part.length <= budget) return part;
    const excerpt = part.slice(0, budget - 1).replace(/\s+\S*$/, '');
    return `${excerpt || part.slice(0, budget - 1)}…`;
  }).join('\n') || 'Not recorded. Add your own account before review.';
}

export function compactMonthlyPresentation(title: string, answer: string, learned: string, businessImpact: string,
  monthly: MonthlyAssignment, detail: LearnerDetail, question: string): MonthlyAssignment['slides'] {
  const activities = (detail.activityFeed || []).filter(a => a.at.slice(0, 7) === monthly.month);
  const activityHighlights: string[] = [];
  const activityNotes = activities.map(a => {
    const records = a.kind === 'quiz' ? detail.quizAttempts || [] : a.kind === 'video' ? detail.videoProgress || [] : detail.componentProgress || [];
    const progress = records.find(p => p.submittedAt === a.at && (a.componentId ? p.componentId === a.componentId : a.kind === 'quiz' && 'quizId' in p && p.quizId === a.quizId));
    activityHighlights.push(`${a.title}: ${progress?.feedback || a.detail || a.action}`);
    return `${a.at.slice(0, 10)} | ${a.title}\nResult: ${a.detail || a.action}\nTime recorded: ${progress?.reportedTime || progress?.timeTaken || 'Not recorded'}\nKSBs: ${progress?.ksbs?.join(', ') || 'Not recorded'}\nLearning and impact: ${progress?.feedback || 'Not recorded'}`;
  }).join('\n\n');
  const join = (parts: [string, string][]) => parts.filter(([, value]) => value?.trim()).map(([label, value]) => `${label}: ${value}`).join('\n\n');
  const evidence = monthly.evidence.map(e => join([['Evidence', e.name], ['Link', e.url || ''], ['Answer points', e.points]])).join('\n\n');
  const claims = monthly.claims.map(c => `${c.code}: ${c.explanation || 'Explanation not recorded'}\nSupporting evidence: ${c.evidenceIds.map(id => monthly.evidence.find(e => e.id === id)?.name || id).join(', ') || 'Not linked'}`).join('\n\n');
  const section = (heading: string, source: string, fallback = 'Not recorded. Add your own account before review.') => ({
    title: heading, body: presentationHighlights(source || fallback), notes: source || fallback,
  });
  // Seventeen real slides, including the cover, regardless of activity volume.
  // These are highlights, not new claims about the learner's achievements.
  return [
    section('MCM Meeting', `Assignment: ${title}\nSubmission month: ${monthly.month}`),
    section('Your month at a glance', `${activities.length} recorded LMS activities in ${monthly.month}.\n${activities.slice(0, 3).map(a => `${a.at.slice(0, 10)} | ${a.title}`).join('\n')}`, 'No LMS activities recorded for this month.'),
    section('Assignment focus', question),
    section('My assignment answer', answer),
    section('What I learned', learned),
    section('What I understood', monthly.understood),
    section('Skills I gained', monthly.gainedSkills),
    { ...section('Learning in practice', activityNotes, 'No LMS activities recorded for this month.'), body: presentationHighlights(activityHighlights.join('\n') || 'No LMS activities recorded for this month.') },
    section('Evidence supporting my learning', evidence, 'No supporting evidence recorded.'),
    section('KSB development', claims, 'No KSB claims recorded.'),
    section('LMS learning reflection', monthly.lmsReflection),
    section('Extra activities', monthly.extraActivities, 'No extra activities recorded.'),
    section('How my learning fits together', monthly.integratedReflection),
    section('Career and job performance', join([['Career', monthly.careerImpact], ['Job performance', monthly.jobImpact]])),
    section('Employer and business impact', join([['Employer performance', monthly.employerImpact], ['Business outcomes', businessImpact]])),
    section('Next-month action plan', monthly.actionPlan),
    section('EPA preparation', monthly.epaPreparedness),
  ];
}

export function compactSlideIssue(slide: MonthlyAssignment['slides'][number]): string {
  if (slide.title.length > 80) return 'Keep the title within 80 characters for a readable slide.';
  if (slide.body.length > 600 || slide.body.split('\n').length > 6) return 'Keep the slide to 6 short lines and 600 characters. Move full detail to speaker notes or add a slide.';
  if ((slide.notes?.length || 0) > 2000000) return 'Split the speaker notes across additional slides (maximum 2,000,000 characters per slide).';
  return '';
}
