import { useEffect, useState } from 'react';
import {
  fetchEmployerAssignmentFileUrl,
  fetchEmployerLearnerAssignments,
  type EmployerAssignment,
  type EmployerAssignmentFile,
} from '@/api/employerPortal';
import { useToast } from '@/hooks/useToast';
import { btnSecondary } from '@/pages/users/components/ui';

// ============================================================================
// Assignments: everything this learner has handed in, and the files they
// uploaded with it. Current LMS submissions and legacy Aptem ones read alike.
// The employer sees where each stands, not the tutor's marks or feedback.
// ============================================================================

const STATUS: Record<string, { label: string; tone: string }> = {
  submitted_for_tutor_review: { label: 'Awaiting marking', tone: 'bg-amber-50 text-amber-800 border-amber-200/60' },
  escalated: { label: 'Under review', tone: 'bg-amber-50 text-amber-800 border-amber-200/60' },
  accepted: { label: 'Accepted', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200/60' },
  partial: { label: 'Partially accepted', tone: 'bg-sky-50 text-sky-800 border-sky-200/60' },
  referred: { label: 'Referred', tone: 'bg-red-50 text-red-700 border-red-200/60' },
  rejected: { label: 'Not accepted', tone: 'bg-red-50 text-red-700 border-red-200/60' },
};

function statusChip(status: string) {
  const known = STATUS[status];
  if (known) return known;
  // Legacy Aptem statuses arrive as free text; show them as written.
  const label = status.replace(/[_-]+/g, ' ').trim();
  return { label: label ? label[0].toUpperCase() + label.slice(1) : 'Submitted', tone: 'bg-background-100 text-foreground-600 border-foreground-200/60' };
}

function submittedLabel(value: string | null) {
  if (!value) return 'Date not recorded';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime())
    ? value
    : `Submitted ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' })}`;
}

export function EmployerAssignmentsTab({ employerId, kind, learnerId, learnerName }: {
  employerId: string; kind: string; learnerId: string; learnerName: string;
}) {
  const { error: toastError } = useToast();
  const [assignments, setAssignments] = useState<EmployerAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const load = () => {
    setError(null);
    setAssignments(null);
    fetchEmployerLearnerAssignments(employerId, kind, learnerId)
      .then((data) => setAssignments(data.assignments))
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, [employerId, kind, learnerId]);

  const openFile = async (file: EmployerAssignmentFile) => {
    const key = `${file.source}:${file.id}`;
    setOpening(key);
    try {
      const url = await fetchEmployerAssignmentFileUrl(employerId, kind, learnerId, file);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toastError('Could not open the file', e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setOpening(null);
    }
  };

  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="text-red-600 text-[13px] mb-3"><i className="ri-error-warning-line mr-1.5" />{error}</p>
        <button className={btnSecondary} onClick={load}><i className="ri-refresh-line" />Retry</button>
      </div>
    );
  }

  if (!assignments) {
    return (
      <p className="py-16 text-center text-[13px] text-foreground-400">
        <i className="ri-loader-4-line animate-spin mr-2" />Loading assignments…
      </p>
    );
  }

  const withFiles = assignments.filter((a) => a.files.length > 0).length;

  return (
    <section className="rounded-2xl border border-foreground-200/60 bg-background-50 card-premium" aria-label="Assignments">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-foreground-100 px-4 py-3">
        <div>
          <h2 className="text-[14px] font-heading font-semibold text-foreground-900">Submitted assignments</h2>
          <p className="text-[12px] text-foreground-500">
            {assignments.length} assignment{assignments.length === 1 ? '' : 's'} handed in by {learnerName}
            {assignments.length > 0 && ` · ${withFiles} with uploaded files`}
          </p>
        </div>
      </header>

      {assignments.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-foreground-400">
          No assignments have been handed in yet. They appear here once {learnerName} submits one.
        </p>
      ) : (
        <ul className="divide-y divide-foreground-100">
          {assignments.map((assignment) => {
            const chip = statusChip(assignment.status);
            const context = [assignment.moduleTitle, assignment.weekTitle].filter(Boolean).join(' · ');
            return (
              <li key={assignment.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <span className="flex min-w-0 items-start gap-2.5">
                  <i className="ri-file-upload-line mt-0.5 shrink-0 text-foreground-400" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-foreground-800" title={assignment.title}>{assignment.title}</span>
                    {context && <span className="block truncate text-[12px] text-foreground-500" title={context}>{context}</span>}
                    <span className="text-[11px] text-foreground-400">{submittedLabel(assignment.submittedAt)}</span>
                  </span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${chip.tone}`}>{chip.label}</span>
                  {assignment.files.length === 0 ? (
                    <span className="text-[11px] italic text-foreground-400">No file uploaded</span>
                  ) : assignment.files.map((file) => {
                    const key = `${file.source}:${file.id}`;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => void openFile(file)}
                        disabled={opening === key}
                        title={file.name}
                        className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-foreground-200 px-2.5 py-1 text-[12px] font-medium text-foreground-600 transition-smooth hover:border-primary-300 hover:bg-primary-50/60 hover:text-primary-700 cursor-pointer disabled:opacity-60"
                      >
                        <i className={opening === key ? 'ri-loader-4-line animate-spin' : 'ri-external-link-line'} aria-hidden="true" />
                        <span className="truncate">{file.name}</span>
                      </button>
                    );
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
