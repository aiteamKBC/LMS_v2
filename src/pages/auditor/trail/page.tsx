import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const auditorConfig = roleNavMap.auditor;

interface AuditEntry {
  id: string;
  timestamp: string;
  user: string;
  userRole: string;
  action: string;
  entityType: 'Evidence' | 'Review' | 'Enrolment' | 'User' | 'Compliance' | 'Signature' | 'Configuration';
  entity: string;
  details: string;
  ipAddress: string;
  severity: 'Info' | 'Warning' | 'Critical';
}

const AUDIT_TRAIL: AuditEntry[] = [
  { id: 'AUD-1047', timestamp: '10 Jun 2026 09:15:22', user: 'Helen Curtis', userRole: 'Tutor', action: 'Evidence Validated', entityType: 'Evidence', entity: 'EV-2881', details: 'Validated reflection evidence with score 92/100. KSB mapping: K12, S4, B2', ipAddress: '192.168.4.22', severity: 'Info' },
  { id: 'AUD-1046', timestamp: '10 Jun 2026 08:42:10', user: 'Patricia Stone', userRole: 'Auditor', action: 'Audit Sample Requested', entityType: 'Evidence', entity: 'Cohort ME-L4', details: 'Requested 5 random evidence samples from Marketing Executive L4 May 2026 cohort', ipAddress: '192.168.12.8', severity: 'Info' },
  { id: 'AUD-1045', timestamp: '09 Jun 2026 16:30:45', user: 'Rebecca Holmes', userRole: 'Compliance Officer', action: 'DAS Record Updated', entityType: 'Compliance', entity: 'DAS-1182', details: 'Updated funding commitment for learner Sophie Williams — increased from £15,000 to £18,000', ipAddress: '192.168.3.45', severity: 'Warning' },
  { id: 'AUD-1044', timestamp: '09 Jun 2026 14:22:18', user: 'Martin Reeves', userRole: 'Coach', action: 'OTJH Entry Validated', entityType: 'Review', entity: 'OT-1204', details: 'Validated 28 OTJH hours for Daniel Walsh — employer confirmed all hours', ipAddress: '192.168.7.33', severity: 'Info' },
  { id: 'AUD-1043', timestamp: '09 Jun 2026 11:08:55', user: 'Admin', userRole: 'System', action: 'Automated Backup', entityType: 'Configuration', entity: 'System', details: 'Daily automated database backup completed successfully. Size: 2.4GB', ipAddress: '10.0.1.5', severity: 'Info' },
  { id: 'AUD-1042', timestamp: '08 Jun 2026 15:47:30', user: 'Tom Bradley', userRole: 'QA Officer', action: 'QA Spot Check Completed', entityType: 'Review', entity: 'Review #PR-542', details: 'QA review of progress review — passed with no findings. Sampling: Routine monthly check', ipAddress: '192.168.8.17', severity: 'Info' },
  { id: 'AUD-1041', timestamp: '08 Jun 2026 13:12:03', user: 'James Thompson', userRole: 'Employer', action: 'Progress Review Signed', entityType: 'Signature', entity: 'Review #PR-542', details: 'Digitally signed progress review for apprentice Aisha Patel. IP-verified signature', ipAddress: '82.14.52.91', severity: 'Info' },
  { id: 'AUD-1040', timestamp: '08 Jun 2026 10:30:00', user: 'Rebecca Holmes', userRole: 'Compliance Officer', action: 'Enrolment Review Failed', entityType: 'Enrolment', entity: 'Learner Joshua Bennett', details: 'Enrolment review failed — missing employer contract signature and evidence of prior attainment', ipAddress: '192.168.3.45', severity: 'Critical' },
  { id: 'AUD-1039', timestamp: '07 Jun 2026 16:55:40', user: 'Lisa Nguyen', userRole: 'MIS Officer', action: 'ILR Data Export', entityType: 'Compliance', entity: 'ILR-2026-Q2', details: 'Exported ILR data for Q2 2026 submission — 87 learner records, 0 validation errors', ipAddress: '192.168.5.62', severity: 'Info' },
  { id: 'AUD-1038', timestamp: '07 Jun 2026 14:10:22', user: 'Sarah Collins', userRole: 'Coach', action: 'Learner Record Updated', entityType: 'User', entity: 'User Sophie Williams', details: 'Updated learner profile — changed coaching frequency from bi-weekly to weekly', ipAddress: '192.168.7.41', severity: 'Info' },
  { id: 'AUD-1037', timestamp: '07 Jun 2026 11:25:17', user: 'Rachel Oduya', userRole: 'Tutor', action: 'Assignment Graded', entityType: 'Evidence', entity: 'EV-2815', details: 'Graded reflection assignment with score 87/100. Feedback: Strong analysis of agile practices', ipAddress: '192.168.4.28', severity: 'Info' },
  { id: 'AUD-1036', timestamp: '06 Jun 2026 17:10:05', user: 'Admin', userRole: 'System', action: 'Failed Login Attempt', entityType: 'User', entity: 'User Account — j.thompson@employer.com', details: '3 failed login attempts from IP 91.23.45.67 — account temporarily locked for 15 minutes', ipAddress: '91.23.45.67', severity: 'Warning' },
  { id: 'AUD-1035', timestamp: '06 Jun 2026 15:33:48', user: 'Crispin Jones', userRole: 'Tutor', action: 'Session Attendance Recorded', entityType: 'Review', entity: 'Session #SES-882', details: 'Recorded attendance for BA-L3 cohort — 12 present, 1 absent (unauthorised), 1 late', ipAddress: '192.168.4.31', severity: 'Info' },
  { id: 'AUD-1034', timestamp: '06 Jun 2026 10:02:11', user: 'Rebecca Holmes', userRole: 'Compliance Officer', action: 'Funding Risk Flagged', entityType: 'Compliance', entity: 'Learner Harvey Dunn', details: 'Funding risk identified — OTJH significantly below expected threshold (14% vs 35% expected)', ipAddress: '192.168.3.45', severity: 'Warning' },
  { id: 'AUD-1033', timestamp: '05 Jun 2026 12:44:30', user: 'Daniel Foster', userRole: 'Coach', action: 'Witness Statement Validated', entityType: 'Evidence', entity: 'EV-2836', details: 'Validated employer witness statement for Zara Iqbal — confirms employee relations competency', ipAddress: '192.168.7.18', severity: 'Info' },
  { id: 'AUD-1032', timestamp: '05 Jun 2026 09:18:55', user: 'Patricia Stone', userRole: 'Auditor', action: 'Compliance Flag Resolved', entityType: 'Compliance', entity: 'Flag #FLG-091', details: 'Resolved compliance flag — missing signature now obtained from employer (Bayside Retail Ltd)', ipAddress: '192.168.12.8', severity: 'Info' },
];

