import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface CallLog {
  id: string;
  caller: string;
  callerRole: string;
  recipient: string;
  recipientRole: string;
  phoneNumber: string;
  duration: string;
  durationSeconds: number;
  purpose: string;
  outcome: string;
  followUpRequired: boolean;
  timestamp: string;
  recordingAvailable: boolean;
  category: string;
}

const CALL_LOGS: CallLog[] = [
  { id: 'cl-01', caller: 'Med Maher', callerRole: 'Coach', recipient: 'James Okonkwo', recipientRole: 'Learner', phoneNumber: '07412 345 678', duration: '12:30', durationSeconds: 750, purpose: 'Attendance intervention — missed 4 consecutive sessions', outcome: 'Learner agreed to attend catch-up. Employer notified.', followUpRequired: true, timestamp: 'Today, 09:15', recordingAvailable: true, category: 'Attendance' },
  { id: 'cl-02', caller: 'Sarah Chen', callerRole: 'Coach', recipient: 'Daniel Walsh', recipientRole: 'Learner', phoneNumber: '07423 456 789', duration: '08:45', durationSeconds: 525, purpose: 'Unreported absence follow-up', outcome: 'Learner explained car breakdown. Committed to attending next session.', followUpRequired: false, timestamp: 'Today, 08:00', recordingAvailable: true, category: 'Absence' },
  { id: 'cl-03', caller: 'Tom Harrington', callerRole: 'Engagement Manager', recipient: 'Unilever HR', recipientRole: 'Employer', phoneNumber: '020 7946 0123', duration: '18:20', durationSeconds: 1100, purpose: 'Employer engagement check — James Okonkwo attendance', outcome: 'Employer confirmed workplace support. Will facilitate flexible hours.', followUpRequired: true, timestamp: 'Yesterday, 14:30', recordingAvailable: false, category: 'Employer' },
  { id: 'cl-04', caller: 'James Harrington', callerRole: 'Coach', recipient: 'Maya Kapoor', recipientRole: 'Learner', phoneNumber: '07434 567 890', duration: '06:15', durationSeconds: 375, purpose: 'Catch-up session scheduling', outcome: 'Scheduled for 14 June at 10:00. IT issues resolved.', followUpRequired: false, timestamp: 'Yesterday, 11:00', recordingAvailable: true, category: 'Catch-up' },
  { id: 'cl-05', caller: 'Med Maher', callerRole: 'Coach', recipient: 'Aisha Patel', recipientRole: 'Learner', phoneNumber: '07445 678 901', duration: '10:00', durationSeconds: 600, purpose: 'Evidence submission overdue', outcome: 'Learner needs 2 more weeks. Agreed extension with conditions.', followUpRequired: true, timestamp: 'Yesterday, 09:30', recordingAvailable: true, category: 'Evidence' },
  { id: 'cl-06', caller: 'Sarah Chen', callerRole: 'Coach', recipient: 'Liam Foster', recipientRole: 'Learner', phoneNumber: '07456 789 012', duration: '05:30', durationSeconds: 330, purpose: 'Progress review check-in', outcome: 'Positive progress. On track for gateway.', followUpRequired: false, timestamp: '8 Jun, 16:00', recordingAvailable: false, category: 'Progress' },
  { id: 'cl-07', caller: 'Tom Harrington', callerRole: 'Engagement Manager', recipient: 'Tesco Training Manager', recipientRole: 'Employer', phoneNumber: '020 7946 0456', duration: '15:10', durationSeconds: 910, purpose: 'Employer escalation — attendance pattern', outcome: 'Meeting scheduled for next week. Action plan agreed.', followUpRequired: true, timestamp: '8 Jun, 10:00', recordingAvailable: false, category: 'Escalation' },
  { id: 'cl-08', caller: 'James Harrington', callerRole: 'Coach', recipient: 'Priya Sharma', recipientRole: 'Learner', phoneNumber: '07467 890 123', duration: '07:45', durationSeconds: 465, purpose: 'Wellbeing check — low engagement', outcome: 'Learner reported stress at work. Referred to support services.', followUpRequired: true, timestamp: '7 Jun, 11:30', recordingAvailable: true, category: 'Wellbeing' },
];

