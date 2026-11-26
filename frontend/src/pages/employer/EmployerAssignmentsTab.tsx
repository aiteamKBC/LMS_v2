import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import {
  fetchEmployerAssignmentFileUrl,
  fetchEmployerLearnerAssignments,
  type EmployerAssignment,
  type EmployerAssignmentFile,
} from '@/api/employerPortal';
import { useToast } from "@/hooks/useToast";
import { btnSecondary } from '@/pages/users/components/ui';
import styles from './EmployerLearnerPage.module.css';

// ============================================================================
// Assignments: everything this learner has handed in, and the files they
// uploaded with it. Current LMS submissions and legacy Aptem ones read alike.
// The employer sees where each stands, not the tutor's marks or feedback.
// ============================================================================

const STATUS: Record<string, { label: string; tone: string }> = {
  submitted_for_tutor_review: { label: 'Awaiting marking', tone: 'warning' },
  escalated: { label: 'Under review', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  partial: { label: 'Partially accepted', tone: 'neutral' },
  referred: { label: 'Referred', tone: 'danger' },
  rejected: { label: 'Not accepted', tone: 'danger' },
};

function statusChip(status: string) {
  const known = STATUS[status];
  if (known) return known;
  // Legacy Aptem statuses arrive as free text; show them as written.
  const label = status.replace(/[_-]+/g, ' ').trim();
  return { label: label ? label[0].toUpperCase() + label.slice(1) : 'Submitted', tone: 'neutral' };
}

function submittedDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function submittedLabel(value: string | null) {
  if (!value) return 'Date not recorded';
  const date = submittedDate(value);
  return date
    ? `Submitted ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' })}`
    : value;
}

const OTHER_MODULE = 'Other assignments';
const UNDATED_MONTH = 'Date not recorded';

interface MonthGroup { key: string; label: string; assignments: EmployerAssignment[] }
interface ModuleGroup { title: string; latest: number; count: number; months: MonthGroup[] }

/** The UK calendar month an assignment was handed in: a sortable key and its label. */
function submittedMonth(value: string | null) {
  const date = submittedDate(value);
  if (!date) return { key: '', label: UNDATED_MONTH };
  const parts = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', timeZone: 'Europe/London' }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return {
    key: `${part('year')}-${part('month')}`,
    label: date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' }),
  };
}

/**
 * Module by module, and within each module month by month. Modules and months
 * run newest first so the work being done now leads; anything without a date
 * closes its module, and work outside any module closes the list.
 */
function groupAssignments(assignments: EmployerAssignment[]): ModuleGroup[] {
  // Undated work sorts as the oldest.
  const time = (a: EmployerAssignment) => submittedDate(a.submittedAt)?.getTime() ?? 0;
  const modules = new Map<string, Map<string, MonthGroup>>();
  for (const assignment of [...assignments].sort((a, b) => time(b) - time(a))) {
    const title = assignment.moduleTitle.trim() || OTHER_MODULE;
    const month = submittedMonth(assignment.submittedAt);
    const months = modules.get(title) ?? new Map<string, MonthGroup>();
    modules.set(title, months);
    const group = months.get(month.key) ?? { ...month, assignments: [] };
    months.set(month.key, group);
    group.assignments.push(assignment);
  }
  return [...modules.entries()].map(([title, months]) => {
    const groups = [...months.values()].sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : b.key.localeCompare(a.key)));
    const all = groups.flatMap(group => group.assignments);
    return { title, latest: Math.max(...all.map(time)), count: all.length, months: groups };
  }).sort((a, b) => Number(a.title === OTHER_MODULE) - Number(b.title === OTHER_MODULE)
    || b.latest - a.latest || a.title.localeCompare(b.title));
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
      <div



        className="min-h-[18rem] py-6"
      >
        <LoadingSkeleton label="Loading assignments" variant="cards" />
      </div>
    );
  }

  const withFiles = assignments.filter((a) => a.files.length > 0).length;

  return (
    <section className={styles.assignments} aria-label="Assignments">
      <header className={styles.assignmentHeader}>
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
          No assignments assigned yet
        </p>
      ) : (
        <div className="divide-y divide-foreground-100">
          {groupAssignments(assignments).map((module) => (
            <section key={module.title} aria-label={module.title}>
              <h3 className={styles.assignmentModule}>
                <i className="ri-book-open-line text-primary-600" aria-hidden="true" />
                <span className="min-w-0 truncate" title={module.title}>{module.title}</span>
                <span className={styles.assignmentCount}>
                  {module.count} assignment{module.count === 1 ? '' : 's'}
                </span>
              </h3>
              {module.months.map((month) => (
                <section key={month.key || UNDATED_MONTH} aria-label={`${module.title}, ${month.label}`}>
                  <h4 className="border-t border-foreground-100 px-4 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-400">
                    {month.label}
                  </h4>
                  <ul className="divide-y divide-foreground-100">
                    {month.assignments.map((assignment) => (
                      <AssignmentRow key={assignment.id} assignment={assignment} opening={opening} onOpen={(file) => void openFile(file)} />
                    ))}
                  </ul>
                </section>
              ))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function AssignmentRow({ assignment, opening, onOpen }: {
  assignment: EmployerAssignment; opening: string | null; onOpen: (file: EmployerAssignmentFile) => void;
}) {
  const chip = statusChip(assignment.status);
  // The module heads its group; the row adds only where in it the work sits.
  const context = assignment.weekTitle;
  return (
    <li className={styles.assignmentRow}>
      <span className={styles.assignmentIdentity}>
        <i className="ri-file-upload-line mt-0.5 shrink-0 text-foreground-400" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-foreground-800" title={assignment.title}>{assignment.title}</span>
          {context && <span className="block truncate text-[12px] text-foreground-500" title={context}>{context}</span>}
          <span className="text-[11px] text-foreground-400">{submittedLabel(assignment.submittedAt)}</span>
        </span>
      </span>
      <span className="flex flex-wrap items-center justify-end gap-2">
        <span className={styles.assignmentStatus} data-tone={chip.tone}>{chip.label}</span>
        {assignment.files.length === 0 ? (
          <span className="text-[11px] italic text-foreground-400">No file uploaded</span>
        ) : assignment.files.map((file) => {
          const key = `${file.source}:${file.id}`;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onOpen(file)}
              disabled={opening === key}
              title={file.name}
              className={styles.assignmentFile}
            >
              {opening === key
                ? <LoaderCircle aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" />
                : <i className="ri-external-link-line" aria-hidden="true" />}
              <span className="truncate">{file.name}</span>
            </button>
          );
        })}
      </span>
    </li>
  );
}