const severityColour = (s: AuditEntry['severity']) => {
  switch (s) {
    case 'Critical': return 'bg-red-100 text-red-700';
    case 'Warning': return 'bg-amber-100 text-amber-700';
    case 'Info': return 'bg-emerald-100 text-emerald-700';
    default: return '';
  }
};

const entityTypeColour = (e: AuditEntry['entityType']) => {
  switch (e) {
    case 'Evidence': return 'bg-primary-100 text-primary-700';
    case 'Review': return 'bg-accent-100 text-accent-700';
    case 'Enrolment': return 'bg-violet-100 text-violet-700';
    case 'User': return 'bg-secondary-100 text-secondary-700';
    case 'Compliance': return 'bg-rose-100 text-rose-700';
    case 'Signature': return 'bg-emerald-100 text-emerald-700';
    case 'Configuration': return 'bg-foreground-100 text-foreground-500';
    default: return '';
  }
};

export default function AuditorTrailPage() {
  const [search, setSearch] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<string>('All');
  const [filterEntity, setFilterEntity] = useState<string>('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = AUDIT_TRAIL.filter(e => {
    const matchSearch = e.id.toLowerCase().includes(search.toLowerCase()) || e.user.toLowerCase().includes(search.toLowerCase()) || e.entity.toLowerCase().includes(search.toLowerCase()) || e.action.toLowerCase().includes(search.toLowerCase());
    const matchSeverity = filterSeverity === 'All' || e.severity === filterSeverity;
    const matchEntity = filterEntity === 'All' || e.entityType === filterEntity;
    return matchSearch && matchSeverity && matchEntity;
  });

  const totalEntries = AUDIT_TRAIL.length;
  const criticalCount = AUDIT_TRAIL.filter(e => e.severity === 'Critical').length;
  const warningCount = AUDIT_TRAIL.filter(e => e.severity === 'Warning').length;

  return (
    <WorkspaceShell role="auditor" roleLabel={auditorConfig.label} navItems={auditorConfig.items} workspaceLabel={auditorConfig.workspaceLabel} pageTitle="Audit Trail" pageSubtitle="Complete audit trail of all platform actions — filter by entity type, severity, user and date range" userName="Patricia Stone" userRole="External Auditor">
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Entries', value: String(totalEntries), icon: 'ri-history-line', colour: 'primary' },
            { label: 'Critical', value: String(criticalCount), icon: 'ri-error-warning-line', colour: 'red' },
            { label: 'Warnings', value: String(warningCount), icon: 'ri-alert-line', colour: 'amber' },
            { label: 'Date Range', value: '02-10 Jun', icon: 'ri-calendar-2-line', colour: 'emerald' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.colour === 'primary' ? 'bg-primary-100 text-primary-600' : s.colour === 'red' ? 'bg-red-100 text-red-600' : s.colour === 'amber' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                <i className={`${s.icon} text-sm`}></i>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search audit ID, user, entity, action..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:border-primary-400 cursor-pointer">
              <option>All Severities</option>
              <option>Critical</option>
              <option>Warning</option>
              <option>Info</option>
            </select>
            <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:border-primary-400 cursor-pointer">
              <option>All Entities</option>
              <option>Evidence</option>
              <option>Review</option>
              <option>Enrolment</option>
              <option>User</option>
              <option>Compliance</option>
              <option>Signature</option>
              <option>Configuration</option>
            </select>
            <button className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
              <i className="ri-download-line mr-1"></i> Export CSV
            </button>
          </div>
        </div>

        {/* Audit Trail Table */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-background-100 text-[11px] text-foreground-400 uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium">ID</th>
                  <th className="text-left px-4 py-3 font-medium">Timestamp</th>
                  <th className="text-left px-4 py-3 font-medium">User</th>
                  <th className="text-left px-4 py-3 font-medium">Action</th>
                  <th className="text-left px-4 py-3 font-medium">Entity</th>
                  <th className="text-left px-4 py-3 font-medium">Severity</th>
                  <th className="text-right px-4 py-3 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(entry => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <>
                      <tr key={entry.id} className="border-b border-background-50 hover:bg-background-50/50 transition-smooth">
                        <td className="px-4 py-3 text-foreground-400 font-mono text-[11px]">{entry.id}</td>
                        <td className="px-4 py-3 text-foreground-600 font-mono text-[11px]">{entry.timestamp}</td>
                        <td className="px-4 py-3">
                          <span className="text-foreground-800 font-medium">{entry.user}</span>
                          <p className="text-[10px] text-foreground-400">{entry.userRole}</p>
                        </td>
                        <td className="px-4 py-3 text-foreground-700">{entry.action}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full ${entityTypeColour(entry.entityType)}`}>{entry.entityType}</span>
                          <p className="text-foreground-600 mt-0.5">{entry.entity}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${entry.severity === 'Critical' ? 'bg-red-500' : entry.severity === 'Warning' ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${severityColour(entry.severity)}`}>{entry.severity}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => setExpandedId(isExpanded ? null : entry.id)} className="w-6 h-6 flex items-center justify-center bg-background-100 rounded-md hover:bg-background-200 transition-colors cursor-pointer">
                            <i className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500 text-xs' : 'ri-arrow-down-s-line text-foreground-500 text-xs'}></i>
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="bg-background-100/50 px-4 py-3 border-b border-background-100">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[12px]">
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-1 font-medium">Details</p>
                                <p className="text-foreground-700">{entry.details}</p>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-1 font-medium">IP Address</p>
                                <p className="text-foreground-700 font-mono">{entry.ipAddress}</p>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-1 font-medium">Actions</p>
                                <div className="flex items-center gap-2">
                                  <button className="px-2.5 py-1 bg-background-50 border border-background-200 rounded-md text-[11px] text-foreground-600 hover:bg-background-100 cursor-pointer whitespace-nowrap">
                                    <i className="ri-file-copy-line mr-1"></i> View Full
                                  </button>
                                  <button className="px-2.5 py-1 bg-background-50 border border-background-200 rounded-md text-[11px] text-foreground-600 hover:bg-background-100 cursor-pointer whitespace-nowrap">
                                    <i className="ri-flag-line mr-1"></i> Flag
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="w-14 h-14 bg-background-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <i className="ri-history-line text-foreground-300 text-2xl"></i>
            </div>
            <p className="text-sm font-medium text-foreground-600">No audit trail entries found</p>
            <p className="text-[12px] text-foreground-400 mt-1">Try adjusting your filters</p>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}