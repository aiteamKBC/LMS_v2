import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { SkeletonBlock } from '@/components/feature/Skeletons';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { Panel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { coachViewAs } from '@/lib/coachViewAs';
import { cn } from '@/lib/cn';
import { formatSystemTimestamp, initialsFor } from '@/lib/format';
import { toneStyle, type StatusTone } from '@/lib/statusTone';
import { roleNavMap } from '@/mocks/navigation';
import {
  addSupportTicketNote,
  fetchCoachSupportTickets,
  updateSupportTicketStatus,
  type CoachSupportTicketsResponse,
  type SupportTicket,
  type SupportTicketLearner,
  type SupportTicketNote,
  type SupportTicketStatusOption,
} from '@/api/coachSupportTickets';
import { parseTicketDetails, type TicketFact, type TriggeredQuestion } from './ticketDetails';
import { WellbeingReport } from './WellbeingReport';

const coachNav = roleNavMap.coach;

type StatusFilter = 'open' | 'closed' | 'all';

const STATUS_TONE: Record<string, StatusTone> = {
  new: 'caution',
  'under review': 'info',
  assigned: 'info',
  'action in progress': 'info',
  'outcome recorded': 'upcoming',
  closed: 'positive',
};

const URGENCY_TONE: Record<string, StatusTone> = {
  low: 'neutral',
  medium: 'caution',
  high: 'critical',
  urgent: 'critical',
};

const RISK_TONE: Record<string, StatusTone> = {
  low: 'positive',
  medium: 'caution',
  high: 'critical',
  critical: 'critical',
};

const SEVERITY_TONE: Record<string, StatusTone> = {
  high: 'critical',
  medium: 'caution',
  low: 'neutral',
  pattern: 'info',
};

// Facts promoted to tiles; the rest are listed beneath them.
const HEADLINE_FACTS = ['risk level', 'total score', 'trigger count'];

const BUTTON_PRIMARY = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-50';
const FIELD = 'rounded-lg border border-foreground-200 bg-background-50 text-[13px] text-foreground-800 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:opacity-60';

function capitalise(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function formatWhen(value: string | null) {
  if (!value) return '--';
  return formatSystemTimestamp(value, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) || '--';
}

function formatDay(value: string | null) {
  if (!value) return '--';
  return formatSystemTimestamp(value, { day: 'numeric', month: 'short', year: 'numeric' }) || '--';
}

function matchesStatus(ticket: SupportTicket, filter: StatusFilter) {
  if (filter === 'all') return true;
  return filter === 'closed' ? ticket.status === 'closed' : ticket.status !== 'closed';
}

function replaceTicket(data: CoachSupportTicketsResponse | undefined, ticket: SupportTicket) {
  if (!data) return data;
  return {
    ...data,
    learners: data.learners.map(learner => {
      if (!learner.tickets.some(item => item.id === ticket.id)) return learner;
      const tickets = learner.tickets.map(item => (item.id === ticket.id ? ticket : item));
      return { ...learner, tickets, openTickets: tickets.filter(item => item.status !== 'closed').length };
    }),
  };
}

function SupportTicketsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]" role="status" aria-label="Loading support tickets" aria-busy="true">
      <span className="sr-only">Loading support tickets…</span>
      <div aria-hidden="true">
        <Panel className="space-y-3">
          {[0, 1, 2, 3].map(index => <SkeletonBlock key={index} className="h-14 w-full rounded-lg" />)}
        </Panel>
      </div>
      <div aria-hidden="true" className="space-y-4">
        <SkeletonBlock className="h-20 w-full rounded-xl" />
        <Panel className="space-y-3">
          <SkeletonBlock className="h-6 w-64 max-w-full" />
          <SkeletonBlock className="h-24 w-full" />
          <SkeletonBlock className="h-40 w-full" />
        </Panel>
      </div>
    </div>
  );
}

