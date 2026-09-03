import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { getEvidenceDownloadUrl, uploadEvidence, type EvidenceRecord } from '@/api/evidence';
import type { LearnerDetail, LearnerKind } from '@/api/learnerDetail';

/* ═══════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════ */
type EvidenceStatus = 'Validated' | 'Pending tutor' | 'Needs work' | 'Draft' | 'Submitted';
type EvidenceType = 'Document' | 'Presentation' | 'Spreadsheet' | 'Reflection' | 'Quiz' | 'Meeting notes' | 'Workplace evidence' | 'Audio' | 'Image';

interface EvidenceDocument {
  name: string;
  status: 'Accepted' | 'Referred' | 'Pending';
  size: string;
  uploaded: string;
}

interface EvidenceItem {
  id: string;
  title: string;
  type: EvidenceType;
  module: string;
  week: number;
  weekLabel: string;
  sessionType: string;
  ksb: string[];
  otjh: number;
  status: EvidenceStatus;
  date: string;
  description?: string;
  progress?: number;
  documents?: EvidenceDocument[];
  tutorFeedback?: string;
  tutorName?: string;
  note?: string;
  fileId?: string;
  rawStatus?: string;
  sortDate?: number;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatEvidenceDate(value: string | null): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function recordType(record: EvidenceRecord): EvidenceType {
  const authoredType = record.trainingPlanDetails?.componentType?.toLowerCase() || '';
  if (record.contentType.startsWith('image/')) return 'Image';
  if (record.contentType.startsWith('audio/')) return 'Audio';
  if (authoredType.includes('quiz')) return 'Quiz';
  if (authoredType.includes('reflection')) return 'Reflection';
  if (authoredType.includes('meeting') || authoredType.includes('coaching')) return 'Meeting notes';
  if (authoredType.includes('workplace')) return 'Workplace evidence';
  if (authoredType.includes('presentation')) return 'Presentation';
  if (authoredType.includes('spreadsheet')) return 'Spreadsheet';
  return 'Document';
}

function recordStatus(status: string): EvidenceStatus {
  if (status === 'approved') return 'Validated';
  if (status === 'rejected') return 'Needs work';
  return 'Pending tutor';
}

function evidenceRecordToItem(record: EvidenceRecord): EvidenceItem {
  const details = record.trainingPlanDetails || {};
  const weekLabel = details.weekTitle || 'General evidence';
  const weekMatch = weekLabel.match(/\d+/);
  const week = weekMatch ? Number(weekMatch[0]) : 0;
  const status = recordStatus(record.status);
  const docStatus: EvidenceDocument['status'] = status === 'Validated' ? 'Accepted' : status === 'Needs work' ? 'Referred' : 'Pending';
  return {
    id: record.id,
    fileId: record.id,
    title: details.componentTitle || record.filename,
    type: recordType(record),
    module: details.moduleTitle || 'Programme evidence',
    week,
    weekLabel,
    sessionType: details.componentType || 'Evidence Upload',
    ksb: Array.isArray(details.ksbCodes) ? details.ksbCodes : [],
    otjh: Number(details.otjhHours) || 0,
    status,
    rawStatus: record.status,
    date: formatEvidenceDate(record.uploadedAt),
    sortDate: record.uploadedAt ? new Date(record.uploadedAt).getTime() : 0,
    description: details.evidenceDescription || `Uploaded file: ${record.filename}`,
    progress: status === 'Validated' ? 100 : status === 'Needs work' ? 0 : 50,
    documents: [{ name: record.filename, status: docStatus, size: formatBytes(record.sizeBytes), uploaded: formatEvidenceDate(record.uploadedAt) }],
    note: record.sectionRef ? `Evidence reference: ${record.sectionRef}` : undefined,
  };
}


const STATUS_CONFIG: Record<EvidenceStatus, { bg: string; text: string; dot: string; label: string }> = {
  Validated: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Validated' },
  'Pending tutor': { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Pending Tutor' },
  'Needs work': { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', label: 'Needs Work' },
  Draft: { bg: 'bg-background-100', text: 'text-foreground-400', dot: 'bg-foreground-300', label: 'Draft' },
  Submitted: { bg: 'bg-primary-50', text: 'text-primary-700', dot: 'bg-primary-500', label: 'Submitted' },
};

const TYPE_CONFIG: Record<string, { icon: string; bg: string; text: string }> = {
  Document: { icon: 'ri-file-text-line', bg: 'bg-primary-50', text: 'text-primary-700' },
  Presentation: { icon: 'ri-slideshow-3-line', bg: 'bg-accent-50', text: 'text-accent-700' },
  Spreadsheet: { icon: 'ri-table-2', bg: 'bg-secondary-50', text: 'text-secondary-700' },
  Reflection: { icon: 'ri-chat-quote-line', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  Quiz: { icon: 'ri-questionnaire-line', bg: 'bg-amber-50', text: 'text-amber-700' },
  'Meeting notes': { icon: 'ri-chat-1-line', bg: 'bg-background-100', text: 'text-foreground-600' },
  'Workplace evidence': { icon: 'ri-building-line', bg: 'bg-accent-50', text: 'text-accent-700' },
  Audio: { icon: 'ri-mic-line', bg: 'bg-secondary-50', text: 'text-secondary-700' },
  Image: { icon: 'ri-image-line', bg: 'bg-primary-50', text: 'text-primary-700' },
};

/* ── Build week lookup from training plan ── */
interface WeekInfo {
  weekNumber: number;
  moduleName: string;
  dateRange: string;
  ksbCodes: string[];
}

function buildWeekLookup(detail: LearnerDetail | null): WeekInfo[] {
  if (!detail) return [{ weekNumber: 1, moduleName: 'Programme', dateRange: '', ksbCodes: [] }];
  const weeks = new Map<string, WeekInfo>();
  detail.components.forEach((component, index) => {
    const label = component.week || `Week ${index + 1}`;
    const key = `${component.module || 'Programme'}::${label}`;
    const current = weeks.get(key);
    const ksbCodes = component.ksbMappings?.map(mapping => mapping.code).filter(Boolean) || [];
    if (current) {
      current.ksbCodes = Array.from(new Set([...current.ksbCodes, ...ksbCodes]));
    } else {
      weeks.set(key, { weekNumber: weeks.size + 1, moduleName: component.module || 'Programme', dateRange: label, ksbCodes });
    }
  });
  return Array.from(weeks.values()).sort((a, b) => a.weekNumber - b.weekNumber);
}

/* ── All KSBs with metadata ── */
interface KSBInfo { code: string; type: 'Knowledge' | 'Skill' | 'Behaviour'; label: string }
function buildAllKSBs(detail: LearnerDetail | null): KSBInfo[] {
  return (detail?.ksbs || []).map(ksb => ({
    code: ksb.code,
    type: (ksb.code.startsWith('K') ? 'Knowledge' : ksb.code.startsWith('S') ? 'Skill' : 'Behaviour') as KSBInfo['type'],
    label: ksb.description || ksb.code,
  })).sort((a, b) => a.code.localeCompare(b.code));
}

const KSB_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  Knowledge: { bg: 'bg-primary-50', text: 'text-primary-700' },
  Skill: { bg: 'bg-accent-50', text: 'text-accent-700' },
  Behaviour: { bg: 'bg-secondary-50', text: 'text-secondary-700' },
};

/* ═══════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

/* ── Stat Strip Card ── */
function StatStripCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  const colorMap: Record<string, { iconBg: string; iconText: string; accent: string }> = {
    emerald: { iconBg: 'bg-gradient-to-br from-[#b9f6db] via-[#34d399] to-[#059669] shadow-sm shadow-emerald-500/25', iconText: 'text-white', accent: 'text-emerald-700' },
    amber: { iconBg: 'bg-gradient-to-br from-[#f8dda0] via-[#d49a38] to-[#b27715] shadow-sm shadow-[#b27715]/25', iconText: 'text-white', accent: 'text-amber-700' },
    red: { iconBg: 'bg-gradient-to-br from-[#fecaca] via-[#f87171] to-[#dc2626] shadow-sm shadow-red-500/25', iconText: 'text-white', accent: 'text-red-700' },
    primary: { iconBg: 'bg-gradient-to-br from-[#d8c9ff] via-[#8b5cf6] to-[#5420a8] shadow-sm shadow-primary-500/25', iconText: 'text-white', accent: 'text-primary-700' },
    secondary: { iconBg: 'bg-gradient-to-br from-[#ddd6fe] via-[#a78bfa] to-[#6d28d9] shadow-sm shadow-secondary-500/25', iconText: 'text-white', accent: 'text-secondary-700' },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="coach-metric-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center gap-2.5 mb-2">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center ring-1 ring-black/5 ${c.iconBg} ${c.iconText}`}>
          <AppIcon className={`${icon} text-base`}></AppIcon>
        </span>
        <span className="text-xs text-foreground-400">{label}</span>
      </div>
      <p className={`text-xl font-heading font-bold ${c.accent}`}>{value}</p>
    </div>
  );
}

/* ── Evidence Card ── */
function EvidenceCard({ ev, onClick }: { ev: EvidenceItem; onClick: () => void }) {
  const st = STATUS_CONFIG[ev.status];
  const tp = TYPE_CONFIG[ev.type] || TYPE_CONFIG.Document;
  return (
    <div
      onClick={onClick}
      className="rounded-2xl border border-foreground-200/70 bg-background-50 p-5 cursor-pointer transition-all duration-200 hover:border-primary-200/50 hover:shadow-sm group"
    >
      <div className="flex items-start gap-3.5 mb-4">
        <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tp.bg} ${tp.text} transition-transform duration-200 group-hover:scale-105`}>
          <AppIcon className={`${tp.icon} text-lg`}></AppIcon>
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground-900 leading-snug line-clamp-2 group-hover:text-primary-700 transition-smooth">
              {ev.title}
            </h3>
          </div>
          <div className="flex items-center gap-2 mt-1.5 text-xs text-foreground-400">
            <span className="text-[10px] font-bold text-foreground-500 bg-background-100 px-1.5 py-0.5 rounded">{ev.weekLabel}</span>
            <span className="text-foreground-300">·</span>
            <span className="truncate">{ev.module}</span>
            <span className="text-foreground-300">·</span>
            <span>{ev.date}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-3 text-xs text-foreground-400">
        <span className="flex items-center gap-1">
          <AppIcon className="ri-hard-drive-2-line text-[10px]"></AppIcon>
          {ev.documents?.[0]?.size || 'Size unavailable'}
        </span>
        <span className="text-foreground-200">·</span>
        <span className="flex items-center gap-1">
          <AppIcon className="ri-file-list-line text-[10px]"></AppIcon>
          {ev.type}
        </span>
        {ev.otjh > 0 && <>
          <span className="text-foreground-200">·</span>
          <span className="flex items-center gap-1"><AppIcon className="ri-time-line text-[10px]" />{ev.otjh}h OTJH</span>
        </>}
      </div>
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {ev.ksb.map(code => {
          const kc = KSB_TYPE_COLORS[code.startsWith('K') ? 'Knowledge' : code.startsWith('S') ? 'Skill' : 'Behaviour'];
          return (
            <span key={code} className={`text-[10px] font-bold px-2 py-1 rounded-md ${kc.bg} ${kc.text} border border-current/10`}>
              {code}
            </span>
          );
        })}
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-foreground-200/40">
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${st.bg} ${st.text} border border-current/10`}>
          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`}></span>
          {st.label}
        </span>
        <AppIcon className="ri-arrow-right-line text-foreground-300 group-hover:text-primary-500 transition-smooth text-sm"></AppIcon>
      </div>
    </div>
  );
}

