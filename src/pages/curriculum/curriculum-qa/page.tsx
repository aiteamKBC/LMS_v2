import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';

// ─────────────────── Types ───────────────────
type ReviewStatus = 'Pending' | 'In Review' | 'Approved' | 'Rejected' | 'Needs Revision';
type FindingSeverity = 'Critical' | 'Major' | 'Minor' | 'Advisory';
type FindingStatus = 'Open' | 'In Progress' | 'Resolved' | 'Waived';
type VersionStatus = 'Draft' | 'In QA' | 'Approved' | 'Published' | 'Rejected' | 'Archived';

interface ProgrammeVersion {
  id: string;
  programme: string;
  standard: string;
  version: string;
  level: number;
  submittedBy: string;
  submittedDate: string;
  status: VersionStatus;
  reviewer: string;
  reviewDate?: string;
  findingsCount: { critical: number; major: number; minor: number };
  changesSummary: string[];
  qaCycles: QACycle[];
}

interface QACycle {
  id: string;
  round: number;
  startDate: string;
  endDate?: string;
  status: ReviewStatus;
  reviewer: string;
  checklist: ChecklistItem[];
  summary?: string;
}

interface ChecklistItem {
  id: string;
  section: string;
  item: string;
  status: 'Pass' | 'Fail' | 'Pending' | 'N/A';
  notes?: string;
}

interface Finding {
  id: string;
  programmeId: string;
  programme: string;
  version: string;
  cycleRound: number;
  severity: FindingSeverity;
  status: FindingStatus;
  section: string;
  description: string;
  owner: string;
  raisedDate: string;
  dueDate: string;
  resolvedDate?: string;
  resolution?: string;
}

// ─────────────────── Mock Data ───────────────────
const QA_CHECKLIST_TEMPLATE: Omit<ChecklistItem, 'status' | 'notes'>[] = [
  { id: 'c1', section: 'Programme Structure', item: 'All modules align to IfATE Standard KSBs' },
  { id: 'c2', section: 'Programme Structure', item: 'Module sequence is pedagogically sound' },
  { id: 'c3', section: 'Programme Structure', item: 'Total guided learning hours meet funding band requirements' },
  { id: 'c4', section: 'Assessment Design', item: 'Assessment criteria are clear and measurable' },
  { id: 'c5', section: 'Assessment Design', item: 'EPA requirements explicitly addressed in Module 4+' },
  { id: 'c6', section: 'Assessment Design', item: 'Formative and summative assessment balance is appropriate' },
  { id: 'c7', section: 'Content Quality', item: 'All resources reference current legislation and industry standards' },
  { id: 'c8', section: 'Content Quality', item: 'Case studies and examples are employer-relevant' },
  { id: 'c9', section: 'Content Quality', item: 'Inclusive language and accessibility standards met' },
  { id: 'c10', section: 'OTJH', item: 'OTJH activities are clearly mapped per week' },
  { id: 'c11', section: 'OTJH', item: 'OTJH total meets 20% minimum requirement' },
  { id: 'c12', section: 'Compliance', item: 'Funding rules compliance confirmed (ESFA)' },
  { id: 'c13', section: 'Compliance', item: 'Prevent and safeguarding content embedded' },
  { id: 'c14', section: 'Compliance', item: 'British Values and CEIAG coverage evident' },
];

