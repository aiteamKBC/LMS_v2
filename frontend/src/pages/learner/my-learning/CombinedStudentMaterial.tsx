import { useState } from 'react';
import type { SubjectAttemptResult } from '@/api/studentActivity';
import type { SubjectEntry } from './learningSummary';
import { DeferredStudentMaterial as StudentMaterial } from './DeferredStudentMaterial';

export function CombinedStudentMaterial({ entry, kind, learnerId, readOnly, onProgress }: {
  entry: SubjectEntry; kind: string; learnerId: string; readOnly: boolean;
  onProgress?: (result: SubjectAttemptResult, activityId?: string) => void;
}) {
  const quiz = entry.pairedQuiz!;
  const [saved, setSaved] = useState({ reading: false, quiz: false });
  const readingDone = !!entry.readingCompleted || saved.reading;
  const quizDone = quiz.completed || saved.quiz;
  const [selected, setSelected] = useState<'reading' | 'quiz'>(readingDone ? 'quiz' : 'reading');
  const active = selected === 'reading' && !readingDone ? 'reading'
    : selected === 'quiz' && !quizDone ? 'quiz' : !readingDone ? 'reading' : !quizDone ? 'quiz' : null;
  const record = (part: 'reading' | 'quiz', activityId: string, result: SubjectAttemptResult) => {
    setSaved(previous => ({ ...previous, [part]: previous[part] || result.completed }));
    onProgress?.(result, activityId);
  };
  return <div className="space-y-5">
    <p className="text-sm text-foreground-600">Complete each unfinished part below. Study time counts only for the selected part.</p>
    {(['reading', 'quiz'] as const).map(part => {
      const done = part === 'reading' ? readingDone : quizDone;
      const item = part === 'reading' ? entry : quiz;
      const label = part === 'reading' ? 'Reading' : 'Quiz';
      return <section key={part} aria-label={`${label} part`} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-bold">{label} · {done ? 'Complete' : 'Not complete'}</h4>
          {!readOnly && !done && (active === part
            ? <span role="status" className="rounded-lg bg-primary-50 px-4 py-2 text-sm font-semibold text-primary-800">{label} selected</span>
            : <button type="button" className="rounded-lg border border-primary-300 px-4 py-2 text-sm font-semibold text-primary-800"
              onClick={() => setSelected(part)}>Switch to {part}</button>)}
        </div>
        <StudentMaterial kind={kind} learnerId={learnerId} groupId={item.legacy!.group_id}
          activityId={item.legacy!.source_activity_id} completed={done} readOnly={readOnly}
          readingOnly={part === 'reading'} catalogueQuiz={part === 'quiz'} reviewQuiz={part === 'quiz' && done}
          active={active === part} allowCompletionDate
          onProgress={result => record(part, item.id, result)} />
      </section>;
    })}
  </div>;
}
