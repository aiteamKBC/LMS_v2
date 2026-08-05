import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const tutorNav = roleNavMap.tutor;

interface FeedbackItem {
  id: string;
  learner: string;
  programme: string;
  assignment: string;
  type: string;
  submittedDate: string;
  deadline: string;
  priority: 'High' | 'Medium' | 'Low';
  wordCount: number;
  status: 'Awaiting' | 'In Progress' | 'Completed';
}

const FEEDBACK_ITEMS: FeedbackItem[] = [
  { id: 'fb-01', learner: 'Sophie Williams', programme: 'Marketing Executive L4', assignment: 'Campaign Segmentation Worksheet', type: 'Assignment', submittedDate: '8 Jun', deadline: '15 Jun', priority: 'High', wordCount: 1200, status: 'Awaiting' },
  { id: 'fb-02', learner: 'James Okonkwo', programme: 'Data Analyst L4', assignment: 'Data Visualisation Report', type: 'Report', submittedDate: '7 Jun', deadline: '14 Jun', priority: 'High', wordCount: 1800, status: 'Awaiting' },
  { id: 'fb-03', learner: 'Aisha Patel', programme: 'Accountancy L3', assignment: 'Financial Statement Analysis', type: 'Assignment', submittedDate: '6 Jun', deadline: '13 Jun', priority: 'Medium', wordCount: 950, status: 'Awaiting' },
  { id: 'fb-04', learner: 'Sarah Mitchell', programme: 'Business Admin L3', assignment: 'Board Meeting Minutes & Reflection', type: 'Workplace Evidence', submittedDate: '5 Jun', deadline: '12 Jun', priority: 'Medium', wordCount: 1500, status: 'In Progress' },
  { id: 'fb-05', learner: 'Liam Foster', programme: 'Project Manager L4', assignment: 'Risk Register & Mitigation Plan', type: 'Project Evidence', submittedDate: '4 Jun', deadline: '11 Jun', priority: 'High', wordCount: 2100, status: 'Awaiting' },
  { id: 'fb-06', learner: 'David Chen', programme: 'Software Developer L4', assignment: 'Code Review & Documentation', type: 'Documentation', submittedDate: '3 Jun', deadline: '10 Jun', priority: 'Low', wordCount: 800, status: 'In Progress' },
  { id: 'fb-07', learner: 'Maya Kapoor', programme: 'HR Consultant L5', assignment: 'HR Policy Review Reflection', type: 'Reflection', submittedDate: '1 Jun', deadline: '8 Jun', priority: 'Low', wordCount: 600, status: 'Completed' },
  { id: 'fb-08', learner: 'Chloe Evans', programme: 'Digital Marketer L3', assignment: 'Email Campaign Analysis', type: 'Report', submittedDate: '9 Jun', deadline: '16 Jun', priority: 'Medium', wordCount: 1400, status: 'Awaiting' },
  { id: 'fb-09', learner: 'Omar Hassan', programme: 'Business Admin L3', assignment: 'Office Procedures Manual Review', type: 'Reflection', submittedDate: '9 Jun', deadline: '16 Jun', priority: 'Low', wordCount: 750, status: 'Awaiting' },
  { id: 'fb-10', learner: 'Emily Watson', programme: 'Digital Marketer L3', assignment: 'Social Media Strategy Proposal', type: 'Report', submittedDate: '2 Jun', deadline: '9 Jun', priority: 'Medium', wordCount: 1600, status: 'Completed' },
  { id: 'fb-11', learner: 'Sophie Williams', programme: 'Marketing Executive L4', assignment: 'Competitor Analysis Framework', type: 'Assignment', submittedDate: '10 Jun', deadline: '17 Jun', priority: 'Medium', wordCount: 1100, status: 'Awaiting' },
];

