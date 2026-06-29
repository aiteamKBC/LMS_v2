import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const supportConfig = roleNavMap.support;

const ALL_TICKETS = [
  { id: 'TKT-0892', subject: 'Learner unable to submit evidence — file upload failing', requester: 'Emily Watson', role: 'Learner', tenant: 'KBC', priority: 'high', status: 'open', category: 'Technical', assignedTo: 'Ahmed Khalil', created: '10 Jun 2026 14:22', sla: '1h 38m', description: 'User reports that when attempting to upload PDF evidence files, the upload spinner appears briefly then disappears with no file attached. Tried Chrome and Firefox on Windows 11.' },
  { id: 'TKT-0891', subject: 'Coach dashboard not showing updated caseload after allocation', requester: 'Sarah Thompson', role: 'Coach', tenant: 'KBC', priority: 'high', status: 'in-progress', category: 'Bug Report', assignedTo: 'Layla Moussa', created: '10 Jun 2026 12:45', sla: '3h 15m', description: 'After MIS team allocated 3 new learners to Coach Sarah, the dashboard still shows old caseload count. Cache cleared, different browsers tested.' },
  { id: 'TKT-0890', subject: 'Employer unable to sign training plan — DocuSign error "Session Expired"', requester: 'Mark Johnson (KCC)', role: 'Employer', tenant: 'KBC', priority: 'urgent', status: 'open', category: 'Integration', assignedTo: '—', created: '10 Jun 2026 11:08', sla: '15m', description: 'KCC employer trying to sign 3 apprentice training plans. Gets "Session Expired" after clicking Sign Now. Tried on mobile and desktop.' },
  { id: 'TKT-0889', subject: 'OTJH hours not accumulating correctly for Cohort B learners', requester: 'James Okonkwo', role: 'Learner', tenant: 'KBC', priority: 'medium', status: 'in-progress', category: 'Data Issue', assignedTo: 'Ahmed Khalil', created: '10 Jun 2026 09:30', sla: '5h 30m', description: 'Multiple Cohort B learners report that OTJH hours logged this week show as 0 in the monthly total. Individual entries are visible but not summing.' },
  { id: 'TKT-0888', subject: 'QA sampling report not generating for April cohort', requester: 'Priya Patel', role: 'QA Officer', tenant: 'LSA', priority: 'medium', status: 'open', category: 'Reporting', assignedTo: '—', created: '10 Jun 2026 08:15', sla: '6h 45m', description: 'Generate Report button on QA Sampling page returns blank PDF for April 2026 cohort. Other months work fine.' },
  { id: 'TKT-0887', subject: 'New tenant onboarding — programme template missing', requester: 'Admin Team', role: 'Super Admin', tenant: 'MAN', priority: 'low', status: 'resolved', category: 'Onboarding', assignedTo: 'Layla Moussa', created: '9 Jun 2026 16:40', sla: 'Resolved', description: 'Manchester Tech College onboarding — Data Technician L3 template not appearing in programme list after provisioning.' },
  { id: 'TKT-0886', subject: 'WhatsApp notification templates not sending to Learner app', requester: 'Engagement Team', role: 'Engagement Manager', tenant: 'KBC', priority: 'medium', status: 'in-progress', category: 'Notifications', assignedTo: 'Ahmed Khalil', created: '9 Jun 2026 14:10', sla: '20h 50m', description: 'WhatsApp channel configured correctly but test messages not delivering. Email and SMS channels working fine.' },
  { id: 'TKT-0885', subject: 'Complaint: AI marking incorrectly rejected valid evidence', requester: 'Rachel Okafor', role: 'Learner', tenant: 'MAN', priority: 'high', status: 'escalated', category: 'Complaint', assignedTo: 'Layla Moussa', created: '9 Jun 2026 10:55', sla: 'Escalated', description: 'Learner submitted workplace observation evidence. AI flagged it as insufficient but coach confirms it meets KSB criteria. This is the 3rd similar complaint this week.' },
  { id: 'TKT-0884', subject: 'Attendance mode "Self-Paced" not showing in dropdown for Cohort D', requester: 'David Osei', role: 'Coach', tenant: 'KBC', priority: 'low', status: 'resolved', category: 'Technical', assignedTo: 'Ahmed Khalil', created: '8 Jun 2026 15:30', sla: 'Resolved', description: 'Resolved — missing configuration in cohort settings.' },
  { id: 'TKT-0883', subject: 'Employer satisfaction survey link broken in email', requester: 'Nadia Hussain', role: 'Support Specialist', tenant: 'KBC', priority: 'medium', status: 'open', category: 'Bug Report', assignedTo: '—', created: '8 Jun 2026 11:20', sla: '28h 40m', description: 'Internal report: employer satisfaction survey link in automated email points to old URL. Affects all employer communications.' },
];

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export default function SupportTicketQueue() {
  const [selectedTicket, setSelectedTicket] = useState<typeof ALL_TICKETS[0] | null>(null);
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [replyText, setReplyText] = useState('');
  const [replies, setReplies] = useState<Record<string, { text: string; time: string; author: string }[]>>({});

  const filtered = ALL_TICKETS
    .filter(t => filterPriority === 'all' || t.priority === filterPriority)
    .filter(t => filterStatus === 'all' || t.status === filterStatus)
    .filter(t => filterCategory === 'all' || t.category === filterCategory)
    .sort((a, b) => (PRIORITY_ORDER[a.priority] || 99) - (PRIORITY_ORDER[b.priority] || 99));

  const handleSendReply = () => {
    if (!replyText.trim() || !selectedTicket) return;
    setReplies(prev => ({
      ...prev,
      [selectedTicket.id]: [...(prev[selectedTicket.id] || []), { text: replyText, time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), author: 'Ahmed Khalil' }],
    }));
    setReplyText('');
  };

  return (
    <WorkspaceShell
      role="support"
      roleLabel={supportConfig.label}
      navItems={supportConfig.items}
      pageTitle="Ticket Queue"
      pageSubtitle={`${ALL_TICKETS.filter(t => t.status !== 'resolved').length} open tickets · filter by priority, status, category`}
      userName="Ahmed Khalil"
      userRole="Senior Support Lead"
      workspaceLabel={supportConfig.workspaceLabel}
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
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
            <option value="escalated">Escalated</option>
            <option value="resolved">Resolved</option>
          </select>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="text-[11px] border border-background-200 rounded-lg px-2.5 py-1.5 bg-background-50 text-foreground-600 cursor-pointer">
            <option value="all">All Categories</option>
            <option value="Technical">Technical</option>
            <option value="Bug Report">Bug Report</option>
            <option value="Complaint">Complaint</option>
            <option value="Integration">Integration</option>
            <option value="Data Issue">Data Issue</option>
            <option value="Reporting">Reporting</option>
            <option value="Notifications">Notifications</option>
            <option value="Onboarding">Onboarding</option>
          </select>
          <span className="text-[11px] text-foreground-400 ml-auto">{filtered.length} tickets</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Ticket List */}
          <div className="lg:col-span-2 space-y-2">
            {filtered.map(ticket => (
              <div
                key={ticket.id}
                onClick={() => setSelectedTicket(ticket === selectedTicket ? null : ticket)}
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
                      <p className="text-[13px] font-semibold text-foreground-800">{ticket.subject}</p>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${
                        ticket.priority === 'urgent' ? 'bg-red-100 text-red-700' : ticket.priority === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700'
                      }`}>{ticket.priority}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] text-foreground-400">{ticket.id}</span>
                      <span className="text-[10px] text-foreground-300">·</span>
                      <span className="text-[10px] text-foreground-500">{ticket.requester}</span>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                        ticket.role === 'Learner' ? 'bg-primary-50 text-primary-700' : ticket.role === 'Coach' ? 'bg-emerald-50 text-emerald-700' :
                        ticket.role === 'Employer' ? 'bg-accent-50 text-accent-700' : 'bg-secondary-50 text-secondary-700'
                      }`}>{ticket.role}</span>
                      <span className="text-[10px] text-foreground-500">{ticket.category}</span>
                      <span className="text-[10px] text-foreground-300 ml-auto">{ticket.created}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        ticket.status === 'open' ? 'bg-red-50 text-red-700 border border-red-200/50' :
                        ticket.status === 'in-progress' ? 'bg-amber-50 text-amber-700 border border-amber-200/50' :
                        ticket.status === 'escalated' ? 'bg-red-100 text-red-800 border border-red-300/50' :
                        'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                      }`}>{ticket.status === 'in-progress' ? 'In Progress' : ticket.status}</span>
                      <span className="text-[10px] text-foreground-400">Assigned: {ticket.assignedTo === '—' ? <span className="text-red-500 font-medium">Unassigned</span> : ticket.assignedTo}</span>
                      <span className="text-[10px] text-foreground-400">{ticket.sla}</span>
                      <span className="text-[10px] text-foreground-500">{ticket.tenant}</span>
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
                    <i className="ri-close-line text-xs"></i>
                  </button>
                </div>

                <p className="text-[13px] font-semibold text-foreground-800 mb-3">{selectedTicket.subject}</p>

                {/* Ticket metadata */}
                <div className="grid grid-cols-2 gap-2 text-[11px] mb-4">
                  <div><span className="text-foreground-400">Requester:</span> <span className="text-foreground-700">{selectedTicket.requester}</span></div>
                  <div><span className="text-foreground-400">Role:</span> <span className="text-foreground-700">{selectedTicket.role}</span></div>
                  <div><span className="text-foreground-400">Tenant:</span> <span className="text-foreground-700">{selectedTicket.tenant}</span></div>
                  <div><span className="text-foreground-400">Category:</span> <span className="text-foreground-700">{selectedTicket.category}</span></div>
                  <div><span className="text-foreground-400">Priority:</span> <span className={`font-semibold ${selectedTicket.priority === 'urgent' ? 'text-red-600' : 'text-foreground-700'}`}>{selectedTicket.priority}</span></div>
                  <div><span className="text-foreground-400">SLA:</span> <span className="text-foreground-700">{selectedTicket.sla}</span></div>
                </div>

                {/* Description */}
                <div className="bg-background-100/70 rounded-lg p-3 mb-4">
                  <p className="text-[12px] text-foreground-600 leading-relaxed">{selectedTicket.description}</p>
                </div>

                {/* Assign & Status */}
                <div className="flex items-center gap-2 mb-4">
                  <select className="text-[11px] border border-background-200 rounded-lg px-2.5 py-1.5 bg-background-50 text-foreground-600 cursor-pointer flex-1">
                    <option>{selectedTicket.assignedTo === '—' ? 'Assign to...' : selectedTicket.assignedTo}</option>
                    <option>Ahmed Khalil</option>
                    <option>Layla Moussa</option>
                    <option>David Osei</option>
                    <option>Nadia Hussain</option>
                  </select>
                  <select className="text-[11px] border border-background-200 rounded-lg px-2.5 py-1.5 bg-background-50 text-foreground-600 cursor-pointer">
                    <option>{selectedTicket.status}</option>
                    <option>open</option>
                    <option>in-progress</option>
                    <option>escalated</option>
                    <option>resolved</option>
                  </select>
                </div>

                {/* Replies */}
                {(replies[selectedTicket.id] || []).length > 0 && (
                  <div className="space-y-2 mb-4">
                    {replies[selectedTicket.id].map((r, i) => (
                      <div key={i} className="bg-primary-50/50 rounded-lg p-2.5 border border-primary-100/50">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-semibold text-primary-700">{r.author}</span>
                          <span className="text-[9px] text-foreground-400">{r.time}</span>
                        </div>
                        <p className="text-[11px] text-foreground-600">{r.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick Reply */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder="Type a reply..."
                    className="flex-1 text-[11px] border border-background-200 rounded-lg px-3 py-2 bg-background-50 text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300"
                    onKeyDown={e => e.key === 'Enter' && handleSendReply()}
                  />
                  <button
                    onClick={handleSendReply}
                    className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    <i className="ri-send-plane-fill"></i>
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-background-50 rounded-xl border border-background-200/50 p-6 text-center">
                <div className="w-12 h-12 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <i className="ri-ticket-line text-foreground-300 text-xl"></i>
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