/* ── Evidence Row (List View) ── */
function EvidenceRow({ ev, onClick }: { ev: EvidenceItem; onClick: () => void }) {
  const st = STATUS_CONFIG[ev.status];
  const tp = TYPE_CONFIG[ev.type] || TYPE_CONFIG.Document;
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 p-4 rounded-xl border border-foreground-200/70 bg-background-50 cursor-pointer transition-all duration-200 hover:border-primary-200/50 hover:shadow-sm group"
    >
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tp.bg} ${tp.text}`}>
        <AppIcon className={`${tp.icon} text-lg`}></AppIcon>
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="text-sm font-semibold text-foreground-900 truncate group-hover:text-primary-700 transition-smooth">{ev.title}</h3>
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.bg} ${st.text} border border-current/10 shrink-0`}>
            <span className={`w-1 h-1 rounded-full ${st.dot}`}></span>
            {st.label}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-foreground-400">
          <span className="text-[10px] font-bold text-foreground-500 bg-background-100 px-1.5 py-0.5 rounded">{ev.weekLabel}</span>
          <span>{ev.module}</span>
          <span className="text-foreground-200">·</span>
          <span>{ev.date}</span>
          <span className="text-foreground-200">·</span>
          <span>{ev.documents?.[0]?.size || 'Size unavailable'}</span>
          <span className="text-foreground-200">·</span>
          <span>{ev.type}</span>
          {ev.otjh > 0 && <><span className="text-foreground-200">·</span><span>{ev.otjh}h OTJH</span></>}
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-1.5 shrink-0">
        {ev.ksb.map(code => {
          const kc = KSB_TYPE_COLORS[code.startsWith('K') ? 'Knowledge' : code.startsWith('S') ? 'Skill' : 'Behaviour'];
          return <span key={code} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${kc.bg} ${kc.text}`}>{code}</span>;
        })}
      </div>
      <AppIcon className="ri-arrow-right-s-line text-foreground-300 group-hover:text-primary-500 transition-smooth shrink-0 text-sm"></AppIcon>
    </div>
  );
}

/* ── File Preview Modal ── */
function FilePreviewModal({ item, onClose, onDownload, opening }: {
  item: EvidenceItem | null;
  onClose: () => void;
  onDownload: (item: EvidenceItem) => void;
  opening: boolean;
}) {
  if (!item) return null;
  const tp = TYPE_CONFIG[item.type] || TYPE_CONFIG.Document;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-background-50 rounded-2xl border border-foreground-200/60 shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 p-5 border-b border-foreground-200/60">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-10 h-10 rounded-xl ${tp.bg} ${tp.text} flex items-center justify-center shrink-0`}>
              <AppIcon className={`${tp.icon} text-lg`}></AppIcon>
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-heading font-semibold text-foreground-900 truncate">{item.title}</h3>
              <p className="text-xs text-foreground-400">{item.documents?.length ? `${item.documents.length} file(s)` : 'No files'}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center text-foreground-400 hover:text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer">
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {item.note && (
            <div className="bg-background-100/60 rounded-xl p-4">
              <h4 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-2">Note</h4>
              <p className="text-sm text-foreground-600 leading-relaxed">{item.note}</p>
            </div>
          )}
          {item.documents && item.documents.length > 0 ? (
            <div className="space-y-3">
              <h4 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider">Files</h4>
              {item.documents.map((doc, idx) => (
                <div key={idx} className="flex items-center gap-3 bg-background-100/60 rounded-xl p-4">
                  <span className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
                    <AppIcon className="ri-file-text-line text-primary-600 text-lg"></AppIcon>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground-900 truncate">{doc.name}</p>
                    <p className="text-xs text-foreground-400">{doc.size} · {doc.status}</p>
                  </div>
                  <button
                    onClick={() => onDownload(item)}
                    disabled={item.rawStatus !== 'approved' || opening}
                    className="px-3 py-2 rounded-lg bg-primary-500 text-background-50 dark:text-foreground-950 text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <AppIcon className={`${opening ? 'ri-loader-4-line animate-spin' : 'ri-download-line'} mr-1`}></AppIcon>
                    {opening ? 'Opening…' : item.rawStatus === 'approved' ? 'Open file' : 'Unavailable'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <span className="w-12 h-12 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-3">
                <AppIcon className="ri-file-list-3-line text-foreground-300 text-xl"></AppIcon>
              </span>
              <p className="text-sm font-medium text-foreground-500">No files uploaded</p>
              <p className="text-xs text-foreground-400 mt-1">Upload a file to see it here</p>
            </div>
          )}
          {item.description && (
            <div className="bg-background-100/60 rounded-xl p-4">
              <h4 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-2">Description</h4>
              <p className="text-sm text-foreground-600 leading-relaxed">{item.description}</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end p-5 border-t border-foreground-200/60">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-background-100 text-sm font-medium text-foreground-500 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT — tab content, no page chrome (the parent
   "My Progress" page owns the WorkspaceShell + page header).
   ═══════════════════════════════════════════════════════════════ */
export function EvidenceTab({
  learnerKind,
  learnerId,
  real,
  canProgress,
  showReadOnlyNotice,
  evidenceRecords,
  evidenceLoading,
  evidenceError,
  reloadEvidence,
}: {
  learnerKind: LearnerKind | undefined;
  learnerId: string | undefined;
  real: LearnerDetail | null;
  canProgress: boolean;
  showReadOnlyNotice: boolean;
  evidenceRecords: EvidenceRecord[];
  evidenceLoading: boolean;
  evidenceError: string | null;
  reloadEvidence: () => void | Promise<void>;
}) {
  const weekLookup = useMemo(() => buildWeekLookup(real), [real]);
  const allKsbs = useMemo(() => buildAllKSBs(real), [real]);
  const [activeFilter, setActiveFilter] = useState<'All' | 'Validated' | 'Pending' | 'Draft' | 'Needs work'>('All');
  const [filterType, setFilterType] = useState<'All' | EvidenceType>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedEvidence, setSelectedEvidence] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadWeek, setUploadWeek] = useState(4);
  const [uploadType, setUploadType] = useState<EvidenceType>('Document');
  const [uploadKSBs, setUploadKSBs] = useState<string[]>([]);
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadOtjh, setUploadOtjh] = useState(1.5);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [openingEvidenceId, setOpeningEvidenceId] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [showFilePreview, setShowFilePreview] = useState<string | null>(null);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  const allEvidence = useMemo(() => evidenceRecords.map(evidenceRecordToItem), [evidenceRecords]);

  const filtered = useMemo(() => {
    let list = [...allEvidence];
    if (activeFilter !== 'All') {
      if (activeFilter === 'Pending') list = list.filter(e => e.status === 'Pending tutor' || e.status === 'Submitted');
      else list = list.filter(e => e.status === activeFilter);
    }
    if (filterType !== 'All') list = list.filter(e => e.type === filterType);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e => e.title.toLowerCase().includes(q) || e.module.toLowerCase().includes(q) || e.ksb.some(k => k.toLowerCase().includes(q)) || String(e.week).includes(q));
    }
    list.sort((a, b) => (b.sortDate || 0) - (a.sortDate || 0));
    return list;
  }, [activeFilter, filterType, searchQuery, allEvidence]);

  const selectedItem = allEvidence.find(e => e.id === selectedEvidence);
  const previewItem = allEvidence.find(e => e.id === showFilePreview);

  const counts = useMemo(() => ({
    total: allEvidence.length,
    validated: allEvidence.filter(e => e.status === 'Validated').length,
    pending: allEvidence.filter(e => e.status === 'Pending tutor' || e.status === 'Submitted').length,
    draft: allEvidence.filter(e => e.status === 'Draft').length,
    needsWork: allEvidence.filter(e => e.status === 'Needs work').length,
  }), [allEvidence]);

  const hasActiveFilters = activeFilter !== 'All' || filterType !== 'All' || searchQuery.trim().length > 0;

  const handleUpload = async (files: File[]) => {
    if (!uploadTitle.trim() || files.length === 0 || uploading || !canProgress || !learnerKind || !learnerId) return;
    const weekInfo = weekLookup.find(w => w.weekNumber === uploadWeek);
    const moduleName = weekInfo?.moduleName || 'Programme';
    const sectionRef = `evidence-library-week-${uploadWeek}`;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of files) {
        await uploadEvidence(learnerKind, learnerId, file, sectionRef, {
          moduleTitle: moduleName,
          weekTitle: weekInfo?.dateRange || `Week ${uploadWeek}`,
          componentTitle: uploadTitle.trim(),
          componentType: uploadType,
          evidenceDescription: uploadDesc.trim() || null,
          ksbCodes: uploadKSBs.length > 0 ? uploadKSBs : (weekInfo?.ksbCodes || []).slice(0, 3),
          otjhHours: uploadOtjh,
        });
      }
      await reloadEvidence();
      setUploadTitle('');
      setUploadDesc('');
      setUploadKSBs([]);
      setUploadSuccess(true);
      window.setTimeout(() => {
        setUploadSuccess(false);
        setShowUploadModal(false);
      }, 800);
    } catch (error) {
      await reloadEvidence();
      setUploadError(error instanceof Error ? error.message : 'Evidence upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = useCallback(async (item: EvidenceItem) => {
    if (!item.fileId || item.rawStatus !== 'approved' || openingEvidenceId || !learnerKind || !learnerId) return;
    setOpeningEvidenceId(item.id);
    setDownloadError(null);
    try {
      const url = await getEvidenceDownloadUrl(learnerKind, learnerId, item.fileId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Could not open this evidence file.');
    } finally {
      setOpeningEvidenceId(null);
    }
  }, [learnerKind, learnerId, openingEvidenceId]);

  const handleCloseUpload = () => {
    setUploadTitle('');
    setUploadDesc('');
    setUploadKSBs([]);
    setUploadError(null);
    setShowUploadModal(false);
  };

  const suggestedKSBs = useMemo(() => {
    const wi = weekLookup.find(w => w.weekNumber === uploadWeek);
    return wi?.ksbCodes || [];
  }, [uploadWeek, weekLookup]);

  const currentWeekModule = weekLookup.find(w => w.weekNumber === uploadWeek);

  useEffect(() => {
    if (!weekLookup.some(week => week.weekNumber === uploadWeek) && weekLookup[0]) {
      setUploadWeek(weekLookup[0].weekNumber);
    }
  }, [weekLookup, uploadWeek]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilterDropdown(false);
      }
    }
    if (showFilterDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilterDropdown]);

  return (
    <>
      {showUploadModal && (
        <UploadModal
          onClose={handleCloseUpload}
          onSubmit={handleUpload}
          uploadSuccess={uploadSuccess}
          uploadError={uploadError}
          uploading={uploading}
          uploadTitle={uploadTitle}
          setUploadTitle={setUploadTitle}
          uploadWeek={uploadWeek}
          setUploadWeek={setUploadWeek}
          uploadType={uploadType}
          setUploadType={setUploadType}
          uploadOtjh={uploadOtjh}
          setUploadOtjh={setUploadOtjh}
          uploadKSBs={uploadKSBs}
          setUploadKSBs={setUploadKSBs}
          uploadDesc={uploadDesc}
          setUploadDesc={setUploadDesc}
          suggestedKSBs={suggestedKSBs}
          currentWeekModule={currentWeekModule}
          weekLookup={weekLookup}
          allKsbs={allKsbs}
        />
      )}

      {showFilePreview && (
        <FilePreviewModal
          item={previewItem || null}
          onClose={() => setShowFilePreview(null)}
          onDownload={handleDownload}
          opening={openingEvidenceId === previewItem?.id}
        />
      )}

      <div className="space-y-5 md:space-y-6">
        {/* ── Section header + primary CTA ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-heading font-semibold text-foreground-900">Evidence Library</h2>
            <p className="text-sm text-foreground-400 mt-0.5">Upload, track & map your apprenticeship evidence to KSBs</p>
          </div>
          {showReadOnlyNotice ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-foreground-200 bg-background-100 px-4 py-2 text-xs font-semibold text-foreground-500 whitespace-nowrap">
              <AppIcon className="ri-eye-line"></AppIcon> Read only — the learner uploads their own evidence
            </span>
          ) : (
            <button
              onClick={() => setShowUploadModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-500 text-background-50 dark:text-foreground-950 text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
            >
              <AppIcon className="ri-add-line"></AppIcon> Upload Evidence
            </button>
          )}
        </div>

        {(evidenceError || downloadError) && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">
            <div className="flex items-center gap-2">
              <AppIcon className="ri-error-warning-line" />
              <p className="text-xs">{evidenceError || downloadError}</p>
            </div>
            {evidenceError && <button onClick={() => void reloadEvidence()} className="text-xs font-semibold underline cursor-pointer">Retry</button>}
          </div>
        )}

        <section>
          {evidenceLoading && (
            <div className="mb-3 flex items-center gap-2 text-xs text-foreground-400">
              <AppIcon className="ri-loader-4-line animate-spin" /> Loading evidence…
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatStripCard label="Total Evidence" value={counts.total} icon="ri-folder-line" color="primary" />
            <StatStripCard label="Validated" value={counts.validated} icon="ri-check-double-line" color="emerald" />
            <StatStripCard label="Pending" value={counts.pending} icon="ri-time-line" color="amber" />
            <StatStripCard label="Needs Work" value={counts.needsWork} icon="ri-error-warning-line" color="red" />
            <StatStripCard label="Drafts" value={counts.draft} icon="ri-draft-line" color="secondary" />
          </div>
        </section>

        {/* ═══════════════════════════════════
            FILTERS + SEARCH
            ═══════════════════════════════════ */}
        <section>
          <div className="bg-background-50 rounded-2xl border border-foreground-200/70 p-4 md:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <AppIcon className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
                <input
                  type="text"
                  placeholder="Search title, module, KSB code, or week..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-background-100 border border-background-200 text-sm text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 transition-smooth"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-foreground-200 text-background-50 hover:bg-foreground-300 transition-smooth cursor-pointer">
                    <AppIcon className="ri-close-line text-[10px]"></AppIcon>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative" ref={filterRef}>
                  <button
                    onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap border ${
                      hasActiveFilters
                        ? 'bg-primary-50 text-primary-700 border-primary-200/50'
                        : 'bg-background-100 text-foreground-500 border-transparent hover:text-foreground-700 hover:border-foreground-200/40'
                    }`}
                  >
                    <AppIcon className="ri-filter-3-line text-sm"></AppIcon>
                    Filters
                    {hasActiveFilters && (
                      <span className="w-2 h-2 rounded-full bg-primary-500"></span>
                    )}
                  </button>
                  {showFilterDropdown && (
                    <div className="absolute right-0 mt-2 w-[280px] bg-background-50 rounded-2xl border border-foreground-200/70 shadow-xl z-50 p-4 space-y-4">
                      <div>
                        <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">Status</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(['All', 'Validated', 'Pending', 'Draft', 'Needs work'] as const).map(tab => {
                            const count = tab === 'All' ? counts.total : tab === 'Validated' ? counts.validated : tab === 'Pending' ? counts.pending : tab === 'Draft' ? counts.draft : counts.needsWork;
                            return (
                              <button
                                key={tab}
                                onClick={() => setActiveFilter(tab)}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                                  activeFilter === tab
                                    ? 'bg-[#b27715] text-white shadow-[0_3px_8px_rgba(178,119,21,0.28)]'
                                    : 'bg-background-100 text-foreground-500 hover:bg-[#fff8eb] hover:text-[#b27715]'
                                }`}
                              >
                                {tab}
                                <span className={`text-[10px] px-1 py-0.5 rounded-full ${activeFilter === tab ? 'bg-white/15' : 'bg-background-200/60 text-foreground-400'}`}>{count}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-2">Type</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(['All', 'Document', 'Presentation', 'Spreadsheet', 'Reflection', 'Quiz', 'Meeting notes', 'Workplace evidence', 'Image', 'Audio'] as const).map(t => (
                            <button
                              key={t}
                              onClick={() => setFilterType(t)}
                              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                                filterType === t
                                  ? 'bg-[#b27715] text-white shadow-[0_3px_8px_rgba(178,119,21,0.28)]'
                                  : 'bg-background-100 text-foreground-500 hover:bg-[#fff8eb] hover:text-[#b27715]'
                              }`}
                            >
                              {t === 'All' ? 'All' : t}
                            </button>
                          ))}
                        </div>
                      </div>
                      {hasActiveFilters && (
                        <div className="pt-2 border-t border-foreground-200/60">
                          <button
                            onClick={() => { setActiveFilter('All'); setFilterType('All'); setSearchQuery(''); }}
                            className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 font-semibold cursor-pointer"
                          >
                            <AppIcon className="ri-close-circle-line"></AppIcon> Clear all filters
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center p-1 bg-background-100 rounded-xl border border-foreground-200/60">
                  <button onClick={() => setViewMode('grid')} className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-smooth cursor-pointer ${viewMode === 'grid' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-400 hover:text-foreground-600'}`}>
                    <AppIcon className="ri-grid-fill"></AppIcon>
                  </button>
                  <button onClick={() => setViewMode('list')} className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-smooth cursor-pointer ${viewMode === 'list' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-400 hover:text-foreground-600'}`}>
                    <AppIcon className="ri-list-check"></AppIcon>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-foreground-400 pt-2 border-t border-foreground-200/60">
              <span>Showing {filtered.length} of {allEvidence.length} items</span>
              {(activeFilter !== 'All' || filterType !== 'All' || searchQuery) && (
                <button
                  onClick={() => { setActiveFilter('All'); setFilterType('All'); setSearchQuery(''); }}
                  className="text-primary-600 hover:text-primary-700 font-medium cursor-pointer"
                >
                  Clear all filters
                </button>
              )}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════
            EVIDENCE GRID / LIST
            ═══════════════════════════════════ */}
        <section>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(ev => (
                <EvidenceCard key={ev.id} ev={ev} onClick={() => setSelectedEvidence(ev.id)} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(ev => (
                <EvidenceRow key={ev.id} ev={ev} onClick={() => setSelectedEvidence(ev.id)} />
              ))}
            </div>
          )}

          {!evidenceLoading && filtered.length === 0 && (
            <div className="py-16 text-center bg-background-50 rounded-2xl border border-foreground-200/70">
              <span className="w-14 h-14 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-4">
                <AppIcon className="ri-folder-open-line text-foreground-300 text-2xl"></AppIcon>
              </span>
              <p className="text-sm text-foreground-500 mb-1">{allEvidence.length ? 'No evidence matches your filters' : 'No evidence uploaded yet'}</p>
              <p className="text-xs text-foreground-400 mb-3">{allEvidence.length ? 'Try adjusting your search or clearing filters' : 'Use Upload Evidence to add the first file.'}</p>
              {allEvidence.length > 0 && <button
                onClick={() => { setActiveFilter('All'); setFilterType('All'); setSearchQuery(''); }}
                className="px-4 py-2 rounded-xl bg-primary-500 text-background-50 dark:text-foreground-950 text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer"
              >
                Clear all filters
              </button>}
            </div>
          )}
        </section>
      </div>

      {/* ═══════════════════════════════════
          RIGHT PANEL — DETAIL
          ═══════════════════════════════════ */}
      <RightSlidePanel
        isOpen={selectedEvidence !== null}
        onClose={() => setSelectedEvidence(null)}
        title={selectedItem?.title || 'Evidence Detail'}
        width="w-[520px]"
      >
        {selectedItem && (
          <div className="space-y-6">
            <div className="flex items-start gap-3">
              <span className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${TYPE_CONFIG[selectedItem.type]?.bg || 'bg-primary-50'} ${TYPE_CONFIG[selectedItem.type]?.text || 'text-primary-700'}`}>
                <AppIcon className={`${TYPE_CONFIG[selectedItem.type]?.icon || 'ri-file-text-line'} text-xl`}></AppIcon>
              </span>
              <div className="flex-1 min-w-0">
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_CONFIG[selectedItem.status].bg} ${STATUS_CONFIG[selectedItem.status].text} border border-current/10`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${STATUS_CONFIG[selectedItem.status].dot}`}></span>
                  {STATUS_CONFIG[selectedItem.status].label}
                </span>
                <div className="flex items-center gap-2 mt-1.5 text-xs text-foreground-400">
                  <span className="text-[10px] font-bold bg-background-100 px-1.5 py-0.5 rounded">W{selectedItem.week}</span>
                  <span>{selectedItem.module}</span>
                  <span className="text-foreground-200">·</span>
                  <span>{selectedItem.date}</span>
                </div>
              </div>
            </div>
            {selectedItem.description && (
              <div>
                <h4 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-2">Description</h4>
                <p className="text-sm text-foreground-600 leading-relaxed">{selectedItem.description}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <MetaBox label="Type" value={selectedItem.type} />
              <MetaBox label="Module" value={selectedItem.module} />
              <MetaBox label="Week" value={selectedItem.weekLabel} />
              <MetaBox label="Status" value={STATUS_CONFIG[selectedItem.status].label} />
              <MetaBox label="Session" value={selectedItem.sessionType || 'N/A'} />
              <MetaBox label="Submitted" value={selectedItem.date} />
              {selectedItem.otjh > 0 && <MetaBox label="OTJH" value={`${selectedItem.otjh}h`} />}
            </div>
            {selectedItem.ksb.length > 0 && <div>
              <h4 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-2">Linked KSBs</h4>
              <div className="flex flex-wrap gap-1.5">
                {selectedItem.ksb.map(code => {
                  const kc = KSB_TYPE_COLORS[code.startsWith('K') ? 'Knowledge' : code.startsWith('S') ? 'Skill' : 'Behaviour'];
                  return <span key={code} className={`text-xs font-bold px-2 py-1 rounded ${kc.bg} ${kc.text} border border-current/10`}>{code}</span>;
                })}
              </div>
            </div>}
            <div>
              <h4 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-2">Documents</h4>
              {selectedItem.documents && selectedItem.documents.length > 0 ? (
                <div className="space-y-2">
                  {selectedItem.documents.map((doc, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-background-100/60 rounded-xl px-3 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <AppIcon className="ri-file-text-line text-foreground-400 text-sm shrink-0"></AppIcon>
                        <span className="text-sm text-foreground-700 truncate">{doc.name}</span>
                        <span className="text-xs text-foreground-400 shrink-0">{doc.size}</span>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                        doc.status === 'Accepted' ? 'bg-emerald-50 text-emerald-700' : doc.status === 'Referred' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                      }`}>
                        {doc.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-foreground-400 bg-background-100/60 rounded-xl px-3 py-2.5">No documents uploaded yet.</p>
              )}
            </div>
            <div className="flex flex-col gap-2 pt-2 border-t border-background-200/40">
              <button
                onClick={() => { setSelectedEvidence(null); setShowFilePreview(selectedItem.id); }}
                className="w-full px-4 py-2.5 rounded-xl bg-primary-500 text-background-50 dark:text-foreground-950 text-sm font-semibold cursor-pointer whitespace-nowrap hover:bg-primary-600 transition-smooth"
              >
                <AppIcon className="ri-eye-line mr-1.5"></AppIcon> View Full Evidence
              </button>
              <button
                onClick={() => void handleDownload(selectedItem)}
                disabled={selectedItem.rawStatus !== 'approved' || openingEvidenceId === selectedItem.id}
                className="w-full px-4 py-2.5 rounded-xl bg-background-50 border border-foreground-200 text-sm font-medium text-foreground-600 cursor-pointer whitespace-nowrap hover:bg-background-100 transition-smooth disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AppIcon className={`${openingEvidenceId === selectedItem.id ? 'ri-loader-4-line animate-spin' : 'ri-download-line'} mr-1.5`}></AppIcon>
                {openingEvidenceId === selectedItem.id ? 'Opening…' : selectedItem.rawStatus === 'approved' ? 'Open File' : 'File Awaiting Approval'}
              </button>
            </div>
          </div>
        )}
      </RightSlidePanel>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   UPLOAD MODAL
   ═══════════════════════════════════════════════════════════════ */
