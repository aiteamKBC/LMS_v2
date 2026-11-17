import type { LiveSessionLearning } from '@/api/learnerDetail';
import { formatHoursMinutes } from '@/utils/learnerJourney';

const labels: Record<LiveSessionLearning['status'], string> = {
  completed: 'Completed',
  'reflection-required': 'Reflection required',
  'evidence-required': 'Evidence required',
  'submission-required': 'Submission required',
  'awaiting-review': 'Awaiting approval',
  'changes-required': 'Changes required',
};

export function LiveSessionLearningStatus({ learning }: { learning: LiveSessionLearning }) {
  return <div className="space-y-1 text-[11px]" aria-label="Lecture attendance and completion">
    <p className={`font-semibold ${learning.status === 'completed' ? 'text-emerald-700' : 'text-amber-800'}`}>{labels[learning.status]}</p>
    <p className="text-emerald-700">Attended</p>
    {learning.attendedSeconds != null && <p className="text-foreground-600">
      Attendance time: {formatHoursMinutes(learning.attendedSeconds / 3600)}
    </p>}
    {learning.requirementsStatus && learning.requirementsStatus !== 'completed'
      && <p className="text-foreground-600">Follow-up: {labels[learning.requirementsStatus]}</p>}
  </div>;
}