const PROGRAMME_VERSIONS: ProgrammeVersion[] = [
  {
    id: 'pv-ba-21', programme: 'Business Administrator', standard: 'ST0070', version: 'v2.1', level: 3,
    submittedBy: 'Rachel Myers', submittedDate: '01 Jun 2026', status: 'In QA',
    reviewer: 'Tom Bradley', reviewDate: '04 Jun 2026',
    findingsCount: { critical: 0, major: 1, minor: 2 },
    changesSummary: ['Updated Module 3 KSB mapping to align with 2025 standard revision', 'Added 3 new employer case studies in Module 2', 'Revised OTJH activity log template'],
    qaCycles: [{
      id: 'qc1', round: 1, startDate: '04 Jun 2026', status: 'In Review', reviewer: 'Tom Bradley',
      checklist: QA_CHECKLIST_TEMPLATE.map((item, i) => ({
        ...item,
        status: i < 8 ? (i === 4 ? 'Fail' : 'Pass') : 'Pending',
        notes: i === 4 ? 'EPA preparation section in Module 3 does not explicitly reference EPA gateway criteria' : undefined,
      })),
      summary: 'Round 1 in progress. 1 major finding raised regarding EPA gateway criteria in Module 3.',
    }],
  },
  {
    id: 'pv-me-21', programme: 'Marketing Executive', standard: 'ST0280', version: 'v2.1', level: 4,
    submittedBy: 'Rachel Myers', submittedDate: '15 May 2026', status: 'Approved',
    reviewer: 'Tom Bradley', reviewDate: '22 May 2026',
    findingsCount: { critical: 0, major: 0, minor: 1 },
    changesSummary: ['New digital marketing content for Module 3', 'Updated analytics tools references to 2025 versions', 'Minor grammar corrections across all modules'],
    qaCycles: [{
      id: 'qc1', round: 1, startDate: '16 May 2026', endDate: '22 May 2026', status: 'Approved', reviewer: 'Tom Bradley',
      checklist: QA_CHECKLIST_TEMPLATE.map(item => ({ ...item, status: 'Pass' as const })),
      summary: 'All 14 checklist items passed. 1 advisory note on font consistency in Module 2 slides — accepted as cosmetic.',
    }],
  },
  {
    id: 'pv-dt-12', programme: 'Data Technician', standard: 'ST0118', version: 'v1.2', level: 3,
    submittedBy: 'James Cooper', submittedDate: '10 May 2026', status: 'Rejected',
    reviewer: 'Tom Bradley', reviewDate: '14 May 2026',
    findingsCount: { critical: 1, major: 2, minor: 3 },
    changesSummary: ['Updated Python content for v3.12', 'New data ethics module', 'Revised assessment brief'],
    qaCycles: [{
      id: 'qc1', round: 1, startDate: '11 May 2026', endDate: '14 May 2026', status: 'Rejected', reviewer: 'Tom Bradley',
      checklist: QA_CHECKLIST_TEMPLATE.map((item, i) => ({
        ...item,
        status: [2, 4, 7, 10, 11].includes(i) ? 'Fail' as const : 'Pass' as const,
        notes: i === 2 ? 'CRITICAL: Total GLH is 487 hours — minimum for ST0118 is 520 hours' : i === 4 ? 'EPA criteria absent from Modules 1–3' : undefined,
      })),
      summary: 'REJECTED — Critical finding: GLH below minimum threshold. Major findings in EPA mapping and OTJH documentation. Programme must be revised and resubmitted.',
    }],
  },
  {
    id: 'pv-sw-13', programme: 'Software Developer', standard: 'ST0116', version: 'v1.3', level: 4,
    submittedBy: 'Mike Harrison', submittedDate: '28 Apr 2026', status: 'Published',
    reviewer: 'Tom Bradley', reviewDate: '05 May 2026',
    findingsCount: { critical: 0, major: 0, minor: 0 },
    changesSummary: ['Updated AWS and cloud content', 'New agile delivery section', 'EPA reflection activities added'],
    qaCycles: [{
      id: 'qc1', round: 1, startDate: '29 Apr 2026', endDate: '05 May 2026', status: 'Approved', reviewer: 'Tom Bradley',
      checklist: QA_CHECKLIST_TEMPLATE.map(item => ({ ...item, status: 'Pass' as const })),
      summary: 'Clean pass across all 14 criteria. Approved for immediate publishing.',
    }],
  },
  {
    id: 'pv-pm-11', programme: 'Project Manager', standard: 'ST0723', version: 'v1.1', level: 4,
    submittedBy: 'Rachel Myers', submittedDate: '20 Jun 2026', status: 'Draft',
    reviewer: 'TBC', reviewDate: undefined,
    findingsCount: { critical: 0, major: 0, minor: 0 },
    changesSummary: ['New risk management framework aligned to APM', 'Updated EPA portfolio guidance'],
    qaCycles: [],
  },
];