export default function TutorFeedbackQueuePage() {
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState('');

  const filtered = filter === 'all' ? FEEDBACK_ITEMS : (
    filter === 'awaiting' ? FEEDBACK_ITEMS.filter(f => f.status === 'Awaiting') :
    filter === 'in-progress' ? FEEDBACK_ITEMS.filter(f => f.status === 'In Progress') :
    FEEDBACK_ITEMS.filter(f => f.status === 'Completed')
  );

  const awaiting = FEEDBACK_ITEMS.filter(f => f.status === 'Awaiting').length;
  const inProgress = FEEDBACK_ITEMS.filter(f => f.status === 'In Progress').length;
  const highPriority = FEEDBACK_ITEMS.filter(f => f.priority === 'High').length;
  const totalWords = FEEDBACK_ITEMS.reduce((s, f) => s + f.wordCount, 0);

  return (
    <WorkspaceShell role="tutor" roleLabel={tutorNav.label} navItems={tutorNav.items} workspaceLabel={tutorNav.workspaceLabel} pageTitle="Feedback Queue" pageSubtitle="Manage and prioritise assignment feedback, marking, and learner response items" userName="Rachel Myers" userRole="Business Admin Tutor">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><AppIcon className="ri-chat-3-line text-white text-2xl"></AppIcon></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Feedback Queue</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">{awaiting} awaiting feedback · {inProgress} in progress · {highPriority} high priority · {totalWords.toLocaleString()} total words</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{FEEDBACK_ITEMS.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Queue</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-red-300">{highPriority}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">High Prio</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{inProgress}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">In Progress</p></div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { l: 'Awaiting Feedback', v: String(awaiting), i: 'ri-hourglass-line', c: 'amber' },
            { l: 'High Priority', v: String(highPriority), i: 'ri-alert-line', c: 'red' },
            { l: 'In Progress', v: String(inProgress), i: 'ri-edit-line', c: 'primary' },
            { l: 'Completed', v: String(FEEDBACK_ITEMS.filter(f => f.status === 'Completed').length), i: 'ri-check-double-line', c: 'emerald' },
          ].map(s => (
            <div key={s.l} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 cursor-pointer">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${s.c === 'amber' ? 'bg-amber-100 text-amber-600' : s.c === 'red' ? 'bg-red-100 text-red-600' : s.c === 'primary' ? 'bg-primary-100 text-primary-600' : 'bg-emerald-100 text-emerald-600'}`}><AppIcon className={`${s.i} text-sm`}></AppIcon></span>
              <p className="text-[11px] text-foreground-400 mb-1">{s.l}</p>
              <p className="text-2xl font-heading font-semibold text-foreground-900">{s.v}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {[
            { key: 'all', label: 'All' },
            { key: 'awaiting', label: 'Awaiting' },
            { key: 'in-progress', label: 'In Progress' },
            { key: 'completed', label: 'Completed' },
          ].map(s => (
            <button key={s.key} onClick={() => setFilter(s.key)} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === s.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{s.label}</button>
          ))}
        </div>

        <div className="space-y-2">
          {filtered.map(item => (
            <div key={item.id} className={`bg-background-50 rounded-xl border overflow-hidden ${item.priority === 'High' ? 'border-red-200/50' : 'border-foreground-200/60'}`}>
              <div onClick={() => setExpandedId(expandedId === item.id ? null : item.id)} className="p-4 flex items-center gap-4 cursor-pointer hover:bg-background-100/30 transition-smooth">
                <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-bold ${item.priority === 'High' ? 'bg-red-100 text-red-700' : item.priority === 'Medium' ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-500'}`}>{item.priority}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-foreground-900 truncate">{item.assignment}</p>
                  <div className="flex items-center gap-x-2 gap-y-1 mt-0.5 flex-wrap text-[11px] text-foreground-400">
                    <span>{item.learner}</span>
                    <span className="text-[8px] text-foreground-300">&middot;</span>
                    <span>{item.programme}</span>
                    <span className="text-[8px] text-foreground-300">&middot;</span>
                    <span>{item.type}</span>
                    <span className="text-[8px] text-foreground-300">&middot;</span>
                    <span>{item.wordCount} words</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-[11px] text-foreground-400">
                  <span>Due {item.deadline}</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${item.status === 'Awaiting' ? 'bg-amber-100 text-amber-700' : item.status === 'In Progress' ? 'bg-primary-100 text-primary-700' : 'bg-emerald-100 text-emerald-700'}`}>{item.status}</span>
                  <AppIcon className={expandedId === item.id ? 'ri-arrow-up-s-line text-foreground-300' : 'ri-arrow-down-s-line text-foreground-300'}></AppIcon>
                </div>
              </div>
              {expandedId === item.id && (
                <div className="px-4 pb-4 border-t border-background-200/30 pt-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    {[
                      { l: 'Learner', v: item.learner },
                      { l: 'Assignment', v: item.assignment },
                      { l: 'Type', v: item.type },
                      { l: 'Submitted', v: item.submittedDate },
                      { l: 'Deadline', v: item.deadline },
                      { l: 'Word Count', v: String(item.wordCount) },
                    ].map(st => (
                      <div key={st.l} className="bg-background-100/50 rounded-lg p-2.5"><p className="text-[9px] text-foreground-400 uppercase tracking-wider">{st.l}</p><p className="text-[12px] font-medium text-foreground-900 truncate">{st.v}</p></div>
                    ))}
                  </div>
                  <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)} placeholder="Write your feedback..." className="w-full px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-900 placeholder-foreground-300 outline-none focus:border-primary-300 resize-none mb-3" rows={3} />
                  <div className="flex items-center gap-2">
                    {item.status !== 'Completed' && (
                      <>
                        <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-send-plane-line mr-1"></AppIcon> Submit Feedback</button>
                        <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-draft-line mr-1"></AppIcon> Save Draft</button>
                      </>
                    )}
                    <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-file-line mr-1"></AppIcon> View Assignment</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}