import type { LearnerDetail } from '@/api/learnerDetail';
import type { MonthlyAssignment } from '@/api/monthlyAssignment';
import type { ExtraActivity } from '@/api/extraActivities';
import { monthlyActivities, monthlyActivityText } from './monthlyActivities';

export const STANDARD_PRESENTATION_FORMAT = 'kbc-mcm-v2' as const;

/** Whole words continue onto another card/page; no extractive text limits. */
function pages(source: string, columns: number, rows: number): string[] {
  const lines: string[] = [];
  for (const paragraph of (source.trim() || 'Not recorded.').split(/\n+/)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      if (line && line.length + word.length + 1 > columns) { lines.push(line); line = ''; }
      // Long URLs/identifiers wrap in PowerPoint; account for every wrapped line.
      if (word.length > columns) {
        if (line) { lines.push(line); line = ''; }
        for (let i = 0; i < word.length; i += columns) lines.push(word.slice(i, i + columns));
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
  }
  return Array.from({ length: Math.ceil(lines.length / rows) }, (_, i) => lines.slice(i * rows, (i + 1) * rows).join('\n'));
}

/** All assignment and monthly activity text stays visible in the approved template. */
export function standardMonthlyPresentation(title: string, answer: string, learned: string, businessImpact: string,
  monthly: MonthlyAssignment, detail: LearnerDetail, question: string, extras: ExtraActivity[] = []): MonthlyAssignment['slides'] {
  const activities = monthlyActivities(detail, monthly.month, extras);
  const slides: MonthlyAssignment['slides'] = [];
  const section = (layout: number, heading: string, cards: [string, string][]) => {
    // Conservative line budgets for the existing template's smallest cards.
    const chunks = cards.map(([, text], i) => pages(text, layout === 1 ? 36 : layout === 3 ? 22 : layout === 5 ? 25 : layout === 7 ? 40 : 26,
      layout === 1 ? (i ? 3 : 2) : 12));
    const capacity = layout === 1 || layout === 7 ? 2 : 3;
    const first = cards.map(([label], i) => `${label}\n${chunks[i][0]}`);
    const overflow = cards.flatMap(([label], i) => chunks[i].slice(1).map(body => `${label}\n${body}`));
    // Once each original card has been shown, use all the available cards for
    // continuation text. A long answer must not leave two empty columns on
    // every following page or consume the presentation's entire slide budget.
    const content = [first];
    for (let i = 0; i < overflow.length; i += capacity) content.push(overflow.slice(i, i + capacity));
    for (const [page, bodies] of content.entries()) {
      slides.push({ title: heading + (page ? ` (continued ${page + 1})` : ''), templateSlide: layout,
        body: bodies.join('\n\n'),
        // Notes retain original formatting once, not repeated on every page.
        notes: page ? '' : cards.map(([label, text]) => `${label}\n${text || 'Not recorded.'}`).join('\n\n'),
      });
    }
  };
  const claims = (prefix: string) => monthly.claims.filter(c => c.code.toUpperCase().startsWith(prefix)).map(c =>
    `${c.code}: ${c.explanation || 'Explanation not recorded'}\nSupporting evidence: ${c.evidenceIds.map(id => monthly.evidence.find(e => e.id === id)?.name || id).join(', ') || 'Not linked'}`).join('\n');
  section(1, 'Learner Monthly Coaching Meeting', [['Review details', `Month: ${monthly.month}\nLearner: ${detail.name || 'Not recorded'}`], ['Assignment', title]]);
  section(2, 'What I learned this month', [['Topics & concepts', learned], ['My understanding', monthly.understood], ['Tools & skills', monthly.gainedSkills]]);
  section(3, 'Applying my learning at work', [['Task', question], ['My approach', answer], ['Outcome', businessImpact]]);
  section(4, 'KSBs I have demonstrated', [['Knowledge', claims('K')], ['Skills', claims('S')], ['Behaviours', claims('B')]]);
  section(5, 'Resources and evidence', [['Supporting evidence', monthly.evidence.map(e => `${e.name}${e.url ? `\n${e.url}` : ''}${e.points ? `\nAnswer points: ${e.points}` : ''}`).join('\n')],
    ['Monthly activities', activities.map(a => `${a.date} | ${a.title}`).join('\n') || 'No completed activities recorded for this month.'], ['How they helped', monthly.integratedReflection]]);
  section(6, 'My impact at work', [['Job performance', monthly.jobImpact], ['Employer value', [monthly.employerImpact, businessImpact].filter(Boolean).join('\n')], ['Career development', monthly.careerImpact]]);
  section(2, 'Additional learning', [['Extra activities', monthly.extraActivities], ['Learning in practice', activities.length ? `${activities.length} completed or submitted activities in ${monthly.month}. Full activity accounts follow.` : 'No completed activities recorded for this month.'], ['Skills to develop', monthly.epaPreparedness]]);
  for (let index = 0; index < activities.length; index += 3) {
    section(2, `Monthly activity details (${index / 3 + 1})`, activities.slice(index, index + 3).map((activity, offset) => [`Activity ${index + offset + 1}`, monthlyActivityText(activity)]));
  }
  section(7, 'Full-month reflection', [['Reflection', [monthly.lmsReflection, monthly.integratedReflection].filter(Boolean).join('\n')], ['Next month & EPA', [monthly.actionPlan, monthly.epaPreparedness].filter(Boolean).join('\n')]]);
  if (slides.length > 200) throw new Error('The full content needs more than 200 slides. Split it into separate presentations; no content has been removed.');
  return slides;
}

export function standardSlideIssue(slide: MonthlyAssignment['slides'][number]): string {
  if (slide.title.length > 100) return 'Keep the title within 100 characters.';
  if (slide.body.length > 12000) return 'Split this content across more slides (maximum 12,000 characters per section).';
  if ((slide.notes?.length || 0) > 2000000) return 'Split the speaker notes across more slides (maximum 2,000,000 characters per slide).';
  return '';
}