function SummaryTile({ icon, label, value, tone = 'brand' }: { icon: string; label: string; value: number; tone?: StatusTone }) {
  const style = toneStyle(tone);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-foreground-100/70 bg-background-50 px-4 py-3 shadow-sm">
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', style.bg, style.text)}>
        <AppIcon className={cn(icon, 'text-lg')} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-semibold leading-tight text-foreground-900">{value}</span>
        <span className="block truncate text-[12px] text-foreground-500">{label}</span>
      </span>
    </div>
  );
}

function SectionLabel({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <h4 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-500">
      <AppIcon className={cn(icon, 'text-[13px]')} aria-hidden="true" />
      {children}
    </h4>
  );
}

function FactTile({ fact }: { fact: TicketFact }) {
  const isRisk = fact.label.toLowerCase() === 'risk level';
  const tone = isRisk ? RISK_TONE[fact.value.toLowerCase()] : undefined;
  const style = tone ? toneStyle(tone) : null;
  return (
    <div className={cn('rounded-lg border px-3 py-2.5', style ? cn(style.bg, style.border) : 'border-foreground-100 bg-foreground-50/60')}>
      <dt className="text-[11px] font-medium text-foreground-500">{fact.label}</dt>
      <dd className={cn('mt-0.5 text-[16px] font-semibold leading-tight', style ? style.text : 'text-foreground-900')}>{fact.value}</dd>
    </div>
  );
}

function QuestionRow({ question }: { question: TriggeredQuestion }) {
  const tone = question.severity ? SEVERITY_TONE[question.severity] ?? 'neutral' : 'neutral';
  const style = toneStyle(tone);
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', style.dot)} aria-hidden="true" />
      <span className="min-w-0 flex-1 text-[13px] leading-snug text-foreground-800">{question.text}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {question.score ? (
          <span className="rounded-md bg-foreground-50 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-foreground-700">
            Score {question.score}
          </span>
        ) : null}
        {question.severity ? <StatusBadge tone={tone} label={capitalise(question.severity)} size="sm" dot={false} /> : null}
      </span>
    </li>
  );
}