export default function CallLogsPage() {
  const navigate = useNavigate();
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const filtered = CALL_LOGS.filter(c => {
    const matchCat = categoryFilter === 'all' || c.category === categoryFilter;
    const matchSearch = c.caller.toLowerCase().includes(search.toLowerCase()) || c.recipient.toLowerCase().includes(search.toLowerCase()) || c.purpose.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });
  const totalDuration = CALL_LOGS.reduce((s, c) => s + c.durationSeconds, 0);
  const avgDuration = Math.round(totalDuration / CALL_LOGS.length / 60);

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Call Logs" pageSubtitle="Record and track phone calls with learners, employers, and stakeholders"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Call Logs"
          description={`${CALL_LOGS.length} calls recorded. Total duration: ${Math.floor(totalDuration / 60)} minutes. Average call: ${avgDuration} minutes. ${CALL_LOGS.filter(c => c.followUpRequired).length} calls require follow-up action.`}
          icon="ri-phone-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20professional%20phone%20call%20coaching%20session%20modern%20office%20warm%20lighting%20headset&width=400&height=160&seq=call-logs-01&orientation=landscape"
          imageAlt="Call Logs"
          stats={[{ label: 'Calls', value: String(CALL_LOGS.length) }, { label: 'Follow-up', value: String(CALL_LOGS.filter(c => c.followUpRequired).length) }, { label: 'Recorded', value: String(CALL_LOGS.filter(c => c.recordingAvailable).length) }]}
        />

        {/* Related Pages Navigation */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/communication')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-message-2-line text-sm"></i> Communication Centre
          </button>
          <button onClick={() => navigate('/engagement/employer-escalations')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-building-2-line text-sm"></i> Employer Escalations
          </button>
          <button onClick={() => navigate('/engagement/whatsapp-logs')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-whatsapp-line text-sm"></i> WhatsApp Logs
          </button>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-heart-line text-sm"></i> Learner Engagement
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" placeholder="Search calls..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {['all', 'Attendance', 'Absence', 'Employer', 'Catch-up', 'Evidence', 'Escalation', 'Wellbeing', 'Progress'].map(cat => (
              <button key={cat} onClick={() => setCategoryFilter(cat)} className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${categoryFilter === cat ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Call List */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center justify-between">
            <span className="text-sm font-heading font-semibold text-foreground-900">Call Records</span>
            <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-1 rounded-full">{filtered.length} calls</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(call => (
              <div key={call.id} className={`p-4 flex items-start gap-4 ${call.followUpRequired ? 'bg-accent-50/20' : ''}`}>
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                  <i className="ri-phone-line text-sm"></i>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[12px] font-semibold text-foreground-900">{call.purpose}</span>
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-100 text-secondary-700">{call.category}</span>
                    {call.followUpRequired && <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-accent-100 text-accent-700">Follow-up needed</span>}
                  </div>
                  <p className="text-[11px] text-foreground-500 mb-2">{call.outcome}</p>
                  <div className="flex items-center gap-3 text-[10px] text-foreground-400">
                    <span>From: <strong className="text-foreground-600">{call.caller}</strong> ({call.callerRole})</span>
                    <span>To: <strong className="text-foreground-600">{call.recipient}</strong> ({call.recipientRole})</span>
                    <span><i className="ri-time-line mr-0.5"></i>{call.duration}</span>
                    <span>{call.phoneNumber}</span>
                    <span>{call.timestamp}</span>
                    {call.recordingAvailable && <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700"><i className="ri-mic-line mr-0.5"></i>Recorded</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-file-list-line mr-1"></i> Notes
                  </button>
                  {call.recordingAvailable && (
                    <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-play-line mr-1"></i> Play
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}