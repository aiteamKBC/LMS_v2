import { useEffect, useRef } from 'react';
import type { MyLearningCard, MyLearningModule } from '@/api/myLearning';
import type { Subject } from './learningSummary';
import { subjectPercent } from './subjectLearning';
import { buildModuleOverviewModel } from './moduleOverviewModel';
import { ModuleOverviewView, type OverviewStatus } from './ModuleOverviewView';

/**
 * The module's landing page in My Learning, shown before its learning materials.
 *
 * Informational only. Every value comes from the learner's own module read
 * (already authorised against their plan) or the catalogue card, and every
 * section renders only when it has real content. The primary action calls the
 * same `onStart` the subject card used to call, so the existing learning
 * experience opens exactly as before. The layout itself is the shared
 * ModuleOverviewView, which the Module Builder's live preview also renders.
 */
export function ModuleOverviewPage({ subject, card, module, loading, error, onRetry, onStart, onBack }: {
  subject: Subject;
  card?: MyLearningCard | null;
  module?: MyLearningModule | null;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onStart: () => void;
  onBack: () => void;
}) {
  // A read for a different module (the previous one, while this one loads) is
  // never shown here: it counts as still loading.
  const current = module && module.subjectId === subject.id ? module : null;
  const status: OverviewStatus = current ? 'ready' : error ? 'error' : 'loading';
  const model = buildModuleOverviewModel({ moduleId: subject.moduleId || undefined, title: subject.title, card, module: current });
  const heading = useRef<HTMLHeadingElement>(null);
  // Opened from a card further down the catalogue: move focus (and the view) to
  // the module so keyboard and screen-reader users land on what they opened.
  useEffect(() => { heading.current?.focus(); }, [subject.id]);
  const total = card?.activityCount ?? subject.activities.length;
  const done = card?.completedActivityCount ?? subject.activities.filter(item => item.completed).length;
  const percent = subjectPercent(subject);
  const started = done > 0 || percent > 0;

  return <div aria-busy={(loading && !current) || undefined}>
    <ModuleOverviewView
      model={model}
      coverUrl={card?.cover || undefined}
      progress={{ done, total, percent }}
      ctaLabel={started ? 'Continue learning' : 'Start learning'}
      onStart={onStart}
      onBack={onBack}
      headingRef={heading}
      status={status}
      error={error}
      onRetry={onRetry}
    />
  </div>;
}
