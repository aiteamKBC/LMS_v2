import { useState, useEffect, useRef } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

import { loadSupportTickets, updateSupportTicket, ticketDate, TICKET_CATEGORIES, type SupportTicket } from '@/api/supportTickets';
import { useAuth } from '@/hooks/useAuth';

const supportConfig = roleNavMap.support;

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export default function SupportTicketQueue() {
  const { auth } = useAuth();
  const accountRef = useRef(auth.account?.id);
  accountRef.current = auth.account?.id;
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const replyRequest = useRef<{ body: string; id: string; ticket: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTickets([]); setSelectedTicket(null); setReplyText(''); setLoading(true); setError('');
    loadSupportTickets(true).then(items => { if (!cancelled) setTickets(items); })
      .catch(error => { if (!cancelled) setError(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [auth.account?.id, reload]);
  const save = async (body: object) => {
    if (!selectedTicket || inFlight.current) return false;
    inFlight.current = true; setSaving(true); setError('');
    try {
      const ticket = await updateSupportTicket(selectedTicket.id, body, true);
      if (accountRef.current !== auth.account?.id) return false;
      setTickets(items => items.map(item => item.id === ticket.id ? ticket : item)); setSelectedTicket(ticket);
      return true;
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save ticket.'); return false; }
    finally { inFlight.current = false; setSaving(false); }
  };
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [replyText, setReplyText] = useState('');


  const filtered = tickets
    .filter(t => filterPriority === 'all' || t.priority === filterPriority)
    .filter(t => filterStatus === 'all' || t.status === filterStatus)
    .filter(t => filterCategory === 'all' || t.category === filterCategory)
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedTicket) return;
    if (replyRequest.current?.body !== replyText.trim() || replyRequest.current.ticket !== selectedTicket.id) {
      replyRequest.current = { body: replyText.trim(), ticket: selectedTicket.id, id: crypto.randomUUID() };
    }
    if (await save({ action: 'reply', body: replyText.trim(), requestId: replyRequest.current.id })) {
      setReplyText(''); replyRequest.current = null;
    }
  };

  return (
    <WorkspaceShell
      role="support"
      roleLabel={supportConfig.label}
      navItems={supportConfig.items}
      pageTitle="Ticket Queue"
      pageSubtitle={`${tickets.filter(t => t.status !== 'resolved' && t.status !== 'closed').length} open tickets · filter by priority, status, category`}
      userName={auth.account?.displayName || 'Support'}
      userRole="LMS Support"
      workspaceLabel={supportConfig.workspaceLabel}
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {loading && <p role="status">Loading tickets...</p>}
        {error && <p role="alert">{error}</p>}
        <button disabled={saving} onClick={() => setReload(value => value + 1)}>Refresh tickets</button>
        {!loading && !error && tickets.length === 0 && <p>No support tickets yet.</p>}
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="text-[11px] border border-background-200 rounded-lg px-2.5 py-1.5 bg-background-50 text-foreground-600 cursor-pointer">
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-[11px] border border-background-200 rounded-lg px-2.5 py-1.5 bg-background-50 text-foreground-600 cursor-pointer">
            <option value="all">All Status</option>
            <option value="open">Open</option>
            <option value="in-progress">In Progress</option>
            <option value="closed">Closed</option>
            <option value="resolved">Resolved</option>
          </select>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="text-[11px] border border-background-200 rounded-lg px-2.5 py-1.5 bg-background-50 text-foreground-600 cursor-pointer">
            <option value="all">All Categories</option>
            {TICKET_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
          </select>
          <span className="text-[11px] text-foreground-400 ml-auto">{filtered.length} tickets</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Ticket List */}
          <div className="lg:col-span-2 space-y-2">
            {filtered.map(ticket => (
              <div
                key={ticket.id}
                role="button" tabIndex={0}
                onKeyDown={e => { if (!saving && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelectedTicket(ticket); setReplyText(''); } }}
                onClick={() => { if (!saving) { setSelectedTicket(ticket === selectedTicket ? null : ticket); setReplyText(''); } }}
                className={`rounded-xl border p-4 cursor-pointer transition-smooth ${
                  selectedTicket?.id === ticket.id ? 'border-primary-300 bg-primary-50/30 ring-1 ring-primary-200/50' : 'bg-background-50 border-background-200/50 hover:border-background-300/60'
                } ${ticket.priority === 'urgent' ? 'border-l-[3px] border-l-red-500' : ticket.priority === 'high' ? 'border-l-[3px] border-l-amber-500' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                    ticket.priority === 'urgent' ? 'bg-red-500 animate-pulse' : ticket.priority === 'high' ? 'bg-amber-500' : ticket.priority === 'medium' ? 'bg-blue-400' : 'bg-foreground-300'
                  }`}></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-semibold text-foreground-800">{ticket.title}</p>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${
                        ticket.priority === 'urgent' ? 'bg-red-100 text-red-700' : ticket.priority === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700'
                      }`}>{ticket.priority}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] text-foreground-400">{ticket.id}</span>
                      <span className="text-[10px] text-foreground-300">·</span>
                      <span className="text-[10px] text-foreground-500">{ticket.requester}</span>
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-700">Learner</span>
                      <span className="text-[10px] text-foreground-500">{ticket.category}</span>
                      <span className="text-[10px] text-foreground-300 ml-auto">{ticketDate(ticket.submitted)}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        ticket.status === 'open' ? 'bg-red-50 text-red-700 border border-red-200/50' :
                        ticket.status === 'in-progress' ? 'bg-amber-50 text-amber-700 border border-amber-200/50' :
                        ticket.status === 'closed' ? 'bg-red-100 text-red-800 border border-red-300/50' :
                        'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                      }`}>{ticket.status === 'in-progress' ? 'In Progress' : ticket.status}</span>
                      <span className="text-[10px] text-foreground-400">Assigned: {ticket.assignedTo === '—' ? <span className="text-red-500 font-medium">Unassigned</span> : ticket.assignedTo}</span>
                      <span className="text-[10px] text-foreground-400">{ticketDate(ticket.lastUpdate)}</span>
                      <span className="text-[10px] text-foreground-500">LMS</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Ticket Detail Panel */}
          <div>
            {selectedTicket ? (
              <div className="bg-background-50 rounded-xl border border-background-200/50 p-4 md:p-5 sticky top-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{selectedTicket.id}</h3>
                  <button
                    onClick={() => setSelectedTicket(null)}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer"
                  >
                    <AppIcon className="ri-close-line text-xs"></AppIcon>
                  </button>
                </div>

                <p className="text-[13px] font-semibold text-foreground-800 mb-3">{selectedTicket.title}</p>

                {/* Ticket metadata */}
                <div className="grid grid-cols-2 gap-2 text-[11px] mb-4">
                  <div><span className="text-foreground-400">Requester:</span> <span className="text-foreground-700">{selectedTicket.requester}</span></div>
                  <div><span className="text-foreground-400">Role:</span> <span className="text-foreground-700">Learner</span></div>
                  <div><span className="text-foreground-400">Tenant:</span> <span className="text-foreground-700">LMS</span></div>
                  <div><span className="text-foreground-400">Category:</span> <span className="text-foreground-700">{selectedTicket.category}</span></div>
                  <div><span className="text-foreground-400">Priority:</span> <span className={`font-semibold ${selectedTicket.priority === 'urgent' ? 'text-red-600' : 'text-foreground-700'}`}>{selectedTicket.priority}</span></div>
                  <div><span className="text-foreground-400">SLA:</span> <span className="text-foreground-700">{ticketDate(selectedTicket.lastUpdate)}</span></div>
                </div>

                {/* Description */}
                <div className="bg-background-100/70 rounded-lg p-3 mb-4">
                  <p className="text-[12px] text-foreground-600 leading-relaxed">{selectedTicket.description}</p>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <button disabled={saving} onClick={() => save({ action: 'assign' })}>Assign to me</button>
                  <select aria-label="Ticket status" disabled={saving} value={selectedTicket.status}
                    onChange={e => save({ action: 'status', status: e.target.value, expectedStatus: selectedTicket.status })}>
                    {['open', 'in-progress', 'resolved', 'closed'].map(status => <option key={status} value={status}>{status}</option>)}
                  </select>
                </div>

                {/* Replies */}
                {selectedTicket.replies.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {selectedTicket.replies.map((r, i) => (
                      <div key={i} className="bg-primary-50/50 rounded-lg p-2.5 border border-primary-100/50">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-semibold text-primary-700">{r.sender}</span>
                          <span className="text-[9px] text-foreground-400">{ticketDate(r.timestamp)}</span>
                        </div>
                        <p className="text-[11px] text-foreground-600">{r.body}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick Reply */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    aria-label="Reply" disabled={saving} value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder="Type a reply..."
                    className="flex-1 text-[11px] border border-background-200 rounded-lg px-3 py-2 bg-background-50 text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300"
                    onKeyDown={e => e.key === 'Enter' && handleSendReply()}
                  />
                  <button
                    aria-label="Send reply" disabled={saving || !replyText.trim()} onClick={handleSendReply}
                    className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    <AppIcon className="ri-send-plane-fill"></AppIcon>
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-background-50 rounded-xl border border-background-200/50 p-6 text-center">
                <div className="w-12 h-12 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <AppIcon className="ri-ticket-line text-foreground-300 text-xl"></AppIcon>
                </div>
                <p className="text-[13px] text-foreground-500">Select a ticket to view details</p>
                <p className="text-[11px] text-foreground-300 mt-1">Click any ticket card to expand</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