interface UploadModalProps {
  onClose: () => void;
  onSubmit: (files: File[]) => void;
  uploadSuccess: boolean;
  uploadError: string | null;
  uploading: boolean;
  uploadTitle: string;
  setUploadTitle: (v: string) => void;
  uploadWeek: number;
  setUploadWeek: (v: number) => void;
  uploadType: EvidenceType;
  setUploadType: (v: EvidenceType) => void;
  uploadOtjh: number;
  setUploadOtjh: (v: number) => void;
  uploadKSBs: string[];
  setUploadKSBs: (v: string[] | ((prev: string[]) => string[])) => void;
  uploadDesc: string;
  setUploadDesc: (v: string) => void;
  suggestedKSBs: string[];
  currentWeekModule?: WeekInfo;
  weekLookup: WeekInfo[];
  allKsbs: KSBInfo[];
}

function UploadModal({
  onClose,
  onSubmit,
  uploadSuccess,
  uploadError,
  uploading,
  uploadTitle,
  setUploadTitle,
  uploadWeek,
  setUploadWeek,
  uploadType,
  setUploadType,
  uploadOtjh,
  setUploadOtjh,
  uploadKSBs,
  setUploadKSBs,
  uploadDesc,
  setUploadDesc,
  suggestedKSBs,
  currentWeekModule,
  weekLookup,
  allKsbs,
}: UploadModalProps) {
  const [showKSBSelector, setShowKSBSelector] = useState(false);
  const [ksbSearch, setKsbSearch] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ksbByType = useMemo(() => {
    const ksb = allKsbs.filter(k => k.code.toLowerCase().includes(ksbSearch.toLowerCase()));
    return {
      Knowledge: ksb.filter(k => k.type === 'Knowledge'),
      Skill: ksb.filter(k => k.type === 'Skill'),
      Behaviour: ksb.filter(k => k.type === 'Behaviour'),
    };
  }, [allKsbs, ksbSearch]);

  const toggleKSB = (code: string) => {
    setUploadKSBs((prev: string[]) =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]);
    }
  };

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const applySuggested = () => {
    if (suggestedKSBs.length > 0) {
      setUploadKSBs(suggestedKSBs);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-background-50 rounded-2xl border border-foreground-200/60 shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 p-6 pb-4 border-b border-foreground-200/60">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
              <AppIcon className="ri-upload-cloud-2-line text-primary-600 text-lg"></AppIcon>
            </span>
            <div>
              <h3 className="text-base font-heading font-semibold text-foreground-900">New Evidence Submission</h3>
              <p className="text-xs text-foreground-400">Map your work to a week, module, and KSBs</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center text-foreground-400 hover:text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer"
          >
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {uploadSuccess && (
            <div className="px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200/50 flex items-center gap-2 text-sm text-emerald-700">
              <AppIcon className="ri-checkbox-circle-fill text-emerald-500"></AppIcon>
              Evidence uploaded successfully!
            </div>
          )}
          {uploadError && (
            <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200/50 flex items-center gap-2 text-sm text-red-700">
              <AppIcon className="ri-error-warning-line text-red-500"></AppIcon>
              {uploadError}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider mb-2 block">
              Evidence Title
            </label>
            <input
              type="text"
              value={uploadTitle}
              onChange={e => setUploadTitle(e.target.value)}
              placeholder="e.g., Customer segmentation analysis — Q3 data"
              className="w-full px-4 py-3 rounded-xl bg-background-50 border border-foreground-200 text-sm text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100/50 transition-smooth"
            />
          </div>

          {/* Week & Type row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider mb-2 block">Week</label>
              <div className="relative">
                <select
                  value={uploadWeek}
                  onChange={e => setUploadWeek(Number(e.target.value))}
                  className="w-full px-4 py-3 rounded-xl bg-background-50 border border-foreground-200 text-sm text-foreground-900 focus:outline-none focus:border-primary-300 transition-smooth cursor-pointer appearance-none pr-10"
                >
                  {weekLookup.map(w => (
                    <option key={w.weekNumber} value={w.weekNumber}>
                      W{w.weekNumber} — {w.moduleName}
                    </option>
                  ))}
                </select>
                <AppIcon className="ri-arrow-down-s-line absolute right-3 top-1/2 -translate-y-1/2 text-foreground-400 pointer-events-none"></AppIcon>
              </div>
              {currentWeekModule && (
                <p className="text-[10px] text-foreground-400 mt-1.5">{currentWeekModule.dateRange}</p>
              )}
            </div>
            <div>
              <label className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider mb-2 block">Type</label>
              <div className="relative">
                <select
                  value={uploadType}
                  onChange={e => setUploadType(e.target.value as EvidenceType)}
                  className="w-full px-4 py-3 rounded-xl bg-background-50 border border-foreground-200 text-sm text-foreground-900 focus:outline-none focus:border-primary-300 transition-smooth cursor-pointer appearance-none pr-10"
                >
                  {(['Document', 'Presentation', 'Spreadsheet', 'Reflection', 'Quiz', 'Meeting notes', 'Workplace evidence'] as EvidenceType[]).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <AppIcon className="ri-arrow-down-s-line absolute right-3 top-1/2 -translate-y-1/2 text-foreground-400 pointer-events-none"></AppIcon>
              </div>
            </div>
          </div>

          {/* OTJH Hours */}
          <div>
            <label className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider mb-2 block">
              OTJH Hours
            </label>
            <div className="flex items-center gap-2">
              {[0.5, 1, 1.5, 2, 2.5, 3].map(h => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setUploadOtjh(h)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition-smooth cursor-pointer whitespace-nowrap border ${
                    uploadOtjh === h
                      ? 'bg-primary-500 text-background-50 dark:text-foreground-950 border-primary-500 shadow-sm'
                      : 'bg-background-100 text-foreground-500 border-transparent hover:border-foreground-200/60 hover:text-foreground-700'
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>

          {/* Linked KSBs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider">
                Linked KSBs
              </label>
              {uploadKSBs.length > 0 && (
                <span className="text-[10px] text-foreground-400">{uploadKSBs.length} selected</span>
              )}
            </div>

            {uploadKSBs.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {uploadKSBs.map(code => {
                  const kc = KSB_TYPE_COLORS[code.startsWith('K') ? 'Knowledge' : code.startsWith('S') ? 'Skill' : 'Behaviour'];
                  return (
                    <span
                      key={code}
                      className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg ${kc.bg} ${kc.text} border border-current/10 cursor-pointer hover:opacity-70 transition-smooth`}
                      onClick={() => toggleKSB(code)}
                    >
                      {code}
                      <AppIcon className="ri-close-line text-[10px]"></AppIcon>
                    </span>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-foreground-400">No KSBs selected yet</span>
                {suggestedKSBs.length > 0 && (
                  <button
                    onClick={applySuggested}
                    className="text-xs text-primary-600 font-semibold hover:text-primary-700 cursor-pointer transition-smooth"
                  >
                    Apply suggested
                  </button>
                )}
              </div>
            )}

            <button
              onClick={() => setShowKSBSelector(!showKSBSelector)}
              className="flex items-center gap-2 w-full px-4 py-3 rounded-xl bg-background-100 border border-foreground-200/60 text-sm text-foreground-500 hover:text-foreground-700 hover:border-foreground-300/40 transition-smooth cursor-pointer"
            >
              {showKSBSelector ? (
                <AppIcon className="ri-arrow-up-s-line text-foreground-400"></AppIcon>
              ) : (
                <AppIcon className="ri-add-line text-foreground-400"></AppIcon>
              )}
              {showKSBSelector ? 'Hide KSB selector' : 'Select KSBs'}
              {showKSBSelector ? (
                <AppIcon className="ri-arrow-up-s-line ml-auto text-foreground-400"></AppIcon>
              ) : (
                <AppIcon className="ri-arrow-down-s-line ml-auto text-foreground-400"></AppIcon>
              )}
            </button>

            {showKSBSelector && (
              <div className="mt-3 p-4 rounded-xl bg-background-100 border border-foreground-200/60 space-y-4 animate-in slide-in-from-top-2 duration-200">
                <div className="relative">
                  <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></AppIcon>
                  <input
                    type="text"
                    value={ksbSearch}
                    onChange={e => setKsbSearch(e.target.value)}
                    placeholder="Search KSB code..."
                    className="w-full pl-9 pr-4 py-2 rounded-lg bg-background-50 border border-foreground-200 text-sm text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 transition-smooth"
                  />
                </div>

                <div className="space-y-3 max-h-[240px] overflow-y-auto">
                  {(['Knowledge', 'Skill', 'Behaviour'] as const).map(group => {
                    const items = ksbByType[group];
                    if (items.length === 0) return null;
                    const color = KSB_TYPE_COLORS[group];
                    return (
                      <div key={group}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${color.bg} ${color.text}`}>
                            {group}
                          </span>
                          <span className="text-[10px] text-foreground-400">{items.length}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {items.map(k => {
                            const isSel = uploadKSBs.includes(k.code);
                            return (
                              <button
                                key={k.code}
                                onClick={() => toggleKSB(k.code)}
                                className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-smooth cursor-pointer border ${
                                  isSel
                                    ? `${color.bg} ${color.text} border-current/20`
                                    : 'bg-background-50 text-foreground-400 border-foreground-200/40 hover:border-foreground-300/60'
                                }`}
                              >
                                {k.code}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {ksbSearch && ksbByType.Knowledge.length === 0 && ksbByType.Skill.length === 0 && ksbByType.Behaviour.length === 0 && (
                  <p className="text-xs text-foreground-400 text-center py-2">No KSBs found</p>
                )}

                <div className="flex items-center gap-2 pt-2 border-t border-foreground-200/40">
                  {suggestedKSBs.length > 0 && (
                    <button
                      onClick={applySuggested}
                      className="text-xs text-primary-600 font-semibold hover:text-primary-700 cursor-pointer transition-smooth"
                    >
                      Apply suggested ({suggestedKSBs.join(', ')})
                    </button>
                  )}
                  {uploadKSBs.length > 0 && (
                    <button
                      onClick={() => setUploadKSBs([])}
                      className="text-xs text-foreground-400 font-semibold hover:text-foreground-600 cursor-pointer transition-smooth ml-auto"
                    >
                      Clear all
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider mb-2 block">
              Description
            </label>
            <textarea
              value={uploadDesc}
              onChange={e => setUploadDesc(e.target.value)}
              placeholder="Describe what this evidence covers and how it relates to your KSBs..."
              rows={3}
              maxLength={500}
              className="w-full px-4 py-3 rounded-xl bg-background-50 border border-foreground-200 text-sm text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100/50 transition-smooth resize-none"
            />
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-[10px] text-foreground-400">Max 500 characters</p>
              <p className="text-[10px] text-foreground-400">{uploadDesc.length}/500</p>
            </div>
          </div>

          {/* File Upload */}
          <div>
            <label className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider mb-2 block">
              Attachments
            </label>

            {files.length > 0 && (
              <div className="space-y-2 mb-3">
                {files.map((f, idx) => (
                  <div key={idx} className="flex items-center gap-3 bg-background-100 rounded-xl px-3 py-2.5">
                    <span className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
                      <AppIcon className="ri-file-text-line text-primary-600 text-sm"></AppIcon>
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground-700 truncate">{f.name}</p>
                      <p className="text-[10px] text-foreground-400">{formatBytes(f.size)}</p>
                    </div>
                    <button
                      onClick={() => removeFile(idx)}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-foreground-400 hover:text-red-500 hover:bg-red-50 transition-smooth cursor-pointer"
                    >
                      <AppIcon className="ri-close-line text-sm"></AppIcon>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed p-5 text-center transition-smooth cursor-pointer ${
                dragActive
                  ? 'border-primary-300 bg-primary-50/50'
                  : 'border-foreground-200 bg-background-100/40 hover:border-foreground-300/60 hover:bg-background-100/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="application/pdf,image/png,image/jpeg,video/mp4"
                className="hidden"
                onClick={e => e.stopPropagation()}
                onChange={e => {
                  if (e.target.files?.length) setFiles(prev => [...prev, ...Array.from(e.target.files || [])]);
                  e.target.value = '';
                }}
              />
              <span className="w-10 h-10 rounded-xl bg-background-50 flex items-center justify-center mx-auto mb-2">
                <AppIcon className="ri-upload-cloud-2-line text-foreground-400 text-lg"></AppIcon>
              </span>
              <p className="text-sm text-foreground-600 font-medium">
                Drop files here or <span className="text-primary-600">click to browse</span>
              </p>
              <p className="text-[11px] text-foreground-400 mt-1">PDF, PNG, JPG or MP4 up to 50MB</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 pt-4 border-t border-foreground-200/60">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-background-100 text-sm font-medium text-foreground-500 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(files)}
            disabled={!uploadTitle.trim() || files.length === 0 || uploading}
            className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 ${
              uploadTitle.trim() && files.length > 0 && !uploading
                ? 'bg-primary-500 text-background-50 dark:text-foreground-950 hover:bg-primary-600 shadow-sm'
                : 'bg-background-200 text-foreground-400 cursor-not-allowed'
            }`}
          >
            <AppIcon className={uploading ? 'ri-loader-4-line animate-spin' : 'ri-check-line'}></AppIcon>
            {uploading ? 'Uploading…' : 'Submit Evidence'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MetaBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background-100/60 rounded-xl p-3">
      <p className="text-[10px] text-foreground-400 uppercase tracking-wider font-semibold mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-foreground-900">{value}</p>
    </div>
  );
}
