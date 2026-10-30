import type { LearnerDetail } from '@/api/learnerDetail';
import type { MonthlyAssignment } from '@/api/monthlyAssignment';
import { compactMonthlyPresentation } from './compactMonthlyPresentation';

export const STANDARD_PRESENTATION_FORMAT = 'kbc-mcm-v2' as const;

function highlights(source: string, budget = 220): string {
  const parts = [...new Set(source.split(/\n+|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean))].slice(0, 3);
  const limit = Math.floor(budget / Math.max(1, parts.length));
  return parts.map(part => part.length <= limit ? part : `${part.slice(0, limit - 1).replace(/\s+\S*$/, '') || part.slice(0, limit - 1)}…`).join('\n') || 'Not recorded.';
}

/** Eight normally, nine/ten with more material, twelve only for a large month. */
export function standardMonthlyPresentation(title: string, answer: string, learned: string, businessImpact: string,
  monthly: MonthlyAssignment, detail: LearnerDetail, question: string): MonthlyAssignment['slides'] {
  const original = compactMonthlyPresentation(title, answer, learned, businessImpact, monthly, detail, question);
  const source = (index: number) => original[index].notes || original[index].body;
  const notes = (...indices: number[]) => indices.map(i => `${original[i].title}\n${source(i)}`).join('\n\n');
  const card = (heading: string, text: string, budget = 220) => `${heading}\n${highlights(text, budget)}`;
  const slide = (templateSlide: number, heading: string, cards: string[], fullNotes: string) => ({ title: heading, templateSlide, body: cards.join('\n\n'), notes: fullNotes });
  const claimText = (prefix: string) => monthly.claims.filter(c => c.code.toUpperCase().startsWith(prefix)).map(c => `${c.code}: ${c.explanation || 'Explanation not recorded'}`).join('\n');
  const activities = (detail.activityFeed || []).filter(a => a.at.slice(0, 7) === monthly.month);
  const slides = [
    slide(1, 'Learner Monthly Coaching Meeting', [card('Review details', `Month: ${monthly.month}\nLearner: ${detail.name || 'Not recorded'}`, 100), card('Highlights', learned, 120)], notes(0)),
    slide(2, 'What I learned this month', [card('Topics & concepts', learned), card('My understanding', monthly.understood), card('Tools & skills', monthly.gainedSkills)], notes(4, 5, 6)),
    slide(3, 'Applying my learning at work', [card('Task', question, 180), card('My approach', answer, 180), card('Outcome', businessImpact)], notes(2, 3)),
    slide(4, 'KSBs I have demonstrated', [card('Knowledge', claimText('K')), card('Skills', claimText('S')), card('Behaviours', claimText('B'))], notes(9)),
    slide(5, 'Resources and evidence', [card('Supporting evidence', source(8)), card('LMS activities', activities.map(a => `${a.at.slice(0, 10)} | ${a.title}`).join('\n')), card('How they helped', monthly.integratedReflection)], notes(8, 1)),
    slide(6, 'My impact at work', [card('Job performance', monthly.jobImpact), card('Employer value', [monthly.employerImpact, businessImpact].filter(Boolean).join('\n')), card('Career development', monthly.careerImpact)], notes(13, 14)),
    slide(2, 'Additional learning', [card('Extra activities', monthly.extraActivities), card('Learning in practice', original[7].body), card('Skills to develop', monthly.epaPreparedness)], notes(7, 11)),
  ];
  const volume = original.reduce((sum, s) => sum + (s.notes || s.body).length, 0);
  const large = volume > 24000 || activities.length > 30 || monthly.claims.length > 12 || monthly.evidence.length > 12;
  const count = large ? 12 : volume > 7000 || activities.length > 10 || monthly.claims.length > 6 || monthly.evidence.length > 5 ? 10 : volume > 3000 || activities.length > 4 || monthly.claims.length > 3 || monthly.evidence.length > 3 ? 9 : 8;
  const extraSources = [
    ['Learning activity highlights', activities.slice(3).map(a => `${a.at.slice(0, 10)} | ${a.title}`).join('\n') || source(3)],
    ['Further evidence and KSBs', monthly.evidence.slice(3).map(e => `${e.name}\n${e.points}`).join('\n') || source(9)],
    ['More from my assignment', answer.split(/\n+|(?<=[.!?])\s+/).slice(3).join('\n') || source(12)],
    ['Further reflection', monthly.integratedReflection || monthly.lmsReflection],
  ];
  for (const [heading, text] of extraSources.slice(0, count - 8)) {
    const parts = text.split(/\n+|(?<=[.!?])\s+/).filter(Boolean);
    const group = Math.max(1, Math.ceil(parts.length / 3));
    const cards = [0, 1, 2].map(i => card(`Highlights ${i + 1}`, parts.slice(i * group, (i + 1) * group).join('\n')));
    // Full originals already live in the core slides' notes; avoid duplicating
    // a large activity history on every supplementary slide.
    slides.push(slide(2, heading, cards, cards.join('\n\n')));
  }
  slides.push(slide(7, 'Reflection and next steps', [card('Reflection', [monthly.lmsReflection, monthly.integratedReflection].filter(Boolean).join('\n'), 350), card('Next month & EPA', [monthly.actionPlan, monthly.epaPreparedness].filter(Boolean).join('\n'), 350)], notes(10, 12, 15, 16)));
  return slides.map((s, i) => ({ ...s, title: i ? `${i}. ${s.title}` : s.title }));
}

export function standardSlideIssue(slide: MonthlyAssignment['slides'][number]): string {
  if (slide.title.length > 100) return 'Keep the title within 100 characters.';
  if (slide.body.length > 1800) return 'Keep the visible highlights within 1,800 characters. Put full detail in speaker notes or add a slide.';
  if ((slide.notes?.length || 0) > 2000000) return 'Split the speaker notes across more slides (maximum 2,000,000 characters per slide).';
  return '';
}
