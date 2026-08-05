import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { SECURE_NOTES, SAFEGUARDING_MESSAGES, CONTACT_LOG } from '@/mocks/safeguarding';

const sgConfig = roleNavMap.safeguarding;

const TABS = ['Secure Notes', 'Messages', 'Contact Log'] as const;

export default function CommunicationPage() {
  const [activeTab, setActiveTab] = useState<string>('Secure Notes');
  const [selectedNote, setSelectedNote] = useState<string | null>(null);

  return (
    <WorkspaceShell
      role="safeguarding" roleLabel={sgConfig.label} navItems={sgConfig.items}
      workspaceLabel={sgConfig.workspaceLabel}
      pageTitle="Communication" pageSubtitle="Secure notes, team messages, and contact logs — All communications are restricted and auditable"
      userName="Dr. Eleanor Vance" userRole="Designated Safeguarding Lead (DSL)"
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        <div className="flex items-center gap-1 bg-background-100 rounded-full p-1 w-fit overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-smooth whitespace-nowrap cursor-pointer ${
                activeTab === tab ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'Secure Notes' && (
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-200/50 rounded-xl p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                <AppIcon className="ri-lock-line text-red-600 text-lg"></AppIcon>
              </div>
              <div>
                <p className="text-sm font-heading font-semibold text-red-900">Secure Notes — Restricted Access</p>
                <p className="text-[12px] text-red-700 mt-1">
                  These notes contain sensitive safeguarding information. Visibility is restricted to authorised roles only.
                  All access to secure notes is logged in the audit trail.
                </p>
              </div>
            </div>
            {SECURE_NOTES.map(note => (
              <div
                key={note.id}
                onClick={() => setSelectedNote(selectedNote === note.id ? null : note.id)}
                className="bg-background-50 rounded-xl border border-red-200/40 p-4 cursor-pointer hover:border-red-300/50 transition-smooth"
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                    <AppIcon className="ri-file-lock-line text-red-600 text-sm"></AppIcon>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-red-500">{note.caseRef}</span>
                        <span className="text-[10px] text-foreground-400 ml-2">{note.date}</span>
                      </div>
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700">{note.visibility}</span>
                    </div>
                    <p className="text-[12px] font-medium text-foreground-700 mt-1">{note.author}</p>
                    {selectedNote === note.id ? (
                      <p className="text-[12px] text-foreground-600 mt-2 animate-in slide-in-from-bottom-2 duration-200">{note.content}</p>
                    ) : (
                      <p className="text-[11px] text-foreground-400 mt-1 line-clamp-2">{note.content}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'Messages' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <select className="text-[11px] border border-background-200 rounded-lg px-2.5 py-1.5 bg-background-50 text-foreground-600 cursor-pointer">
                <option>All Messages</option>
                <option>Unread</option>
                <option>High Priority</option>
              </select>
              <button className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[11px] font-semibold hover:bg-red-600 cursor-pointer whitespace-nowrap ml-auto">
                <AppIcon className="ri-add-line mr-1"></AppIcon> New Message
              </button>
            </div>
            {SAFEGUARDING_MESSAGES.map(msg => (
              <div key={msg.id} className={`bg-background-50 rounded-xl border p-4 cursor-pointer hover:border-background-300/50 transition-smooth ${
                !msg.read ? 'border-amber-300/50 bg-amber-50/30' : 'border-background-200/40'
              }`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {!msg.read && <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0"></div>}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold text-foreground-800">{msg.subject}</p>
                        {msg.priority === 'High' && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700">HIGH</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-foreground-400">
                        <span>From: {msg.from}</span>
                        <span>·</span>
                        <span>To: {msg.to}</span>
                        <span>·</span>
                        <span>{msg.date}</span>
                      </div>
                    </div>
                  </div>
                  <button className="text-foreground-300 hover:text-red-500 transition-smooth cursor-pointer shrink-0 ml-3">
                    <AppIcon className="ri-mail-open-line"></AppIcon>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'Contact Log' && (
          <div className="space-y-3">
            <p className="text-[12px] text-foreground-500">
              Record of all contacts with learners, families, agencies, and other parties. All entries are auditable.
            </p>
            <div className="overflow-x-auto bg-background-50 rounded-xl border border-foreground-200/60">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-foreground-400/50">
                    <th className="text-left px-4 py-3 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Date & Time</th>
                    <th className="text-left px-4 py-3 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-3 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Case</th>
                    <th className="text-left px-4 py-3 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Contact</th>
                    <th className="text-left px-4 py-3 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Officer</th>
                    <th className="text-left px-4 py-3 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {CONTACT_LOG.map(log => (
                    <tr key={log.id} className="border-b border-background-100/50 hover:bg-background-50/80 transition-smooth">
                      <td className="px-4 py-2.5 text-foreground-500 whitespace-nowrap">{log.date}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                          log.type === 'Home Visit' ? 'bg-red-50 text-red-700' :
                          log.type === 'Multi-agency Meeting' ? 'bg-amber-50 text-amber-700' :
                          log.type === 'Phone Call' ? 'bg-secondary-50 text-secondary-700' :
                          log.type === 'In-Person Meeting' ? 'bg-emerald-50 text-emerald-700' :
                          'bg-blue-50 text-blue-700'
                        }`}>{log.type}</span>
                      </td>
                      <td className="px-4 py-2.5"><span className="font-mono text-[10px] text-red-500">{log.caseRef}</span></td>
                      <td className="px-4 py-2.5 text-foreground-600">{log.contact}</td>
                      <td className="px-4 py-2.5 text-foreground-500 whitespace-nowrap">{log.officer}</td>
                      <td className="px-4 py-2.5 text-[11px] text-foreground-600 max-w-[240px] truncate">{log.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}