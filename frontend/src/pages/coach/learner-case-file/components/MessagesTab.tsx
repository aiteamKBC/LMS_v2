import { useMemo } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { MetricCard } from '@/components/ui/MetricCard';
import { Panel } from '@/components/ui/Panel';
import { LearnerAvatar } from '@/pages/coach/shared/LearnerIdentity';
import { type CaseFileTabProps } from '../data';

interface ContactRow {
  id: string;
  name: string;
  role: string;
  primary: string;
  secondary: string;
  target: string;
}

export default function MessagesTab({ data }: CaseFileTabProps) {
  const contacts = useMemo<ContactRow[]>(() => {
    const rows: ContactRow[] = [];

    rows.push({
      id: 'learner',
      name: data.displayName,
      role: 'Learner',
      primary: data.email || '--',
      secondary: data.detail?.phone || data.programme || '--',
      target: data.email || data.displayName,
    });

    if (data.coachName || data.coachEmail) {
      rows.push({
        id: 'coach',
        name: data.coachName || '--',
        role: 'Coach',
        primary: data.coachEmail || '--',
        secondary: data.cohort ? `Cohort ${data.cohort}` : '--',
        target: data.coachEmail || data.coachName,
      });
    }

    if (data.employer || data.employerEmail || data.employerPhone) {
      rows.push({
        id: 'employer',
        name: data.employer || '--',
        role: 'Employer',
        primary: data.employerEmail || '--',
        secondary: data.employerPhone || '--',
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

  const handleEmailContact = (contact: ContactRow) => {
    const target = contact.target;
    if (!target || !target.includes('@')) {
      return;
    }
    window.location.href = `mailto:${target}`;
  };

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard icon="ri-contacts-book-2-line" label="Live Contacts" value={contacts.length} tone="brand" />
        <MetricCard icon="ri-chat-1-line" label="Last Contact" value={data.snapshot?.lastContact || '--'} tone="upcoming" />
        <MetricCard icon="ri-calendar-schedule-line" label="Next Coaching" value={data.snapshot?.nextCoaching || '--'} tone="positive" />
        <MetricCard icon="ri-file-chart-line" label="Next Review" value={data.snapshot?.nextReview || '--'} tone="caution" />
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <AppIcon className="ri-mail-line text-primary-500"></AppIcon> Communication Contacts
            </h2>
            <span className="text-[12px] text-foreground-400">Live learner context only</span>
          </div>
          {contacts.length === 0 ? (
            <EmptyState
              variant="empty"
              size="sm"
              title="No contacts"
              description="No contact records were returned for this learner."
            />
          ) : (
            <div className="space-y-3">
              {contacts.map((contact) => (
                <div key={contact.id} className="rounded-xl border border-foreground-200/60 bg-background-100/50 p-4">
                  <div className="flex flex-col md:flex-row md:items-center gap-3">
                    <LearnerAvatar name={contact.name} size="lg" />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold text-foreground-900">{contact.name}</p>
                        <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-background-50 text-foreground-500 border border-background-200">
                          {contact.role}
                        </span>
                      </div>
                      <p className="text-[12px] text-foreground-500 mt-1">{contact.primary}</p>
                      <p className="text-[12px] text-foreground-400 mt-1">{contact.secondary}</p>
                    </div>
                    <button
                      onClick={() => handleEmailContact(contact)}
                      disabled={!contact.target.includes('@')}
                      className="px-3 py-2 rounded-full bg-primary-500 text-background-50 dark:text-foreground-950 text-[12px] font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                    >
                      <AppIcon className="ri-mail-line text-xs"></AppIcon> Email
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
              <AppIcon className="ri-time-line text-accent-500"></AppIcon> Communication Snapshot
            </h2>
            <span className="text-[12px] text-foreground-400">{communicationRows.length} dated item(s)</span>
          </div>
          {communicationRows.length === 0 ? (
            <EmptyState
              variant="empty"
              size="sm"
              title="No communication dates"
              description="No communication dates were returned for this learner yet."
            />
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
            Coach messaging is not available in this workspace, so this tab shows contact details and live communication dates only.
          </p>
          <p>
            Email actions use the live contact address returned for the learner, coach, or employer.
          </p>
        </div>
      </section>
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
    <Panel padding="md">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-8 h-8 rounded-lg bg-background-100 border border-foreground-200/60 flex items-center justify-center">
          <AppIcon className={`${icon} text-sm text-foreground-600`}></AppIcon>
        </span>
        <p className="text-[12px] font-semibold text-foreground-900">{title}</p>
      </div>
      <p className="text-lg font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[12px] text-foreground-400 mt-1">{detail}</p>
    </Panel>
  );
}