function TicketDetails({ details }: { details: string }) {
  const parsed = useMemo(() => parseTicketDetails(details), [details]);
  if (!details.trim()) return <p className="text-[13px] text-foreground-500">No details provided.</p>;
  if (!parsed) {
    return <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground-700">{details}</p>;
  }

  const headline = parsed.facts.filter(fact => HEADLINE_FACTS.includes(fact.label.toLowerCase()));
  const secondary = parsed.facts.filter(fact => !HEADLINE_FACTS.includes(fact.label.toLowerCase()));
  return (
    <div className="space-y-4">
      {parsed.intro.length ? (
        <p className="flex items-start gap-1.5 text-[12px] text-foreground-500">
          <AppIcon className="ri-information-line mt-px text-[13px]" aria-hidden="true" />
          <span>{parsed.intro.join(' ')}</span>
        </p>
      ) : null}

      {headline.length ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {headline.map(fact => <FactTile key={fact.label} fact={fact} />)}
        </dl>
      ) : null}

      {secondary.length ? (
        <dl className="grid gap-x-6 gap-y-2 text-[12px] sm:grid-cols-2">
          {secondary.map(fact => (
            <div key={fact.label} className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-foreground-500">{fact.label}</dt>
              <dd className="min-w-0 break-words font-medium text-foreground-800">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {parsed.questions.length ? (
        <div>
          <SectionLabel icon="ri-questionnaire-line">Triggered questions ({parsed.questions.length})</SectionLabel>
          <ul className="divide-y divide-foreground-100 rounded-lg border border-foreground-100 px-3">
            {parsed.questions.map((question, index) => <QuestionRow key={index} question={question} />)}
          </ul>
        </div>
      ) : null}

      {parsed.other.length ? (
        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground-700">{parsed.other.join('\n')}</p>
      ) : null}
    </div>
  );
}

function TicketStatusControl({ ticket, statuses, onSave, saving }: {
  ticket: SupportTicket;
  statuses: SupportTicketStatusOption[];
  onSave: (status: string) => void;
  saving: boolean;
}) {
  const [value, setValue] = useState(ticket.status);
  if (!ticket.canChangeStatus) {
    return (
      <p className="flex items-start gap-1.5 rounded-lg bg-foreground-50 px-3 py-2 text-[12px] leading-snug text-foreground-600">
        <AppIcon className="ri-lock-line mt-px" aria-hidden="true" />
        {ticket.ticketType === 'safeguarding'
          ? 'Safeguarding status is managed by the DSL in the Inclusion system.'
          : 'Status cannot be changed from this view.'}
      </p>
    );
  }
  const selectId = `ticket-status-${ticket.id}`;
  return (
    <div className="space-y-2">
      <label htmlFor={selectId} className="block text-[11px] font-medium text-foreground-500">Status</label>
      <select
        id={selectId}
        className={cn(FIELD, 'w-full px-2.5 py-2')}
        value={value}
        onChange={event => setValue(event.target.value)}
        disabled={saving}
      >
        {statuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <button
        type="button"
        className={cn(BUTTON_PRIMARY, 'w-full')}
        onClick={() => onSave(value)}
        disabled={saving || value === ticket.status}
      >
        {saving ? 'Saving…' : 'Update status'}
      </button>
    </div>
  );
}

function TimelineEntry({ entry }: { entry: SupportTicketNote }) {
  const activity = entry.type === 'activity';
  return (
    <li className="relative pl-7">
      <span
        className={cn(
          'absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-background-50',
          activity ? 'bg-foreground-100 text-foreground-500' : 'bg-primary-100 text-primary-700',
        )}
        aria-hidden="true"
      >
        <AppIcon className={cn(activity ? 'ri-history-line' : 'ri-chat-3-line', 'text-[11px]')} />
      </span>
      <div className={cn(activity ? 'py-0.5' : 'rounded-lg bg-primary-50/60 px-3 py-2')}>
        <p className={cn('whitespace-pre-wrap break-words text-[13px]', activity ? 'text-foreground-600' : 'text-foreground-800')}>{entry.note}</p>
        <p className="mt-0.5 text-[11px] text-foreground-500">
          {entry.createdBy || 'Inclusion team'} · {formatWhen(entry.createdAt)}
        </p>
      </div>
    </li>
  );
}

function TicketCard({ ticket, statuses }: { ticket: SupportTicket; statuses: SupportTicketStatusOption[] }) {
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const queryKey = ['coach-support-tickets', auth.account?.id, coachViewAs()?.email];
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [statusKey, setStatusKey] = useState(0);

  const applyTicket = (updated: SupportTicket) => {
    queryClient.setQueryData<CoachSupportTicketsResponse | undefined>(queryKey, data => replaceTicket(data, updated));
  };

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateSupportTicketStatus(ticket.id, status, ticket.status),
    onMutate: () => setError(''),
    onSuccess: applyTicket,
    onError: (err: Error) => {
      setError(err.message);
      // Reset the select to the saved status; a conflict also refetches so the
      // coach sees the status somebody else set.
      setStatusKey(key => key + 1);
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const noteMutation = useMutation({
    mutationFn: (text: string) => addSupportTicketNote(ticket.id, text),
    onMutate: () => setError(''),
    onSuccess: updated => {
      applyTicket(updated);
      setNote('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const safeguarding = ticket.ticketType === 'safeguarding';
  const typeTone: StatusTone = safeguarding ? 'critical' : 'brand';
  const typeStyle = toneStyle(typeTone);
  const noteId = `ticket-note-${ticket.id}`;

  return (
    <article className="overflow-hidden rounded-xl border border-foreground-100/70 bg-background-50 shadow-sm" aria-labelledby={`ticket-title-${ticket.id}`}>
      <header className={cn('flex flex-col gap-3 border-b border-foreground-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between', typeStyle.bg)}>
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background-50 shadow-sm', typeStyle.text)}>
            <AppIcon className={cn(safeguarding ? 'ri-shield-line' : 'ri-heart-pulse-line', 'text-lg')} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 id={`ticket-title-${ticket.id}`} className="break-words text-[15px] font-semibold leading-snug text-foreground-900">
              {ticket.subject || 'Support ticket'}
            </h3>
            <p className="mt-0.5 text-[12px] text-foreground-500">
              Ticket #{ticket.id} · Raised {formatWhen(ticket.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 sm:justify-end">
          <StatusBadge tone={typeTone} label={capitalise(ticket.ticketType)} />
          {ticket.urgency ? <StatusBadge tone={URGENCY_TONE[ticket.urgency] ?? 'neutral'} label={`${capitalise(ticket.urgency)} urgency`} /> : null}
          <StatusBadge tone={STATUS_TONE[ticket.status] ?? 'neutral'} label={ticket.statusLabel || '--'} />
        </div>
      </header>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-6 px-5 py-5">
          <section>
            <SectionLabel icon="ri-file-chart-line">Wellbeing report</SectionLabel>
            <WellbeingReport
              ticketId={ticket.id}
              originalText={ticket.details}
              fallback={<TicketDetails details={ticket.details} />}
            />
          </section>

          <section>
            <SectionLabel icon="ri-chat-history-line">Notes &amp; activity</SectionLabel>
            {ticket.canAddNote ? (
              <form
                className="mb-4 rounded-lg border border-foreground-100 bg-foreground-50/40 p-3"
                onSubmit={event => {
                  event.preventDefault();
                  const text = note.trim();
                  if (text) noteMutation.mutate(text);
                }}
              >
                <label htmlFor={noteId} className="sr-only">Add a note to ticket {ticket.id}</label>
                <textarea
                  id={noteId}
                  rows={3}
                  maxLength={4000}
                  value={note}
                  onChange={event => setNote(event.target.value)}
                  placeholder="Add a note for the Inclusion team…"
                  className={cn(FIELD, 'block w-full resize-y px-3 py-2')}
                  disabled={noteMutation.isPending}
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-[11px] text-foreground-400">{note.length ? `${note.length}/4000` : 'Visible to the Inclusion team'}</span>
                  <button type="submit" className={BUTTON_PRIMARY} disabled={noteMutation.isPending || !note.trim()}>
                    <AppIcon className="ri-send-plane-line" aria-hidden="true" />
                    {noteMutation.isPending ? 'Adding…' : 'Add note'}
                  </button>
                </div>
              </form>
            ) : null}
            {error ? (
              <p role="alert" className={cn('mb-3 flex items-start gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium', toneStyle('critical').bg, toneStyle('critical').border, toneStyle('critical').text)}>
                <AppIcon className="ri-error-warning-line mt-px" aria-hidden="true" />
                {error}
              </p>
            ) : null}
            {ticket.notes.length ? (
              <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-2.5 before:top-2 before:w-px before:bg-foreground-100">
                {ticket.notes.map((entry, index) => <TimelineEntry key={entry.id || index} entry={entry} />)}
              </ol>
            ) : (
              <p className="rounded-lg border border-dashed border-foreground-200 px-3 py-4 text-center text-[12px] text-foreground-500">
                No notes or activity yet.
              </p>
            )}
          </section>
        </div>

        <aside className="space-y-5 border-t border-foreground-100 bg-foreground-50/40 px-5 py-5 xl:border-l xl:border-t-0" aria-label={`Ticket ${ticket.id} summary`}>
          <dl className="space-y-3 text-[12px]">
            {[
              { label: 'Assigned owner', value: ticket.assignedOwner || 'Unassigned', icon: 'ri-user-star-line' },
              { label: 'Preferred contact', value: capitalise(ticket.preferredContact) || '--', icon: ticket.preferredContact === 'phone' ? 'ri-phone-line' : 'ri-mail-line' },
              { label: 'Last updated', value: formatWhen(ticket.updatedAt), icon: 'ri-time-line' },
              { label: 'Days to close', value: ticket.daysToClose == null ? (ticket.status === 'closed' ? '--' : 'Still open') : String(ticket.daysToClose), icon: 'ri-timer-line' },
            ].map(item => (
              <div key={item.label} className="flex items-start gap-2.5">
                <AppIcon className={cn(item.icon, 'mt-0.5 text-[14px] text-foreground-400')} aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="text-[11px] text-foreground-500">{item.label}</dt>
                  <dd className="break-words font-medium text-foreground-800">{item.value}</dd>
                </div>
              </div>
            ))}
          </dl>

          <TicketStatusControl
            key={`${ticket.status}-${statusKey}`}
            ticket={ticket}
            statuses={statuses}
            saving={statusMutation.isPending}
            onSave={status => statusMutation.mutate(status)}
          />

          {ticket.evidence.length ? (
            <div>
              <SectionLabel icon="ri-attachment-2">Evidence ({ticket.evidence.length})</SectionLabel>
              <ul className="space-y-1.5">
                {ticket.evidence.map((file, index) => (
                  <li key={file.id || index}>
                    {file.url ? (
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-foreground-100 bg-background-50 px-2.5 py-2 text-[12px] font-medium text-primary-700 transition hover:border-primary-200 hover:bg-primary-50"
                      >
                        <AppIcon className="ri-file-line shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{file.fileName}</span>
                        <AppIcon className="ri-external-link-line shrink-0 text-foreground-400" aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="flex items-center gap-2 rounded-lg border border-foreground-100 bg-background-50 px-2.5 py-2 text-[12px] text-foreground-700">
                        <AppIcon className="ri-file-line shrink-0" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{file.fileName}</span>
                      </span>
                    )}
                    {file.description ? <p className="mt-0.5 px-1 text-[11px] text-foreground-500">{file.description}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </article>
  );
}

function LearnerList({ learners, selectedId, onSelect }: {
  learners: SupportTicketLearner[];
  selectedId: number | undefined;
  onSelect: (learnerId: number) => void;
}) {
  return (
    <ul className="space-y-1" aria-label="Learners with support tickets">
      {learners.map(learner => {
        const active = learner.learnerId === selectedId;
        const hasSafeguarding = learner.tickets.some(ticket => ticket.ticketType === 'safeguarding' && ticket.status !== 'closed');
        return (
          <li key={learner.learnerId}>
            <button
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(learner.learnerId)}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
                active ? 'bg-primary-50 ring-1 ring-primary-200' : 'hover:bg-foreground-50',
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[12px] font-semibold text-primary-700">
                {initialsFor(learner.name)}
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block break-words text-[13px] leading-snug text-foreground-900">{learner.name}</strong>
                {learner.programme ? <small className="block truncate text-[11px] text-foreground-500">{learner.programme}</small> : null}
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {learner.openTickets
                    ? <StatusBadge tone="caution" label={`${learner.openTickets} open`} size="sm" />
                    : <StatusBadge tone="positive" label="All closed" size="sm" />}
                  {hasSafeguarding ? <StatusBadge tone="critical" label="Safeguarding" size="sm" /> : null}
                  <span className="px-1 py-0.5 text-[11px] text-foreground-500">{learner.tickets.length} total</span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function CoachSupportTicketsPage() {
  const { auth } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [selectedId, setSelectedId] = useState<number>();

  const query = useQuery({
    queryKey: ['coach-support-tickets', auth.account?.id, coachViewAs()?.email],
    queryFn: ({ signal }) => fetchCoachSupportTickets(signal),
  });

  const learners = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data?.learners ?? [])
      .filter(learner => learner.tickets.some(ticket => matchesStatus(ticket, statusFilter)))
      .filter(learner => !term || learner.name.toLowerCase().includes(term) || learner.email.includes(term));
  }, [query.data, search, statusFilter]);

  const selected = learners.find(learner => learner.learnerId === selectedId) ?? learners[0];
  const visibleTickets = selected?.tickets.filter(ticket => matchesStatus(ticket, statusFilter)) ?? [];
  const allTickets = (query.data?.learners ?? []).flatMap(learner => learner.tickets);
  const totalOpen = allTickets.filter(ticket => ticket.status !== 'closed').length;
  const safeguardingOpen = allTickets.filter(ticket => ticket.ticketType === 'safeguarding' && ticket.status !== 'closed').length;

  return (
    <WorkspaceShell
      role="coach"
      roleLabel={coachNav.label}
      navItems={coachNav.items}
      workspaceLabel={coachNav.workspaceLabel}
      pageTitle="Support Tickets"
      pageSubtitle="Wellbeing and safeguarding tickets for your learners"
    >
      <PageContainer className="space-y-4">
        <PageHeader
          title="Support Tickets"
          description="Inclusion tickets raised for learners on your caseload."
          icon="ri-lifebuoy-line"
        />

        {query.data ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryTile icon="ri-group-line" label="Learners with tickets" value={query.data.learners.length} />
            <SummaryTile icon="ri-inbox-unarchive-line" label="Open tickets" value={totalOpen} tone={totalOpen ? 'caution' : 'positive'} />
            <SummaryTile icon="ri-shield-line" label="Open safeguarding" value={safeguardingOpen} tone={safeguardingOpen ? 'critical' : 'neutral'} />
          </div>
        ) : null}

        {query.data?.readOnly ? (
          <p className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium', toneStyle('info').bg, toneStyle('info').border, toneStyle('info').text)}>
            <AppIcon className="ri-eye-line" aria-hidden="true" />
            Read-only view: you are viewing this coach&apos;s tickets, so status changes and notes are turned off.
          </p>
        ) : null}

        {query.isPending ? <SupportTicketsSkeleton /> : query.error ? (
          <EmptyState
            variant="error"
            title="Unable to load support tickets"
            description={query.error.message}
            action={<button type="button" className="rounded-lg border border-foreground-200 px-3 py-1.5 text-[12px] font-semibold" onClick={() => void query.refetch()}>Try again</button>}
          />
        ) : !query.data.learners.length ? (
          <EmptyState title="No support tickets" description="None of the learners on your caseload have an Inclusion support ticket." />
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Panel className="space-y-3 lg:sticky lg:top-4">
              <label className="relative block">
                <span className="sr-only">Search learners</span>
                <AppIcon className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search learners..."
                  className={cn(FIELD, 'w-full py-2 pl-9 pr-3')}
                />
              </label>
              <div className="flex gap-1 rounded-lg bg-foreground-50 p-1" role="group" aria-label="Filter tickets by status">
                {(['open', 'closed', 'all'] as const).map(option => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={statusFilter === option}
                    onClick={() => setStatusFilter(option)}
                    className={cn(
                      'flex-1 rounded-md px-2 py-1.5 text-[12px] font-semibold capitalize transition',
                      statusFilter === option ? 'bg-background-50 text-primary-700 shadow-sm' : 'text-foreground-500 hover:text-foreground-800',
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
              {learners.length
                ? <LearnerList learners={learners} selectedId={selected?.learnerId} onSelect={setSelectedId} />
                : <EmptyState variant="no-matches" title="No learners match" description="Try a different search or status filter." />}
            </Panel>

            <section className="min-w-0 space-y-4" aria-label={selected ? `${selected.name} support tickets` : 'Support tickets'}>
              {selected ? (
                <>
                  <div className="flex flex-col gap-3 rounded-xl border border-foreground-100/70 bg-background-50 px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[14px] font-semibold text-primary-700">
                        {initialsFor(selected.name)}
                      </span>
                      <div className="min-w-0">
                        <h2 className="break-words text-lg font-semibold leading-tight text-foreground-900">{selected.name}</h2>
                        <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-foreground-500">
                          <AppIcon className="ri-mail-line" aria-hidden="true" />
                          {selected.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[selected.programme, selected.cohort, selected.group].filter(Boolean).map(value => (
                        <span key={value} className="rounded-md bg-foreground-50 px-2 py-1 text-[11px] font-medium text-foreground-600">{value}</span>
                      ))}
                    </div>
                  </div>
                  {visibleTickets.map(ticket => (
                    <TicketCard key={ticket.id} ticket={ticket} statuses={query.data.statuses} />
                  ))}
                  <p className="text-center text-[11px] text-foreground-400">
                    Showing {visibleTickets.length} of {selected.tickets.length} ticket{selected.tickets.length === 1 ? '' : 's'} · first raised {formatDay(selected.tickets[selected.tickets.length - 1]?.createdAt ?? null)}
                  </p>
                </>
              ) : null}
            </section>
          </div>
        )}
      </PageContainer>
    </WorkspaceShell>
  );
}