const FINDINGS: Finding[] = [
  { id: 'f1', programmeId: 'pv-dt-12', programme: 'Data Technician', version: 'v1.2', cycleRound: 1, severity: 'Critical', status: 'Open', section: 'Programme Structure', description: 'Total Guided Learning Hours is 487 — minimum requirement for ST0118 is 520 hours. Programme cannot be approved in current state.', owner: 'James Cooper', raisedDate: '14 May 2026', dueDate: '21 May 2026' },
  { id: 'f2', programmeId: 'pv-dt-12', programme: 'Data Technician', version: 'v1.2', cycleRound: 1, severity: 'Major', status: 'In Progress', section: 'Assessment Design', description: 'EPA preparation criteria are absent from Modules 1–3. Learners cannot demonstrate EPA readiness without earlier scaffolding.', owner: 'James Cooper', raisedDate: '14 May 2026', dueDate: '28 May 2026' },
  { id: 'f3', programmeId: 'pv-dt-12', programme: 'Data Technician', version: 'v1.2', cycleRound: 1, severity: 'Major', status: 'Open', section: 'OTJH', description: 'OTJH activities in Modules 2 and 4 are not mapped to specific weeks. Per-week OTJH allocation is mandatory.', owner: 'Mike Harrison', raisedDate: '14 May 2026', dueDate: '28 May 2026' },
  { id: 'f4', programmeId: 'pv-ba-21', programme: 'Business Administrator', version: 'v2.1', cycleRound: 1, severity: 'Major', status: 'In Progress', section: 'Assessment Design', description: 'Module 3 does not explicitly reference EPA gateway criteria. Learners need clear EPA readiness checkpoints.', owner: 'Rachel Myers', raisedDate: '05 Jun 2026', dueDate: '12 Jun 2026' },
  { id: 'f5', programmeId: 'pv-ba-21', programme: 'Business Administrator', version: 'v2.1', cycleRound: 1, severity: 'Minor', status: 'Open', section: 'Content Quality', description: 'Case study in Module 2, Unit 4 references legislation from 2019 — needs updating to reflect 2024 Employment Relations Act.', owner: 'Rachel Myers', raisedDate: '05 Jun 2026', dueDate: '19 Jun 2026' },
  { id: 'f6', programmeId: 'pv-ba-21', programme: 'Business Administrator', version: 'v2.1', cycleRound: 1, severity: 'Minor', status: 'Open', section: 'Compliance', description: 'British Values integration in Module 1 is implicit rather than explicit. Recommend adding a short dedicated activity.', owner: 'Rachel Myers', raisedDate: '05 Jun 2026', dueDate: '19 Jun 2026' },
  { id: 'f7', programmeId: 'pv-me-21', programme: 'Marketing Executive', version: 'v2.1', cycleRound: 1, severity: 'Minor', status: 'Resolved', section: 'Content Quality', description: 'Font inconsistency in Module 2 slide deck — Calibri and Arial mixed. Accepted as cosmetic; no functional impact.', owner: 'Rachel Myers', raisedDate: '17 May 2026', dueDate: '22 May 2026', resolvedDate: '21 May 2026', resolution: 'Accepted as cosmetic advisory. No action required for QA sign-off.' },
];

// ─────────────────── Helpers ───────────────────
const versionStatusColor = (s: VersionStatus) => {
  const map: Record<VersionStatus, string> = {
    Draft: 'bg-background-100 text-foreground-500',
    'In QA': 'bg-amber-100 text-amber-700',
    Approved: 'bg-emerald-100 text-emerald-700',
    Published: 'bg-primary-100 text-primary-700',
    Rejected: 'bg-red-100 text-red-700',
    Archived: 'bg-foreground-100 text-foreground-400',
  };
  return map[s] || 'bg-background-100 text-foreground-500';
};

const severityColor = (s: FindingSeverity) => {
  const map: Record<FindingSeverity, string> = {
    Critical: 'bg-red-100 text-red-700 border-red-200/50',
    Major: 'bg-amber-100 text-amber-700 border-amber-200/50',
    Minor: 'bg-secondary-100 text-secondary-700 border-secondary-200/50',
    Advisory: 'bg-background-100 text-foreground-500 border-foreground-200/60',
  };
  return map[s] || '';
};

const findingStatusColor = (s: FindingStatus) => {
  const map: Record<FindingStatus, string> = {
    Open: 'bg-red-50 text-red-600',
    'In Progress': 'bg-amber-50 text-amber-600',
    Resolved: 'bg-emerald-50 text-emerald-600',
    Waived: 'bg-foreground-100 text-foreground-400',
  };
  return map[s] || '';
};

