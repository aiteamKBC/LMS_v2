import type { LearnerDetail } from '@/api/learnerDetail';
import type { MonthlyAssignment } from '@/api/monthlyAssignment';
import type { ExtraActivity } from '@/api/extraActivities';
import { monthlyActivities, monthlyActivityText } from './monthlyActivities';

export const STANDARD_PRESENTATION_FORMAT = 'kbc-mcm-v2' as const;

/** Extract a readable opening excerpt; the complete source is kept in notes. */
function highlight(source: string, columns: number, rows: number): string {
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
  const visible = lines.slice(0, rows);
  if (lines.length > rows) {
    const last = visible[rows - 1];
    visible[rows - 1] = `${last.slice(0, columns - 1).replace(/\s+\S*$/, '') || last.slice(0, columns - 1)}\u2026`;
  }
  return visible.join('\n');
}

/** Eight review slides in the approved template, with full accounts in notes. */
export function standardMonthlyPresentation(title: string, answer: string, learned: string, businessImpact: string,
  monthly: MonthlyAssignment, detail: LearnerDetail, question: string, extras: ExtraActivity[] = []): MonthlyAssignment['slides'] {
  const activities = monthlyActivities(detail, monthly.month, extras);
  const slides: MonthlyAssignment['slides'] = [];
  const section = (layout: number, heading: string, cards: [string, string, string?][]) => {
    // Leave enough room that the PPTX renderer does not add continuation slides.
    const columns = layout === 1 ? 32 : layout === 3 ? 20 : layout === 5 ? 23 : layout === 7 ? 36 : 24;
    slides.push({ title: heading, templateSlide: layout,
      body: cards.map(([label, text], i) => `${label}\n${highlight(text, columns, layout === 1 ? (i ? 3 : 2) : 7)}`).join('\n\n'),
      notes: cards.map(([label, text, fullDetail]) => `${label}\n${fullDetail ?? (text || 'Not recorded.')}`).join('\n\n'),
    });
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
  section(2, 'Additional learning', [['Extra activities', monthly.extraActivities], ['Learning in practice', activities.length
    ? `${activities.length} completed or submitted activities in ${monthly.month}. Full activity accounts are in speaker notes.`
    : 'No completed activities recorded for this month.',
  activities.length ? activities.map(monthlyActivityText).join('\n\n') : 'No completed activities recorded for this month.'], ['Skills to develop', monthly.epaPreparedness]]);
  section(7, 'Full-month reflection', [['Reflection', [monthly.lmsReflection, monthly.integratedReflection].filter(Boolean).join('\n')], ['Next month & EPA', [monthly.actionPlan, monthly.epaPreparedness].filter(Boolean).join('\n')]]);
  if (slides.reduce((total, slide) => total + (slide.notes?.length || 0), 0) > 2000000) {
    throw new Error('The full detail exceeds the PowerPoint speaker-notes limit. Your answers and existing slides are unchanged. Upload your own MCM PowerPoint instead.');
  }
  return slides;
}

export function standardSlideIssue(slide: MonthlyAssignment['slides'][number]): string {
  if (slide.title.length > 100) return 'Keep the title within 100 characters.';
  if (slide.body.length > 12000) return 'Split this content across more slides (maximum 12,000 characters per section).';
  if ((slide.notes?.length || 0) > 2000000) return 'Split the speaker notes across more slides (maximum 2,000,000 characters per slide).';
  return '';
}
