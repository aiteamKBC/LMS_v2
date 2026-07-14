import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/pages/users/components/ui';
import { type CaseFileTabProps } from '../data';

interface ContactRow {
  id: string;
  name: string;
  role: string;
  primary: string;
  secondary: string;
  tone: string;
  target: string;
}

export default function MessagesTab({ data }: CaseFileTabProps) {
  const navigate = useNavigate();
  const contacts = useMemo<ContactRow[]>(() => {
    const rows: ContactRow[] = [];

    rows.push({
      id: 'learner',
      name: data.displayName,
      role: 'Learner',
      primary: data.email || 'No learner email returned',
      secondary: data.detail?.phone || data.programme,
      tone: 'bg-accent-100 text-accent-700',
      target: data.email || data.displayName,
    });

    if (data.coachName || data.coachEmail) {
      rows.push({
        id: 'coach',
        name: data.coachName || 'Assigned coach',
        role: 'Coach',
        primary: data.coachEmail || 'No coach email returned',
        secondary: data.cohort ? `Cohort ${data.cohort}` : 'Coach record from caseload snapshot',
        tone: 'bg-primary-100 text-primary-700',
        target: data.coachEmail || data.coachName,
      });
    }

    if (data.employer) {
      rows.push({
        id: 'employer',
        name: data.employer,
        role: 'Employer',
        primary: data.employerEmail || 'No employer email returned',
        secondary: data.employerPhone || 'No employer phone returned',
        tone: 'bg-secondary-100 text-secondary-700',
        target: data.employerEmail || data.employer,
      });
    }

    return rows;
  }, [data]);

  const communicationRows = [
    { label: 'Last Contact', value: data.snapshot?.lastContact || '--', detail: 'Latest learner contact from the coach caseload snapshot.', icon: 'ri-chat-check-line' },
    { label: 'Last Coaching Session', value: data.snapshot?.lastCoachingSession || '--', detail: 'Most recent coaching touchpoint returned for this learner.', icon: 'ri-vidicon-line' },
    { label: 'Next Coaching', value: data.snapshot?.nextCoaching || '--', detail: 'Upcoming coaching date from the coach schedule.', icon: 'ri-calendar-schedule-line' },
    { label: 'Next Review', value: data.snapshot?.nextReview || '--', detail: 'Upcoming review date from the coach schedule.', icon: 'ri-file-chart-line' },
    { label: 'Last Evidence Submitted', value: data.snapshot?.lastSubmittedEvidence || '--', detail: 'Latest evidence date stored in the coach caseload snapshot.', icon: 'ri-folder-upload-line' },
  ].filter((row) => row.value && row.value !== '--');

  const handleOpenConversation = (target: string) => {
    if (!target) {
      return;
    }
    navigate('/messages', { state: { openContact: target } });
  };

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon="ri-contacts-book-2-line" label="Live Contacts" value={String(contacts.length)} tone="primary" />
        <StatCard icon="ri-chat-1-line" label="Last Contact" value={data.snapshot?.lastContact || '--'} tone="accent" />
        <StatCard icon="ri-calendar-schedule-line" label="Next Coaching" value={data.snapshot?.nextCoaching || '--'} tone="emerald" />
        <StatCard icon="ri-file-chart-line" label="Next Review" value={data.snapshot?.nextReview || '--'} tone="amber" />
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <i className="ri-mail-line text-primary-500"></i> Communication Contacts
            </h2>
            <span className="text-[11px] text-foreground-400">Live learner context only</span>
          </div>
          {contacts.length === 0 ? (
            <EmptyState text="No contact records were returned for this learner." />
          ) : (
            <div className="space-y-3">
              {contacts.map((contact) => (
                <div key={contact.id} className="rounded-xl border border-foreground-200/60 bg-background-100/50 p-4">
                  <div className="flex flex-col md:flex-row md:items-center gap-3">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${contact.tone}`}>
                      {initials(contact.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold text-foreground-900">{contact.name}</p>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-background-50 text-foreground-500 border border-background-200">
                          {contact.role}
                        </span>
                      </div>
                      <p className="text-[11px] text-foreground-500 mt-1">{contact.primary}</p>
                      <p className="text-[10px] text-foreground-400 mt-1">{contact.secondary}</p>
                    </div>
                    <button
                      onClick={() => handleOpenConversation(contact.target)}
                      className="px-3 py-2 rounded-full bg-primary-500 text-background-50 dark:text-foreground-950 text-[11px] font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                    >
                      <i className="ri-message-3-line text-xs"></i> Message
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <i className="ri-time-line text-accent-500"></i> Communication Snapshot
            </h2>
            <span className="text-[11px] text-foreground-400">{communicationRows.length} dated item(s)</span>
          </div>
          {communicationRows.length === 0 ? (
            <EmptyState text="No communication dates were returned for this learner yet." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {communicationRows.map((row) => (
                <DetailCard key={row.label} title={row.label} value={row.value} detail={row.detail} icon={row.icon} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6 text-[12px] text-foreground-600 space-y-2">
          <p>
            Historic message threads are not exposed by the current learner or coach APIs yet, so this tab now shows only real contacts and live communication dates.
          </p>
          <p>
            The message buttons route into the shared messaging workspace using the live learner, coach, or employer contact that was returned.
          </p>
        </div>
      </section>
    </div>
  );
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '--';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'primary' | 'accent' | 'emerald' | 'amber';
}) {
  const toneMap = {
    primary: 'bg-primary-100 text-primary-600',
    accent: 'bg-accent-100 text-accent-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
  } as const;

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${toneMap[tone]}`}>
        <i className={`${icon} text-base`}></i>
      </div>
      <p className="text-xl font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400">{label}</p>
    </div>
  );
}

function DetailCard({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: string;
}) {
  return (
    <div className="rounded-xl border border-background-200/70 bg-background-100/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-8 h-8 rounded-lg bg-background-50 border border-background-200 flex items-center justify-center">
          <i className={`${icon} text-sm text-foreground-600`}></i>
        </span>
        <p className="text-[12px] font-semibold text-foreground-900">{title}</p>
      </div>
      <p className="text-lg font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400 mt-1">{detail}</p>
    </div>
  );
}