const checklistStatusIcon = (s: ChecklistItem['status']) => {
  if (s === 'Pass') return <i className="ri-checkbox-circle-line text-emerald-500 text-sm"></i>;
  if (s === 'Fail') return <i className="ri-close-circle-line text-red-500 text-sm"></i>;
  if (s === 'N/A') return <i className="ri-forbid-line text-foreground-300 text-sm"></i>;
  return <i className="ri-time-line text-amber-400 text-sm"></i>;
};

// ─────────────────── Component ───────────────────
export default function CurriculumQAPage() {
  const [activeTab, setActiveTab] = useState<'versions' | 'findings' | 'checklist'>('versions');
  const [versions, setVersions] = useState<ProgrammeVersion[]>(PROGRAMME_VERSIONS);
  const [selectedVersion, setSelectedVersion] = useState<ProgrammeVersion | null>(null);
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterSeverity, setFilterSeverity] = useState('All');
  const [notification, setNotification] = useState<{ type: 'success' | 'warning'; text: string } | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvalNote, setApprovalNote] = useState('');

  const stats = {
    total: versions.length,
    inQa: versions.filter(v => v.status === 'In QA').length,
    approved: versions.filter(v => v.status === 'Approved' || v.status === 'Published').length,
    rejected: versions.filter(v => v.status === 'Rejected').length,
    openFindings: FINDINGS.filter(f => f.status === 'Open').length,
    criticalFindings: FINDINGS.filter(f => f.severity === 'Critical' && f.status !== 'Resolved').length,
  };

  const filteredVersions = versions.filter(v => filterStatus === 'All' || v.status === filterStatus);
  const filteredFindings = FINDINGS.filter(f => {
    if (filterSeverity !== 'All' && f.severity !== filterSeverity) return false;
    return true;
  });

  const handleApproveVersion = (v: ProgrammeVersion) => {
    setVersions(prev => prev.map(x => x.id === v.id ? { ...x, status: 'Approved' as VersionStatus, reviewer: 'Tom Bradley', reviewDate: '11 Jun 2026' } : x));
    setSelectedVersion(prev => prev?.id === v.id ? { ...prev, status: 'Approved' as VersionStatus, reviewer: 'Tom Bradley', reviewDate: '11 Jun 2026' } : prev);
    setNotification({ type: 'success', text: `${v.programme} ${v.version} approved and ready for publishing. Approval note recorded.` });
    setApprovingId(null);
    setApprovalNote('');
    setTimeout(() => setNotification(null), 5000);
  };

  const handleRejectVersion = (v: ProgrammeVersion) => {
    setVersions(prev => prev.map(x => x.id === v.id ? { ...x, status: 'Rejected' as VersionStatus, reviewer: 'Tom Bradley', reviewDate: '11 Jun 2026' } : x));
    setSelectedVersion(prev => prev?.id === v.id ? { ...prev, status: 'Rejected' as VersionStatus, reviewer: 'Tom Bradley', reviewDate: '11 Jun 2026' } : prev);
    setNotification({ type: 'warning', text: `${v.programme} ${v.version} rejected. Curriculum team notified with findings.` });
    setApprovingId(null);
    setApprovalNote('');
    setTimeout(() => setNotification(null), 5000);
  };

  const selectedVersionFindings = selectedVersion ? FINDINGS.filter(f => f.programmeId === selectedVersion.id) : [];
  const selectedCycle = selectedVersion?.qaCycles[selectedVersion.qaCycles.length - 1];

  return (
    <WorkspaceShell
      role="curriculum" roleLabel="Curriculum Designer"
      navItems={curriculumNavItems} workspaceLabel="Curriculum Studio"
      pageTitle="Curriculum QA" pageSubtitle="Review cycles, findings management and programme version approval workflow"
      userName="Rachel Myers" userRole="Curriculum Designer"
    >
      <div className="p-6 space-y-5">

        {/* Notification */}
        {notification && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-[13px] font-medium border ${notification.type === 'success' ? 'bg-emerald-50 border-emerald-200/60 text-emerald-700' : 'bg-amber-50 border-amber-200/60 text-amber-700'}`}>
            <i className={`${notification.type === 'success' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'} text-base`}></i>
            {notification.text}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Total Versions', value: stats.total, icon: 'ri-stack-line', color: 'bg-background-100 text-foreground-600' },
            { label: 'In QA Review', value: stats.inQa, icon: 'ri-search-eye-line', color: 'bg-amber-100 text-amber-700' },
            { label: 'Approved', value: stats.approved, icon: 'ri-checkbox-circle-line', color: 'bg-emerald-100 text-emerald-700' },
            { label: 'Rejected', value: stats.rejected, icon: 'ri-close-circle-line', color: 'bg-red-100 text-red-700' },
            { label: 'Open Findings', value: stats.openFindings, icon: 'ri-error-warning-line', color: 'bg-amber-100 text-amber-700' },
            { label: 'Critical Issues', value: stats.criticalFindings, icon: 'ri-alarm-warning-line', color: 'bg-red-100 text-red-700' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 ${s.color}`}>
                <i className={`${s.icon} text-xs`}></i>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium leading-tight">{s.label}</p>
              <p className="text-xl font-heading font-bold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-0.5 bg-background-100 rounded-xl w-fit">
          {([['versions', 'Programme Versions', 'ri-stack-line'], ['findings', 'QA Findings', 'ri-error-warning-line'], ['checklist', 'QA Checklist', 'ri-check-double-line']] as const).map(([t, label, icon]) => (
            <button key={t} onClick={() => setActiveTab(t)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${activeTab === t ? 'bg-background-50 text-foreground-900' : 'text-foreground-400 hover:text-foreground-700'}`}>
              <i className={`${icon} text-sm`}></i>{label}
              {t === 'findings' && stats.openFindings > 0 && <span className="bg-amber-400 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full">{stats.openFindings}</span>}
            </button>
          ))}
        </div>

        {/* ── TAB: Programme Versions ── */}
        {activeTab === 'versions' && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            {/* Version List */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center gap-2">
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="flex-1 px-3 py-2 bg-background-50 border border-background-200 rounded-xl text-[12px] text-foreground-700 outline-none focus:border-primary-400 cursor-pointer">
                  {['All', 'Draft', 'In QA', 'Approved', 'Published', 'Rejected'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              {filteredVersions.map(v => (
                <div
                  key={v.id}
                  onClick={() => setSelectedVersion(selectedVersion?.id === v.id ? null : v)}
                  className={`p-4 rounded-xl border cursor-pointer transition-smooth ${selectedVersion?.id === v.id ? 'bg-primary-50 border-primary-300' : 'bg-background-50 border-foreground-200/60 hover:border-background-300 hover:bg-background-100/50'}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="text-[13px] font-semibold text-foreground-900">{v.programme}</p>
                      <p className="text-[10px] text-foreground-400 mt-0.5">{v.standard} · Level {v.level} · {v.version}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${versionStatusColor(v.status)}`}>{v.status}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-foreground-400">
                    <span>Submitted {v.submittedDate}</span>
                    {(v.findingsCount.critical + v.findingsCount.major + v.findingsCount.minor) > 0 && (
                      <span className="flex items-center gap-1">
                        {v.findingsCount.critical > 0 && <span className="text-red-600 font-semibold">{v.findingsCount.critical} critical</span>}
                        {v.findingsCount.major > 0 && <span className="text-amber-600 font-semibold">{v.findingsCount.major} major</span>}
                        {v.findingsCount.minor > 0 && <span className="text-foreground-400">{v.findingsCount.minor} minor</span>}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Version Detail */}
            <div className="lg:col-span-3">
              {selectedVersion ? (
                <div className="space-y-4">
                  {/* Header */}
                  <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <h3 className="text-base font-heading font-semibold text-foreground-900">{selectedVersion.programme} — {selectedVersion.version}</h3>
                        <p className="text-[12px] text-foreground-400 mt-0.5">{selectedVersion.standard} · Level {selectedVersion.level} · Submitted {selectedVersion.submittedDate} by {selectedVersion.submittedBy}</p>
                      </div>
                      <span className={`text-[11px] font-bold px-3 py-1 rounded-full shrink-0 ${versionStatusColor(selectedVersion.status)}`}>{selectedVersion.status}</span>
                    </div>

                    {/* Changes Summary */}
                    <div className="mb-4">
                      <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wide mb-2">Changes in this version</p>
                      <ul className="space-y-1">
                        {selectedVersion.changesSummary.map((c, i) => (
                          <li key={i} className="flex items-start gap-2 text-[12px] text-foreground-600">
                            <i className="ri-arrow-right-s-line text-primary-400 mt-0.5 shrink-0"></i>{c}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Approval Actions */}
                    {(selectedVersion.status === 'In QA' || selectedVersion.status === 'Draft') && (
                      approvingId === selectedVersion.id ? (
                        <div className="p-3 bg-background-100/60 border border-foreground-200/60 rounded-xl space-y-3">
                          <p className="text-[11px] font-semibold text-foreground-600">QA Decision Note (optional)</p>
                          <textarea value={approvalNote} onChange={e => setApprovalNote(e.target.value)} rows={2} placeholder="Add notes for the curriculum team..." className="w-full px-3 py-2 border border-background-200 rounded-lg bg-background-50 text-[12px] text-foreground-700 placeholder:text-foreground-300 outline-none focus:border-primary-400 resize-none" />
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleApproveVersion(selectedVersion)} className="flex-1 py-2 bg-emerald-500 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap">
                              <i className="ri-checkbox-circle-line mr-1"></i>Approve Version
                            </button>
                            <button onClick={() => handleRejectVersion(selectedVersion)} className="flex-1 py-2 bg-red-500 text-white rounded-lg text-[11px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap">
                              <i className="ri-close-circle-line mr-1"></i>Reject Version
                            </button>
                            <button onClick={() => setApprovingId(null)} className="px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[11px] text-foreground-500 hover:bg-background-200 cursor-pointer whitespace-nowrap">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setApprovingId(selectedVersion.id)} className="w-full py-2.5 bg-primary-500 text-white rounded-xl text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                          <i className="ri-shield-check-line mr-1.5"></i>Begin QA Decision
                        </button>
                      )
                    )}
                    {selectedVersion.status === 'Approved' && (
                      <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200/50 rounded-xl">
                        <i className="ri-checkbox-circle-line text-emerald-600 text-base"></i>
                        <span className="text-[12px] text-emerald-700 font-medium">Approved by {selectedVersion.reviewer} on {selectedVersion.reviewDate}. Ready for publishing.</span>
                      </div>
                    )}
                    {selectedVersion.status === 'Rejected' && (
                      <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200/50 rounded-xl">
                        <i className="ri-close-circle-line text-red-600 text-base"></i>
                        <span className="text-[12px] text-red-700 font-medium">Rejected on {selectedVersion.reviewDate}. Critical findings must be resolved before resubmission.</span>
                      </div>
                    )}
                    {selectedVersion.status === 'Published' && (
                      <div className="flex items-center gap-2 p-3 bg-primary-50 border border-primary-200/50 rounded-xl">
                        <i className="ri-book-open-line text-primary-600 text-base"></i>
                        <span className="text-[12px] text-primary-700 font-medium">Published and live for cohort assignment.</span>
                      </div>
                    )}
                  </div>

                  {/* QA Cycles */}
                  {selectedCycle && (
                    <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-heading font-semibold text-foreground-900">QA Review — Round {selectedCycle.round}</h4>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${selectedCycle.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : selectedCycle.status === 'Rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{selectedCycle.status}</span>
                      </div>
                      {selectedCycle.summary && (
                        <p className="text-[12px] text-foreground-600 mb-4 p-3 bg-background-100/60 rounded-lg border border-background-200/30">{selectedCycle.summary}</p>
                      )}
                      <div className="space-y-1">
                        {Object.entries(
                          selectedCycle.checklist.reduce((acc, item) => {
                            if (!acc[item.section]) acc[item.section] = [];
                            acc[item.section].push(item);
                            return acc;
                          }, {} as Record<string, ChecklistItem[]>)
                        ).map(([section, items]) => (
                          <div key={section}>
                            <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wide py-2">{section}</p>
                            {items.map(item => (
                              <div key={item.id} className={`flex items-start gap-3 p-2.5 rounded-lg mb-1 ${item.status === 'Fail' ? 'bg-red-50/50 border border-red-200/40' : item.status === 'Pass' ? 'bg-emerald-50/30' : 'bg-background-100/50'}`}>
                                <span className="mt-0.5 shrink-0">{checklistStatusIcon(item.status)}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11px] text-foreground-700">{item.item}</p>
                                  {item.notes && <p className="text-[10px] text-red-600 mt-0.5 italic">{item.notes}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Findings for this version */}
                  {selectedVersionFindings.length > 0 && (
                    <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5">
                      <h4 className="text-sm font-heading font-semibold text-foreground-900 mb-3">Findings ({selectedVersionFindings.length})</h4>
                      <div className="space-y-2">
                        {selectedVersionFindings.map(f => (
                          <div key={f.id} className={`p-3 rounded-xl border ${f.severity === 'Critical' ? 'bg-red-50 border-red-200/50' : f.severity === 'Major' ? 'bg-amber-50 border-amber-200/50' : 'bg-background-100/60 border-foreground-200/60'}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${severityColor(f.severity)}`}>{f.severity}</span>
                                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${findingStatusColor(f.status)}`}>{f.status}</span>
                                  <span className="text-[10px] text-foreground-400">{f.section}</span>
                                </div>
                                <p className="text-[12px] text-foreground-700">{f.description}</p>
                                {f.resolution && <p className="text-[10px] text-emerald-600 mt-1 italic">Resolution: {f.resolution}</p>}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 mt-2 text-[10px] text-foreground-400">
                              <span>Owner: {f.owner}</span>
                              <span>Due: {f.dueDate}</span>
                              {f.resolvedDate && <span>Resolved: {f.resolvedDate}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-64 bg-background-50 rounded-2xl border border-foreground-200/60 border-dashed">
                  <div className="text-center">
                    <i className="ri-stack-line text-3xl text-foreground-200 block mb-2"></i>
                    <p className="text-[13px] text-foreground-400">Select a programme version to review</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB: QA Findings ── */}
        {activeTab === 'findings' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {['All', 'Critical', 'Major', 'Minor', 'Advisory'].map(s => (
                <button key={s} onClick={() => setFilterSeverity(s)} className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterSeverity === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:bg-background-200'}`}>{s}</button>
              ))}
            </div>
            <div className="space-y-2">
              {filteredFindings.map(f => (
                <div key={f.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 hover:bg-background-100/40 transition-smooth">
                  <div className="flex items-start gap-4">
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <span className={`text-[9px] font-bold px-2 py-1 rounded-lg border ${severityColor(f.severity)}`}>{f.severity}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[13px] font-semibold text-foreground-900">{f.programme} {f.version}</span>
                        <span className="text-[11px] text-foreground-400">· Round {f.cycleRound} · {f.section}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ml-auto ${findingStatusColor(f.status)}`}>{f.status}</span>
                      </div>
                      <p className="text-[12px] text-foreground-700">{f.description}</p>
                      {f.resolution && <p className="text-[11px] text-emerald-600 mt-1.5 italic">✓ {f.resolution}</p>}
                      <div className="flex items-center gap-4 mt-2 text-[10px] text-foreground-400">
                        <span>Owner: <strong className="text-foreground-600">{f.owner}</strong></span>
                        <span>Raised: {f.raisedDate}</span>
                        <span>Due: <strong className={f.status === 'Open' ? 'text-red-600' : 'text-foreground-600'}>{f.dueDate}</strong></span>
                        {f.resolvedDate && <span>Resolved: {f.resolvedDate}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TAB: QA Checklist Template ── */}
        {activeTab === 'checklist' && (
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Standard QA Checklist</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">14 items across 5 sections — applied to every programme version review</p>
              </div>
              <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 cursor-pointer whitespace-nowrap">
                <i className="ri-download-line mr-1"></i>Export Checklist
              </button>
            </div>
            <div className="space-y-1">
              {Object.entries(
                QA_CHECKLIST_TEMPLATE.reduce((acc, item) => {
                  if (!acc[item.section]) acc[item.section] = [];
                  acc[item.section].push(item);
                  return acc;
                }, {} as Record<string, typeof QA_CHECKLIST_TEMPLATE[0][]>)
              ).map(([section, items]) => (
                <div key={section} className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wide">{section}</span>
                    <span className="text-[9px] bg-background-100 text-foreground-400 px-1.5 py-0.5 rounded">{items.length} items</span>
                  </div>
                  {items.map(item => (
                    <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg bg-background-100/50 border border-background-200/30 mb-1 hover:bg-background-100 transition-smooth">
                      <i className="ri-checkbox-blank-circle-line text-foreground-300 text-sm shrink-0"></i>
                      <p className="text-[12px] text-foreground-700">{item.item}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}