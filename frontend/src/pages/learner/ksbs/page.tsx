import { useState, useMemo, useRef, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { useResolvedLearner } from '@/hooks/useMyLearner';
import { RealKsbView } from '@/components/feature/RealKsbView';

const learnerNav = roleNavMap.learner;

type KSBStatus = 'Validated' | 'Evidenced' | 'Applied' | 'Not Started' | 'Pending';

interface KSBRecord {
  code: string;
  type: 'Knowledge' | 'Skill' | 'Behaviour';
  desc: string;
  evidence: number;
  status: KSBStatus;
  updated: string;
  pct: number;
}

const KSB_RECORDS: KSBRecord[] = [
  { code: 'K1', type: 'Knowledge', desc: 'Leadership styles and their impact on team performance', evidence: 5, status: 'Validated', updated: '28/05/2025', pct: 100 },
  { code: 'K2', type: 'Knowledge', desc: 'Operational decision-making frameworks', evidence: 4, status: 'Evidenced', updated: '03/10/2025', pct: 85 },
  { code: 'K3', type: 'Knowledge', desc: 'Coaching and feedback models for team development', evidence: 3, status: 'Applied', updated: '07/10/2025', pct: 70 },
  { code: 'K4', type: 'Knowledge', desc: 'Change management theories and application', evidence: 3, status: 'Applied', updated: '03/10/2025', pct: 65 },
  { code: 'K5', type: 'Knowledge', desc: 'Stakeholder communication and engagement strategies', evidence: 2, status: 'Evidenced', updated: '07/10/2025', pct: 80 },
  { code: 'K6', type: 'Knowledge', desc: 'Data-driven decision making and business analytics', evidence: 4, status: 'Validated', updated: '09/09/2025', pct: 100 },
  { code: 'K7', type: 'Knowledge', desc: 'Project management methodologies and tools', evidence: 3, status: 'Applied', updated: '11/09/2025', pct: 60 },
  { code: 'K8', type: 'Knowledge', desc: 'Digital transformation and emerging technologies', evidence: 2, status: 'Pending', updated: '11/09/2025', pct: 40 },
  { code: 'K9', type: 'Knowledge', desc: 'Risk management, governance and compliance', evidence: 1, status: 'Not Started', updated: '—', pct: 0 },
  { code: 'K10', type: 'Knowledge', desc: 'Strategic planning and business development', evidence: 2, status: 'Evidenced', updated: '15/09/2025', pct: 75 },
  { code: 'K11', type: 'Knowledge', desc: 'Equality, diversity and inclusion in the workplace', evidence: 3, status: 'Applied', updated: '09/09/2025', pct: 70 },
  { code: 'K12', type: 'Knowledge', desc: 'Sustainability and corporate social responsibility', evidence: 1, status: 'Not Started', updated: '—', pct: 0 },
  { code: 'S1', type: 'Skill', desc: 'Develop and implement strategic business plans', evidence: 4, status: 'Validated', updated: '28/05/2025', pct: 100 },
  { code: 'S2', type: 'Skill', desc: 'Lead, manage and motivate team performance', evidence: 3, status: 'Evidenced', updated: '03/10/2025', pct: 85 },
  { code: 'S3', type: 'Skill', desc: 'Facilitate coaching and mentoring sessions', evidence: 2, status: 'Applied', updated: '07/10/2025', pct: 60 },
  { code: 'S4', type: 'Skill', desc: 'Manage organisational change and transition', evidence: 3, status: 'Evidenced', updated: '03/10/2025', pct: 80 },
  { code: 'S5', type: 'Skill', desc: 'Communicate effectively with diverse stakeholders', evidence: 5, status: 'Validated', updated: '09/09/2025', pct: 100 },
  { code: 'S6', type: 'Skill', desc: 'Analyse and interpret complex business data', evidence: 4, status: 'Applied', updated: '11/09/2025', pct: 70 },
  { code: 'S7', type: 'Skill', desc: 'Deliver professional presentations and reports', evidence: 2, status: 'Pending', updated: '11/09/2025', pct: 45 },
  { code: 'S8', type: 'Skill', desc: 'Negotiate, influence and drive decisions', evidence: 1, status: 'Not Started', updated: '—', pct: 0 },
  { code: 'S9', type: 'Skill', desc: 'Manage projects and resources efficiently', evidence: 3, status: 'Evidenced', updated: '15/09/2025', pct: 75 },
  { code: 'S10', type: 'Skill', desc: 'Leverage digital tools for team collaboration', evidence: 2, status: 'Applied', updated: '09/09/2025', pct: 55 },
  { code: 'B1', type: 'Behaviour', desc: 'Take ownership and responsibility for development', evidence: 3, status: 'Validated', updated: '28/05/2025', pct: 100 },
  { code: 'B2', type: 'Behaviour', desc: 'Act with integrity and professional standards', evidence: 4, status: 'Evidenced', updated: '03/10/2025', pct: 90 },
  { code: 'B3', type: 'Behaviour', desc: 'Demonstrate adaptability and resilience', evidence: 2, status: 'Applied', updated: '07/10/2025', pct: 65 },
  { code: 'B4', type: 'Behaviour', desc: 'Collaborate and build productive relationships', evidence: 3, status: 'Evidenced', updated: '03/10/2025', pct: 80 },
  { code: 'B5', type: 'Behaviour', desc: 'Show commitment to organisational values', evidence: 2, status: 'Applied', updated: '09/09/2025', pct: 60 },
  { code: 'B6', type: 'Behaviour', desc: 'Demonstrate curiosity and continuous learning', evidence: 1, status: 'Pending', updated: '11/09/2025', pct: 35 },
  { code: 'B7', type: 'Behaviour', desc: 'Support others and share knowledge generously', evidence: 1, status: 'Not Started', updated: '—', pct: 0 },
];

const SUGGESTED_EVIDENCE = [
  { title: 'Customer persona for Tim Hortons breakfast campaign', linksTo: 'K6, S7, S8', reason: 'Complete this week\'s activity and upload to build your portfolio — directly links to three KSBs', ksbCount: 3 },
  { title: 'Campaign performance report from workplace', linksTo: 'S9', reason: 'Ask Lauren if you can access past campaign data to evidence project management and analytical skills', ksbCount: 1 },
  { title: 'Presentation to marketing team', linksTo: 'S5, B3', reason: 'Volunteer to present your segmentation findings — builds confidence and generates evidence simultaneously', ksbCount: 2 },
  { title: 'Stakeholder mapping for summer promotion', linksTo: 'K5, S4', reason: 'Map key stakeholders for an upcoming campaign to demonstrate engagement and change management skills', ksbCount: 2 },
  { title: 'Weekly reflection on team leadership moments', linksTo: 'B1, B4, B7', reason: 'Document small daily moments where you lead or support colleagues — quick but powerful evidence', ksbCount: 3 },
];

const typeConfig = {
  Knowledge: { bg: 'bg-primary-100', text: 'text-primary-700', bar: 'bg-primary-500', ring: 'oklch(var(--primary-500))', icon: 'ri-book-open-line', label: 'Knowledge', ringStroke: 'stroke-primary-500' },
  Skill: { bg: 'bg-accent-100', text: 'text-accent-700', bar: 'bg-accent-500', ring: 'oklch(var(--accent-500))', icon: 'ri-tools-line', label: 'Skills', ringStroke: 'stroke-accent-500' },
  Behaviour: { bg: 'bg-secondary-100', text: 'text-secondary-700', bar: 'bg-secondary-500', ring: 'oklch(var(--secondary-500))', icon: 'ri-user-heart-line', label: 'Behaviours', ringStroke: 'stroke-secondary-500' },
};

const statusConfig: Record<KSBStatus, { badge: string; label: string; dot: string }> = {
  Validated: { badge: 'bg-emerald-100 text-emerald-700', label: 'Validated', dot: 'bg-emerald-500' },
  Evidenced: { badge: 'bg-amber-100 text-amber-700', label: 'Evidenced', dot: 'bg-amber-500' },
  Applied: { badge: 'bg-primary-100 text-primary-700', label: 'Applied', dot: 'bg-primary-500' },
  Pending: { badge: 'bg-amber-50 text-amber-600 border border-amber-200', label: 'Pending', dot: 'bg-amber-400' },
  'Not Started': { badge: 'bg-background-100 text-foreground-400', label: 'Not Started', dot: 'bg-foreground-300' },
};

/* ── Scroll Reveal ── */
function SectionReveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setTimeout(() => setVisible(true), delay); obs.disconnect(); } }, { threshold: 0.06, rootMargin: '0px 0px -20px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [delay]);
  return (
    <div ref={ref} className={`transition-all duration-[500ms] ease-out ${className} ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
      {children}
    </div>
  );
}

/* ── Donut Ring ── */
function DonutRing({ pct, size = 64, stroke = 6, color, trackClass = 'text-background-200' }: { pct: number; size?: number; stroke?: number; color: string; trackClass?: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  const colorMap: Record<string, string> = {
    primary: 'stroke-primary-500',
    accent: 'stroke-accent-500',
    secondary: 'stroke-secondary-500',
    emerald: 'stroke-emerald-500',
    amber: 'stroke-amber-500',
    red: 'stroke-red-500',
  };
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={trackClass} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={`${colorMap[color] || colorMap.primary} transition-all duration-700 ease-out`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
    </svg>
  );
}

/* ── Progress Bar ── */
function ProgressBar({ pct, color, height = 2 }: { pct: number; color: string; height?: number }) {
  const barColors: Record<string, string> = {
    primary: 'bg-primary-500', accent: 'bg-accent-500', secondary: 'bg-secondary-500',
    emerald: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500',
  };
  return (
    <div className={`w-full rounded-full bg-background-200 overflow-hidden`} style={{ height }}>
      <div className={`h-full rounded-full transition-all duration-700 ease-out ${barColors[color] || 'bg-primary-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export default function KSBsPage() {
  const { kind: urlKind, id: urlId } = useParams<{ kind?: string; id?: string }>();
  const { kind, id } = useResolvedLearner(urlKind, urlId);
  const { isRealMode, real, loading } = useLearnerDetailParam(kind, id);
  if (isRealMode) return <RealKsbView real={real} loading={loading} />;
  return <MockKSBsPage />;
}

function MockKSBsPage() {
  const p = LEARNER_PROFILE;
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'All' | 'Knowledge' | 'Skill' | 'Behaviour'>('All');
  const [filterStatus, setFilterStatus] = useState<KSBStatus | 'All'>('All');
  const [sortBy, setSortBy] = useState<'code' | 'pct'>('code');
  const [showFilters, setShowFilters] = useState(false);

  const totalPct = useMemo(() => Math.round(KSB_RECORDS.reduce((s, k) => s + k.pct, 0) / KSB_RECORDS.length), []);
  const knowledgePct = useMemo(() => { const k = KSB_RECORDS.filter(r => r.type === 'Knowledge'); return Math.round(k.reduce((s, r) => s + r.pct, 0) / k.length); }, []);
  const skillPct = useMemo(() => { const s = KSB_RECORDS.filter(r => r.type === 'Skill'); return Math.round(s.reduce((sum, r) => sum + r.pct, 0) / s.length); }, []);
  const behaviourPct = useMemo(() => { const b = KSB_RECORDS.filter(r => r.type === 'Behaviour'); return Math.round(b.reduce((sum, r) => sum + r.pct, 0) / b.length); }, []);

  const validated = KSB_RECORDS.filter(k => k.status === 'Validated').length;
  const evidenced = KSB_RECORDS.filter(k => k.status === 'Evidenced').length;
  const applied = KSB_RECORDS.filter(k => k.status === 'Applied').length;
  const notStarted = KSB_RECORDS.filter(k => k.status === 'Not Started').length;
  const remainingKSBs = KSB_RECORDS.filter(k => k.status !== 'Validated').length;

  const atRiskKSBs = useMemo(() => [...KSB_RECORDS].filter(k => k.pct < 40).sort((a, b) => a.pct - b.pct).slice(0, 6), []);
  const quickWins = useMemo(() => [...KSB_RECORDS].filter(k => k.pct >= 40 && k.pct < 80 && k.status !== 'Validated').sort((a, b) => b.pct - a.pct).slice(0, 4), []);

  const categoryStats = [
    { type: 'Knowledge' as const, pct: knowledgePct, total: KSB_RECORDS.filter(k => k.type === 'Knowledge').length, validated: KSB_RECORDS.filter(k => k.type === 'Knowledge' && k.status === 'Validated').length, evidenced: KSB_RECORDS.filter(k => k.type === 'Knowledge' && k.status === 'Evidenced').length, applied: KSB_RECORDS.filter(k => k.type === 'Knowledge' && k.status === 'Applied').length, notStarted: KSB_RECORDS.filter(k => k.type === 'Knowledge' && k.status === 'Not Started').length },
    { type: 'Skill' as const, pct: skillPct, total: KSB_RECORDS.filter(k => k.type === 'Skill').length, validated: KSB_RECORDS.filter(k => k.type === 'Skill' && k.status === 'Validated').length, evidenced: KSB_RECORDS.filter(k => k.type === 'Skill' && k.status === 'Evidenced').length, applied: KSB_RECORDS.filter(k => k.type === 'Skill' && k.status === 'Applied').length, notStarted: KSB_RECORDS.filter(k => k.type === 'Skill' && k.status === 'Not Started').length },
    { type: 'Behaviour' as const, pct: behaviourPct, total: KSB_RECORDS.filter(k => k.type === 'Behaviour').length, validated: KSB_RECORDS.filter(k => k.type === 'Behaviour' && k.status === 'Validated').length, evidenced: KSB_RECORDS.filter(k => k.type === 'Behaviour' && k.status === 'Evidenced').length, applied: KSB_RECORDS.filter(k => k.type === 'Behaviour' && k.status === 'Applied').length, notStarted: KSB_RECORDS.filter(k => k.type === 'Behaviour' && k.status === 'Not Started').length },
  ];

  const filteredKSBs = useMemo(() => {
    let list = [...KSB_RECORDS];
    if (filterType !== 'All') list = list.filter(k => k.type === filterType);
    if (filterStatus !== 'All') list = list.filter(k => k.status === filterStatus);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(k => k.code.toLowerCase().includes(q) || k.desc.toLowerCase().includes(q));
    }
    list.sort((a, b) => sortBy === 'code' ? a.code.localeCompare(b.code) : a.pct - b.pct);
    return list;
  }, [filterType, filterStatus, searchQuery, sortBy]);

  const heroColor = totalPct >= 70 ? 'emerald' : totalPct >= 45 ? 'amber' : 'red';
  const hasActiveFilters = filterType !== 'All' || filterStatus !== 'All' || searchQuery.trim().length > 0;

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="My KSB Progress" pageSubtitle="Knowledge, Skills & Behaviours"
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      <div className="p-4 md:p-6 space-y-6">

        {/* ═══════════════════════════════════════════════════
            HERO
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={0}>
          <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute animate-liquid-blob-1 opacity-20" style={{ width: '55%', height: '28%', left: '-8%', top: '-8%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.25) 0%, transparent 70%)', filter: 'blur(55px)' }} />
              <div className="absolute animate-liquid-blob-2 opacity-12" style={{ width: '65%', height: '32%', right: '-12%', top: '12%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.18) 0%, transparent 70%)', filter: 'blur(50px)' }} />
            </div>
            <div className="relative p-6 md:p-8 flex flex-col lg:flex-row items-start lg:items-center gap-6 lg:gap-10">
              <div className="flex items-center gap-4 shrink-0">
                <span className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center">
                  <i className="ri-bar-chart-box-line text-white text-2xl"></i>
                </span>
                <div>
                  <h2 className="text-xl font-heading font-bold text-white">KSB Progress</h2>
                  <p className="text-sm text-white/50">Knowledge, Skills & Behaviours</p>
                </div>
              </div>
              <div className="lg:ml-auto flex items-center gap-6">
                {/* Main progress */}
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <DonutRing pct={totalPct} size={60} stroke={5} color={heroColor} trackClass="text-white/10" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-sm font-bold text-white">{totalPct}%</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-white/40">Validated</p>
                    <p className="text-base font-heading font-bold text-white">{validated}<span className="text-sm font-normal text-white/30">/{KSB_RECORDS.length}</span></p>
                  </div>
                </div>
                <div className="w-px h-10 bg-white/10 hidden sm:block" />
                {/* Mini rings */}
                <div className="flex items-center gap-4">
                  {categoryStats.map(cat => (
                    <div key={cat.type} className="flex flex-col items-center gap-1">
                      <div className="relative">
                        <DonutRing pct={cat.pct} size={40} stroke={4} color={cat.type === 'Knowledge' ? 'primary' : cat.type === 'Skill' ? 'accent' : 'secondary'} trackClass="text-white/10" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[9px] font-bold text-white">{cat.pct}%</span>
                        </div>
                      </div>
                      <span className="text-[9px] text-white/40 font-medium">{cat.type === 'Knowledge' ? 'K' : cat.type === 'Skill' ? 'S' : 'B'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            STATS STRIP
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={60}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Validated" value={validated} total={KSB_RECORDS.length} color="emerald" icon="ri-check-double-line" />
            <StatCard label="Evidenced" value={evidenced} total={KSB_RECORDS.length} color="amber" icon="ri-file-check-line" />
            <StatCard label="Applied" value={applied} total={KSB_RECORDS.length} color="primary" icon="ri-briefcase-line" />
            <StatCard label="Not Started" value={notStarted} total={KSB_RECORDS.length} color="red" icon="ri-subtract-line" />
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            CATEGORY CARDS
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={100}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {categoryStats.map(cat => {
              const tc = typeConfig[cat.type];
              const rowColor = cat.type === 'Knowledge' ? 'primary' : cat.type === 'Skill' ? 'accent' : 'secondary';
              return (
                <div key={cat.type} className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5">
                  <div className="flex items-center gap-3 mb-5">
                    <span className={`w-10 h-10 rounded-xl ${tc.bg} flex items-center justify-center`}>
                      <i className={`${tc.icon} ${tc.text} text-lg`}></i>
                    </span>
                    <div className="flex-1">
                      <h3 className="text-sm font-heading font-semibold text-foreground-900">{cat.type}</h3>
                      <p className="text-xs text-foreground-400">{cat.validated} of {cat.total} validated</p>
                    </div>
                    <div className="relative">
                      <DonutRing pct={cat.pct} size={48} stroke={4} color={rowColor} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xs font-bold text-foreground-900">{cat.pct}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <StatBar label="Validated" count={cat.validated} total={cat.total} color="emerald" />
                    <StatBar label="Evidenced" count={cat.evidenced} total={cat.total} color="amber" />
                    <StatBar label="Applied" count={cat.applied} total={cat.total} color="primary" />
                    <StatBar label="Not Started" count={cat.notStarted} total={cat.total} color="red" />
                  </div>
                  <button
                    onClick={() => { setFilterType(cat.type); setFilterStatus('All'); setSearchQuery(''); }}
                    className="mt-4 w-full text-center text-xs font-semibold text-foreground-500 hover:text-primary-600 transition-smooth py-2 rounded-xl hover:bg-background-100 cursor-pointer"
                  >
                    View all {cat.type} <i className="ri-arrow-right-line ml-0.5"></i>
                  </button>
                </div>
              );
            })}
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            AT RISK + QUICK WINS
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={140}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* At Risk */}
            <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5">
              <div className="flex items-center gap-3 mb-4">
                <span className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                  <i className="ri-error-warning-line text-red-600"></i>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">At-Risk KSBs</h3>
                  <p className="text-xs text-foreground-400">{atRiskKSBs.length} KSBs below 40% — need attention</p>
                </div>
              </div>
              <div className="space-y-2">
                {atRiskKSBs.map(ksb => {
                  const tc = typeConfig[ksb.type];
                  const isCritical = ksb.pct === 0;
                  return (
                    <div key={ksb.code} className={`rounded-xl p-3 border flex items-start gap-3 ${isCritical ? 'bg-red-50/40 border-red-200/50' : 'bg-amber-50/30 border-amber-200/40'}`}>
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${isCritical ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {ksb.code}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${tc.bg} ${tc.text}`}>{ksb.type}</span>
                          {isCritical && <span className="text-[9px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">No Evidence</span>}
                        </div>
                        <p className="text-sm text-foreground-700 leading-snug mb-2">{ksb.desc}</p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 max-w-[100px]">
                            <ProgressBar pct={ksb.pct} color={isCritical ? 'red' : 'amber'} height={3} />
                          </div>
                          <span className={`text-xs font-bold ${isCritical ? 'text-red-600' : 'text-amber-600'}`}>{ksb.pct}%</span>
                          {ksb.evidence > 0 && <span className="text-[10px] text-foreground-400">{ksb.evidence} items</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Wins */}
            <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5">
              <div className="flex items-center gap-3 mb-4">
                <span className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                  <i className="ri-rocket-line text-emerald-600"></i>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Quick Wins</h3>
                  <p className="text-xs text-foreground-400">Close to completion — push these over</p>
                </div>
              </div>
              <div className="space-y-2">
                {quickWins.map(ksb => {
                  const tc = typeConfig[ksb.type];
                  return (
                    <div key={ksb.code} className="rounded-xl p-3 border border-emerald-200/40 bg-emerald-50/20 flex items-start gap-3">
                      <span className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0 text-xs font-bold text-emerald-700">
                        {ksb.code}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${tc.bg} ${tc.text}`}>{ksb.type}</span>
                          <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded">{ksb.status}</span>
                        </div>
                        <p className="text-sm text-foreground-700 leading-snug mb-2">{ksb.desc}</p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 max-w-[100px]">
                            <ProgressBar pct={ksb.pct} color="emerald" height={3} />
                          </div>
                          <span className="text-xs font-bold text-emerald-600">{ksb.pct}%</span>
                          <span className="text-[10px] text-foreground-400">{ksb.evidence} items</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            KSB REGISTER
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={180}>
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-heading font-semibold text-foreground-900">KSB Register</h2>
                <p className="text-sm text-foreground-400">All {KSB_RECORDS.length} KSBs</p>
              </div>
              <Link
                to="/learner/evidence"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-500 text-background-50 text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
              >
                <i className="ri-upload-cloud-line"></i> Upload Evidence
              </Link>
            </div>

            {/* Filters */}
            <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
                  <input
                    type="text"
                    placeholder="Search by code or description..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-background-100 border border-background-200 text-sm text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100/50 transition-smooth"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-smooth cursor-pointer whitespace-nowrap border ${
                      hasActiveFilters
                        ? 'bg-primary-50 text-primary-700 border-primary-200/50'
                        : 'bg-background-100 text-foreground-500 border-transparent hover:border-foreground-200/40'
                    }`}
                  >
                    <i className="ri-filter-3-line text-sm"></i>
                    Filters
                    {hasActiveFilters && (
                      <span className="w-2 h-2 rounded-full bg-primary-500"></span>
                    )}
                  </button>
                  <button
                    onClick={() => setSortBy(sortBy === 'code' ? 'pct' : 'code')}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-background-100 text-sm font-semibold text-foreground-500 hover:text-foreground-700 transition-smooth cursor-pointer whitespace-nowrap border border-transparent hover:border-foreground-200/40"
                  >
                    <i className={`${sortBy === 'code' ? 'ri-sort-alphabet-asc' : 'ri-sort-number-desc'} text-sm`}></i>
                    {sortBy === 'code' ? 'By Code' : 'By Progress'}
                  </button>
                </div>
              </div>

              {/* Expandable filters */}
              {showFilters && (
                <div className="mt-3 pt-3 border-t border-foreground-200/60 space-y-3 animate-in slide-in-from-top-2 duration-200">
                  <div>
                    <p className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-2">Type</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(['All', 'Knowledge', 'Skill', 'Behaviour'] as const).map(f => {
                        const count = f === 'All' ? KSB_RECORDS.length : KSB_RECORDS.filter(k => k.type === f).length;
                        return (
                          <button
                            key={f}
                            onClick={() => setFilterType(f)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                              filterType === f
                                ? 'bg-foreground-900 text-background-50 dark:text-foreground-950'
                                : 'bg-background-100 text-foreground-500 hover:text-foreground-700'
                            }`}
                          >
                            {f === 'All' ? 'All Types' : f}
                            <span className={`text-[10px] px-1 py-0.5 rounded-full ${filterType === f ? 'bg-white/15' : 'bg-background-200/60 text-foreground-400'}`}>{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-2">Status</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(['All', 'Validated', 'Evidenced', 'Applied', 'Pending', 'Not Started'] as const).map(s => {
                        const count = s === 'All' ? KSB_RECORDS.length : KSB_RECORDS.filter(k => k.status === s).length;
                        return (
                          <button
                            key={s}
                            onClick={() => setFilterStatus(s)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                              filterStatus === s
                                ? 'bg-foreground-900 text-background-50 dark:text-foreground-950'
                                : 'bg-background-100 text-foreground-500 hover:text-foreground-700'
                            }`}
                          >
                            {s === 'All' ? 'All Status' : s}
                            <span className={`text-[10px] px-1 py-0.5 rounded-full ${filterStatus === s ? 'bg-white/15' : 'bg-background-200/60 text-foreground-400'}`}>{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {hasActiveFilters && (
                    <div className="pt-2 border-t border-foreground-200/60">
                      <button
                        onClick={() => { setFilterType('All'); setFilterStatus('All'); setSearchQuery(''); }}
                        className="flex items-center gap-1.5 text-xs text-primary-600 font-semibold hover:text-primary-700 cursor-pointer"
                      >
                        <i className="ri-close-circle-line"></i> Clear all filters
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-foreground-400 pt-3 mt-3 border-t border-foreground-200/60">
                <span>Showing {filteredKSBs.length} of {KSB_RECORDS.length} KSBs</span>
                {(filterType !== 'All' || filterStatus !== 'All' || searchQuery) && (
                  <button
                    onClick={() => { setFilterType('All'); setFilterStatus('All'); setSearchQuery(''); }}
                    className="text-primary-600 hover:text-primary-700 font-medium cursor-pointer"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="bg-background-50 rounded-2xl border border-foreground-200/60 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-foreground-200 bg-background-100/50">
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3 w-16">Code</th>
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3">Description</th>
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3 w-16">Type</th>
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3 w-32">Progress</th>
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3 w-28">Status</th>
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3 w-20">Evidence</th>
                      <th className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider px-5 py-3 w-28">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredKSBs.map((ksb, i) => {
                      const tc = typeConfig[ksb.type];
                      const st = statusConfig[ksb.status];
                      return (
                        <tr key={ksb.code} className={`border-b border-background-100/80 hover:bg-background-100/40 transition-smooth ${i % 2 === 0 ? 'bg-transparent' : 'bg-background-50/30'}`}>
                          <td className="px-5 py-3.5">
                            <span className={`text-xs font-bold px-2 py-1 rounded-lg ${tc.bg} ${tc.text}`}>
                              {ksb.code}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-sm text-foreground-700 leading-snug">{ksb.desc}</td>
                          <td className="px-5 py-3.5">
                            <span className="text-xs text-foreground-400">{ksb.type}</span>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 min-w-[50px]">
                                <ProgressBar pct={ksb.pct} color={ksb.pct >= 80 ? 'emerald' : ksb.pct >= 50 ? 'amber' : ksb.pct > 0 ? 'primary' : 'red'} height={4} />
                              </div>
                              <span className="text-xs font-semibold text-foreground-700 w-8 text-right">{ksb.pct}%</span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${st.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`}></span>
                              {st.label}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`text-xs ${ksb.evidence > 0 ? 'text-foreground-600 font-medium' : 'text-foreground-300'}`}>
                              {ksb.evidence > 0 ? `${ksb.evidence} item${ksb.evidence > 1 ? 's' : ''}` : '—'}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-xs text-foreground-400">{ksb.updated}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredKSBs.length === 0 && (
                <div className="py-12 text-center">
                  <span className="w-12 h-12 rounded-2xl bg-background-100 flex items-center justify-center mx-auto mb-3">
                    <i className="ri-search-line text-foreground-300 text-xl"></i>
                  </span>
                  <p className="text-sm text-foreground-500">No KSBs match your filters</p>
                  <button
                    onClick={() => { setFilterType('All'); setFilterStatus('All'); setSearchQuery(''); }}
                    className="mt-2 text-xs font-semibold text-primary-600 hover:text-primary-700 cursor-pointer"
                  >
                    Clear all filters
                  </button>
                </div>
              )}
            </div>
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            GATEWAY READINESS
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={220}>
          <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-6 md:p-8">
            <div className="flex flex-col lg:flex-row lg:items-center gap-6 md:gap-10">
              <div className="flex items-center gap-4 shrink-0">
                <div className="relative">
                  <DonutRing pct={totalPct} size={80} stroke={7} color={heroColor} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-lg font-heading font-bold text-foreground-900">{totalPct}%</span>
                    <span className="text-[9px] text-foreground-400">ready</span>
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Gateway Readiness</h3>
                  <p className="text-xs text-foreground-400 mt-0.5">Target: {p.gatewayTargetDate}</p>
                </div>
              </div>

              <div className="flex-1 grid grid-cols-3 gap-3">
                <div className="text-center bg-background-100 rounded-xl p-4">
                  <p className="text-lg font-heading font-bold text-emerald-700">{validated}</p>
                  <p className="text-[10px] text-foreground-400 mt-0.5">Validated</p>
                </div>
                <div className="text-center bg-background-100 rounded-xl p-4">
                  <p className="text-lg font-heading font-bold text-foreground-900">{evidenced + applied}</p>
                  <p className="text-[10px] text-foreground-400 mt-0.5">In Progress</p>
                </div>
                <div className="text-center bg-background-100 rounded-xl p-4">
                  <p className="text-lg font-heading font-bold text-red-600">{notStarted}</p>
                  <p className="text-[10px] text-foreground-400 mt-0.5">Not Started</p>
                </div>
              </div>

              <div className="shrink-0 flex flex-col gap-2">
                <Link
                  to="/learner/gateway"
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary-500 text-background-50 text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-flag-line"></i> View Gateway
                </Link>
                <Link
                  to="/learner/evidence"
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-foreground-200 text-sm font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-upload-cloud-line"></i> Add Evidence
                </Link>
              </div>
            </div>
          </div>
        </SectionReveal>

        {/* ═══════════════════════════════════════════════════
            SUGGESTED EVIDENCE
            ═══════════════════════════════════════════════════ */}
        <SectionReveal delay={260}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-heading font-semibold text-foreground-900">Suggested Evidence</h2>
                <p className="text-sm text-foreground-400">Opportunities to build your portfolio</p>
              </div>
              <Link
                to="/learner/evidence"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:text-primary-700 whitespace-nowrap cursor-pointer"
              >
                <i className="ri-add-line"></i> Upload
              </Link>
            </div>
            <div className="space-y-3">
              {SUGGESTED_EVIDENCE.map((se, i) => (
                <div key={i} className="bg-background-50 rounded-2xl border border-foreground-200/60 p-5 group">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                    <span className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                      <i className="ri-lightbulb-line text-primary-600 text-lg"></i>
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-1">{se.title}</h3>
                      <p className="text-sm text-foreground-500 leading-relaxed mb-3">{se.reason}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-primary-700 bg-primary-50 px-2.5 py-1 rounded-full">
                          <i className="ri-link mr-1"></i>{se.linksTo}
                        </span>
                        <span className="text-xs text-foreground-400">{se.ksbCount} KSB{se.ksbCount > 1 ? 's' : ''} covered</span>
                      </div>
                    </div>
                    <Link
                      to="/learner/evidence"
                      className="inline-flex items-center gap-1.5 shrink-0 px-4 py-2 bg-primary-500 text-background-50 rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth whitespace-nowrap cursor-pointer self-start"
                    >
                      <i className="ri-upload-cloud-line"></i> Add
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SectionReveal>

      </div>
    </WorkspaceShell>
  );
}

/* ── Stat Card ── */
function StatCard({ label, value, total, color, icon }: { label: string; value: number; total: number; color: string; icon: string }) {
  const pct = Math.round((value / total) * 100);
  const colorMap: Record<string, { iconBg: string; iconText: string; accent: string; bar: string }> = {
    emerald: { iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', accent: 'text-emerald-700', bar: 'bg-emerald-500' },
    amber: { iconBg: 'bg-amber-100', iconText: 'text-amber-600', accent: 'text-amber-700', bar: 'bg-amber-500' },
    primary: { iconBg: 'bg-primary-100', iconText: 'text-primary-600', accent: 'text-primary-700', bar: 'bg-primary-500' },
    red: { iconBg: 'bg-red-100', iconText: 'text-red-600', accent: 'text-red-700', bar: 'bg-red-500' },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
      <div className="flex items-center gap-2.5 mb-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.iconBg} ${c.iconText}`}>
          <i className={`${icon} text-sm`}></i>
        </span>
        <span className="text-xs text-foreground-400">{label}</span>
      </div>
      <p className={`text-xl font-heading font-bold ${c.accent}`}>{value}<span className="text-sm font-normal text-foreground-300">/{total}</span></p>
      <div className="mt-2">
        <div className="w-full rounded-full bg-background-200 overflow-hidden h-[3px]">
          <div className={`h-full rounded-full transition-all duration-700 ${c.bar}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

/* ── Stat Bar ── */
function StatBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const colorMap: Record<string, { dot: string; bar: string; text: string }> = {
    emerald: { dot: 'bg-emerald-400', bar: 'bg-emerald-500', text: 'text-emerald-700' },
    amber: { dot: 'bg-amber-400', bar: 'bg-amber-500', text: 'text-amber-700' },
    primary: { dot: 'bg-primary-400', bar: 'bg-primary-500', text: 'text-primary-700' },
    red: { dot: 'bg-red-400', bar: 'bg-red-500', text: 'text-red-700' },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 w-20 shrink-0">
        <span className={`w-2 h-2 rounded-full ${c.dot}`}></span>
        <span className="text-xs text-foreground-500">{label}</span>
      </div>
      <div className="flex-1">
        <div className="w-full rounded-full bg-background-200 overflow-hidden h-[4px]">
          <div className={`h-full rounded-full transition-all duration-700 ${c.bar}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className={`text-xs font-semibold w-8 text-right ${c.text}`}>{count}</span>
    </div>
  );
}