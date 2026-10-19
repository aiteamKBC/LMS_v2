import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { coachLmsAttachmentUrl, loadCoachLmsTickets, replyToCoachLmsTicket, type CoachLmsTicketsResponse } from '@/api/coachLmsSupportTickets';
import { ticketDate } from '@/api/supportTickets';
import TicketAttachments from '@/components/support/TicketAttachments';
import { EmptyState } from '@/components/ui/EmptyState';
import { Panel } from '@/components/ui/Panel';
import { cn } from '@/lib/cn';

const FIELD = 'rounded-lg border border-foreground-200 bg-background-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300';
type Draft = { body: string; requestId: string };

export function LmsTickets({ accountId, coachEmail, active }: { accountId?: number; coachEmail?: string; active: boolean }) {
  const client = useQueryClient();
  const queryKey = ['coach-lms-support-tickets', accountId, coachEmail];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => loadCoachLmsTickets(signal), enabled: active });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [replyError, setReplyError] = useState<{ id: string; message: string }>();
  const reply = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: Draft }) => replyToCoachLmsTicket(id, draft.body.trim(), draft.requestId),
    onSuccess: (saved) => {
      client.setQueryData<CoachLmsTicketsResponse>(queryKey, old => old && ({ ...old, tickets: old.tickets.map(ticket => ticket.id === saved.id ? saved : ticket) }));
      setDrafts(old => ({ ...old, [saved.id]: { body: '', requestId: '' } }));
      setReplyError(undefined);
      void client.invalidateQueries({ queryKey });
    },
    onError: (error, variables) => setReplyError({ id: variables.id, message: error.message }),
  });
  const term = search.trim().toLowerCase();
  const tickets = (query.data?.tickets ?? []).filter(ticket =>
    (status === 'all' || ticket.status === status) &&
    (!term || `${ticket.learnerName} ${ticket.title}`.toLowerCase().includes(term)));
  const selected = tickets.find(ticket => ticket.id === selectedId) ?? tickets[0];
  const draft = selected ? drafts[selected.id] : undefined;
  const readOnly = query.data?.readOnly || Boolean(coachEmail);

  if (query.isPending) return <p role="status" className="p-6 text-sm text-foreground-500">Loading LMS tickets...</p>;
  if (query.isError) return <EmptyState variant="error" title="Unable to load LMS tickets" description={query.error.message}
    action={<button type="button" className={FIELD} onClick={() => void query.refetch()}>Try again</button>} />;
  if (!query.data.tickets.length) return <EmptyState title="No LMS tickets" description="None of the learners on your caseload have raised an LMS support ticket." />;

  return <div className="space-y-4">
    <p className="text-sm text-foreground-500">LMS support tickets from your learners. The support team manages status and assignment.</p>
    {readOnly && <p className="rounded-lg bg-primary-50 p-3 text-sm text-primary-700">Read-only view: replies are disabled while viewing another coach.</p>}
    <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Panel className="space-y-3">
        <label className="block text-xs font-semibold text-foreground-600">Search LMS tickets
          <input type="search" className={cn(FIELD, 'mt-1 w-full')} value={search} onChange={event => setSearch(event.target.value)} placeholder="Learner or subject" />
        </label>
        <label className="block text-xs font-semibold text-foreground-600">Filter LMS tickets
          <select className={cn(FIELD, 'mt-1 w-full')} value={status} onChange={event => setStatus(event.target.value)}>
            <option value="all">All statuses</option><option value="open">Open</option><option value="in-progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
          </select>
        </label>
        <ul aria-label="LMS tickets" className="space-y-2">
          {tickets.map(ticket => <li key={ticket.id}><button type="button" aria-pressed={selected?.id === ticket.id} onClick={() => setSelectedId(ticket.id)}
            className={cn('w-full rounded-lg border p-3 text-left', selected?.id === ticket.id ? 'border-primary-300 bg-primary-50' : 'border-foreground-100 hover:bg-foreground-50')}>
            <span className="block text-xs text-foreground-500">{ticket.learnerName}</span>
            <span className="mt-1 block break-words text-sm font-semibold text-foreground-900">{ticket.title}</span>
            <span className="mt-1 block text-xs capitalize text-foreground-500">{ticket.status.replace('-', ' ')} · {ticket.priority}</span>
          </button></li>)}
        </ul>
        {!tickets.length && <p className="text-sm text-foreground-500">No tickets match your filters.</p>}
      </Panel>
      {selected && <Panel className="min-w-0 space-y-4">
        <div>
          <p className="text-sm text-foreground-500">{selected.learnerName} · {selected.category}</p>
          <h2 className="mt-1 break-words text-lg font-semibold text-foreground-900">{selected.title}</h2>
          <p className="mt-1 text-xs capitalize text-foreground-500">{selected.status.replace('-', ' ')} · {selected.priority} priority · {ticketDate(selected.submitted)}</p>
          <p className="mt-1 text-xs text-foreground-500">Assigned to: {selected.assignedTo || selected.assignedTeam || 'Support team'}</p>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-foreground-700">{selected.description}</p>
        <TicketAttachments ticketId={selected.id} attachments={selected.attachments} attachmentUrl={coachLmsAttachmentUrl} />
        <section aria-label="Ticket conversation" className="space-y-3 border-t border-foreground-100 pt-4">
          <h3 className="text-sm font-semibold">Conversation</h3>
          {!selected.replies.length && <p className="text-sm text-foreground-500">No replies yet.</p>}
          {selected.replies.map(message => <article key={message.id} className="rounded-lg bg-foreground-50 p-3">
            <p className="text-xs font-semibold text-foreground-600">{message.sender} · {message.senderRole} · {ticketDate(message.timestamp)}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground-800">{message.body}</p>
            <TicketAttachments ticketId={selected.id} attachments={message.attachments} attachmentUrl={coachLmsAttachmentUrl} />
          </article>)}
        </section>
        {!readOnly && <form className="space-y-3" onSubmit={event => {
          event.preventDefault();
          if (draft?.body.trim() && !reply.isPending) reply.mutate({ id: selected.id, draft });
        }}>
          <label className="block text-sm font-semibold">Reply to ticket
            <textarea className={cn(FIELD, 'mt-2 w-full')} rows={3} maxLength={4000} value={draft?.body ?? ''} disabled={reply.isPending}
              onChange={event => {
                setDrafts(old => ({ ...old, [selected.id]: { body: event.target.value, requestId: crypto.randomUUID() } }));
                setReplyError(undefined);
              }} />
          </label>
          {replyError?.id === selected.id && <p role="alert" className="text-sm text-red-600">{replyError.message}</p>}
          <button type="submit" disabled={!draft?.body.trim() || reply.isPending} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {reply.isPending ? 'Sending...' : 'Send reply'}
          </button>
        </form>}
      </Panel>}
    </div>
  </div>;
}
