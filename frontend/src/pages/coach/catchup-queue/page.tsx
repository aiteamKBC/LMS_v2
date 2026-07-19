import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { RightSlidePanel } from '@/components/feature/RightSlidePanel';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import {
  type CatchUpItem,
} from '@/mocks/catchup-queue';
import {
  type CoachCalendarEvent,
  eventDisplayDate,
  fetchCoachCalendarEvents,
  formatDateLabel,
  initialsFor,
  parseLocalDate,
  startOfDay,
} from '@/pages/coach/shared/calendarEvents';

const coachNav = roleNavMap.coach;

const priorityConfig: Record<string, { bg: string; text: string; label: string }> = {
  high: { bg: 'bg-red-100', text: 'text-red-700', label: 'High' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Medium' },
  low: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Low' },
};

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  scheduled: { bg: 'bg-primary-100', text: 'text-primary-700', label: 'Scheduled' },
  overdue: { bg: 'bg-red-100', text: 'text-red-700', label: 'Overdue' },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Completed' },
};

function calendarEventToCatchUp(event: CoachCalendarEvent): CatchUpItem {
  const today = startOfDay();
  const targetDateIso = event.targetDate || event.date || event.scheduledDate || '';
  const catchupDateIso = eventDisplayDate(event) || targetDateIso;
  const catchupDate = parseLocalDate(catchupDateIso);
  const completed = event.status === 'completed' || event.status === 'confirmed';
  const overdue = !completed && !!catchupDate && catchupDate.getTime() < today.getTime();
  const status: CatchUpItem['status'] = completed ? 'completed' : overdue ? 'overdue' : 'scheduled';
  const daysUntil = catchupDate ? Math.ceil((catchupDate.getTime() - today.getTime()) / 86_400_000) : 30;
  const priority: CatchUpItem['priority'] = overdue || event.priority === 'high' || event.priority === 'urgent'
    ? 'high'
    : daysUntil <= 14
      ? 'medium'
      : 'low';
  const daysOverdue = overdue && catchupDate
    ? Math.max(1, Math.floor((today.getTime() - catchupDate.getTime()) / 86_400_000))
    : 0;

  return {
    id: event.eventKey || event.id,
    learner: event.learner || 'Unknown learner',
    initials: initialsFor(event.learner),
    programme: event.programme || '--',
    cohort: event.cohort || '--',
    missedSession: event.title || 'Catch-up Session',
    missedDate: formatDateLabel(targetDateIso),
    missedDateIso: targetDateIso,
    catchupDate: formatDateLabel(catchupDateIso),
    catchupDateIso,
    tutor: event.ownerName || 'Med Maher',
    status,
    priority,
    notes: event.notes || 'No notes added',
    overallProgress: 0,
    attendance: 0,
    otjhCompleted: 0,
    otjhTarget: 0,
    ksbProgress: 0,
    employer: 'Not available',
    group: 'Not available',
    evidenceSubmitted: completed,
    evidenceApproved: completed,
    reason: event.notes || 'Catch-up session',
    catchupRoute: event.meetingProvider || event.platform || 'Not specified',
    daysOverdue,
    completedDate: completed ? formatDateLabel(catchupDateIso) : '',
    completedDateIso: completed ? catchupDateIso : '',
  };
}

function buildCatchUpTrend(items: CatchUpItem[], view: 'week' | 'month', count: number) {
  const buckets: Array<{ label: string; scheduled: number; overdue: number; completed: number; start: Date; end: Date }> = [];
  const reference = startOfDay();

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    let start: Date;
    let end: Date;
    let label: string;
    if (view === 'month') {
      start = new Date(reference.getFullYear(), reference.getMonth() - offset, 1);
      end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      label = start.toLocaleDateString('en-GB', { month: 'short' });
    } else {
      const day = reference.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      start = new Date(reference);
      start.setDate(reference.getDate() + mondayOffset - offset * 7);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      label = `${start.getDate()} ${start.toLocaleDateString('en-GB', { month: 'short' })}`;
    }
    buckets.push({ label, scheduled: 0, overdue: 0, completed: 0, start, end });
  }

  items.forEach((item) => {
    const date = parseLocalDate(item.catchupDateIso || item.missedDateIso);
    if (!date) return;
    const bucket = buckets.find((entry) => date >= entry.start && date <= entry.end);
    if (bucket) bucket[item.status] += 1;
  });

  return buckets.map(({ label, scheduled, overdue, completed }) => ({ label, scheduled, overdue, completed }));
}

/* ═══════ Animation Keyframes (injected via style tag) ═══════ */
function ChartAnimations() {
  return (
    <style>{`
      @keyframes barGrow {
        from { transform: scaleY(0); }
        to { transform: scaleY(1); }
      }
      @keyframes barGrowOrigin {
        from { transform-origin: bottom; transform: scaleY(0); }
        to { transform-origin: bottom; transform: scaleY(1); }
      }
      @keyframes sliceSpin {
        from { transform: rotate(-90deg) scale(0.85); opacity: 0; }
        to { transform: rotate(0deg) scale(1); opacity: 1; }
      }
      @keyframes donutFade {
        from { stroke-dashoffset: var(--circumference); opacity: 0; }
        to { stroke-dashoffset: var(--offset); opacity: 1; }
      }
      @keyframes fadeUp {
        from { opacity: 0; transform: translateY(16px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes countPulse {
        0% { transform: scale(0.8); opacity: 0; }
        60% { transform: scale(1.05); }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes sparkDraw {
        from { stroke-dashoffset: var(--spark-dash); }
        to { stroke-dashoffset: 0; }
      }
      .animate-bar { animation: barGrowOrigin 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
      .animate-slice { transform-origin: center; animation: sliceSpin 0.8s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
      .animate-fade-up { animation: fadeUp 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
      .animate-fade-in { animation: fadeIn 0.5s ease-out forwards; }
      .animate-count { animation: countPulse 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
      .animate-stat { animation: fadeUp 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards; opacity: 0; }
      .animate-spark { stroke-dasharray: var(--spark-dash); animation: sparkDraw 1.2s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
    `}</style>
  );
}

/* ═══════ Donut Chart ═══════ */
function DonutChart({ percentage, size = 72, strokeWidth = 6, color = 'primary', animate = true }: { percentage: number; size?: number; strokeWidth?: number; color?: string; animate?: boolean }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const colorMap: Record<string, { stroke: string; text: string }> = {
    primary: { stroke: 'stroke-primary-500', text: 'text-primary-700' },
    accent: { stroke: 'stroke-accent-500', text: 'text-accent-700' },
    emerald: { stroke: 'stroke-emerald-500', text: 'text-emerald-700' },
    amber: { stroke: 'stroke-amber-500', text: 'text-amber-700' },
    red: { stroke: 'stroke-red-500', text: 'text-red-700' },
    secondary: { stroke: 'stroke-secondary-500', text: 'text-secondary-700' },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="stroke-background-200" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={`${c.stroke} ${animate ? 'animate-spark' : ''}`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ '--circumference': circumference, '--offset': offset, '--spark-dash': circumference } as React.CSSProperties}
        />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center ${animate ? 'animate-fade-in' : ''}`} style={{ animationDelay: '0.4s' }}>
        <span className={`text-sm font-bold ${c.text}`}>{percentage}%</span>
      </div>
    </div>
  );
}

/* ═══════ Sparkline ═══════ */
function Sparkline({ data, color, width = 80, height = 32, animate = true }: { data: number[]; color: string; width?: number; height?: number; animate?: boolean }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - 4) + 2;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return `${x},${y}`;
  });
  const d = points.map((p, i) => (i === 0 ? `M${p}` : `L${p}`)).join(' ');
  const strokeColors: Record<string, string> = {
    emerald: '#10b981', amber: '#f59e0b', red: '#ef4444', primary: 'oklch(var(--primary-500))', accent: 'oklch(var(--accent-500))', secondary: 'oklch(var(--secondary-500))',
  };
  const strokeDash = points.length * 40;
  return (
    <svg width={width} height={height}>
      <path
        d={d}
        fill="none"
        stroke={strokeColors[color] || strokeColors.primary}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={animate ? 'animate-spark' : ''}
        style={{ '--spark-dash': strokeDash } as React.CSSProperties}
      />
    </svg>
  );
}

/* ═══════ Stacked Bar Chart for Catch-up Trend ═══════ */
function StackedBarChart({ data, height = 260, animate = true }: { data: Array<{ label: string; scheduled: number; overdue: number; completed: number }>; height?: number; animate?: boolean }) {
  const margin = { top: 12, right: 12, bottom: 36, left: 32 };
  const w = 900;
  const h = height;
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;
  const maxVal = Math.max(...data.map((d) => d.scheduled + d.overdue + d.completed)) || 1;
  const barW = (innerW / data.length) * 0.55;
  const y = (v: number) => margin.top + innerH - (v / maxVal) * innerH;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[500px]" style={{ overflow: 'visible' }}>
      {/* grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
        const yPos = margin.top + innerH * (1 - pct);
        return (
          <g key={pct}>
            <line x1={margin.left} y1={yPos} x2={w - margin.right} y2={yPos} stroke="oklch(var(--background-300))" strokeWidth={0.5} strokeDasharray="4 4" />
            <text x={margin.left - 6} y={yPos + 3} textAnchor="end" className="text-[10px] fill-foreground-400">{Math.round(maxVal * pct)}</text>
          </g>
        );
      })}
      {/* bars */}
      {data.map((d, i) => {
        const x = margin.left + (i / data.length) * innerW + (innerW / data.length - barW) / 2;
        const sH = (d.scheduled / maxVal) * innerH;
        const oH = (d.overdue / maxVal) * innerH;
        const cH = (d.completed / maxVal) * innerH;
        const delay = `${i * 0.06}s`;
        return (
          <g key={i}>
            <g className={animate ? 'animate-bar' : ''} style={{ animationDelay: delay } as React.CSSProperties}>
              <rect x={x} y={y(d.completed)} width={barW} height={cH} fill="oklch(var(--emerald-500))" rx={2} opacity={0.9} />
            </g>
            <g className={animate ? 'animate-bar' : ''} style={{ animationDelay: `${Number(delay) + 0.04}s` } as React.CSSProperties}>
              <rect x={x} y={y(d.completed + d.scheduled)} width={barW} height={sH} fill="oklch(var(--primary-500))" rx={2} opacity={0.9} />
            </g>
            <g className={animate ? 'animate-bar' : ''} style={{ animationDelay: `${Number(delay) + 0.08}s` } as React.CSSProperties}>
              <rect x={x} y={y(d.completed + d.scheduled + d.overdue)} width={barW} height={oH} fill="#ef4444" rx={2} opacity={0.9} />
            </g>
            <text x={x + barW / 2} y={h - 8} textAnchor="middle" className={`text-[10px] fill-foreground-400 ${animate ? 'animate-fade-in' : ''}`} style={{ animationDelay: `${Number(delay) + 0.2}s` } as React.CSSProperties}>{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ═══════ Status Distribution Donut ═══════ */
function StatusDistribution({ scheduled, overdue, completed, size = 180, animate = true }: { scheduled: number; overdue: number; completed: number; size?: number; animate?: boolean }) {
  const total = scheduled + overdue + completed;
  const chartTotal = total || 1;
  const slices = [
    { label: 'Completed', value: completed, color: '#10b981', bgColor: 'bg-emerald-100', textColor: 'text-emerald-700' },
    { label: 'Scheduled', value: scheduled, color: 'oklch(var(--primary-500))', bgColor: 'bg-primary-100', textColor: 'text-primary-700' },
    { label: 'Overdue', value: overdue, color: '#ef4444', bgColor: 'bg-red-100', textColor: 'text-red-700' },
  ];
  const center = size / 2;
  const outerRadius = center - 4;
  const innerRadius = 48;
  let cumulativeAngle = -90;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={animate ? 'animate-slice' : ''}>
          {slices.map((slice, i) => {
            const angle = (slice.value / chartTotal) * 360;
            const start = cumulativeAngle;
            const end = cumulativeAngle + angle;
            cumulativeAngle = end;
            const sr = (start * Math.PI) / 180;
            const er = (end * Math.PI) / 180;
            const large = angle > 180 ? 1 : 0;
            const d = [
              `M ${center + outerRadius * Math.cos(sr)} ${center + outerRadius * Math.sin(sr)}`,
              `A ${outerRadius} ${outerRadius} 0 ${large} 1 ${center + outerRadius * Math.cos(er)} ${center + outerRadius * Math.sin(er)}`,
              `L ${center + innerRadius * Math.cos(er)} ${center + innerRadius * Math.sin(er)}`,
              `A ${innerRadius} ${innerRadius} 0 ${large} 0 ${center + innerRadius * Math.cos(sr)} ${center + innerRadius * Math.sin(sr)}`,
              'Z',
            ].join(' ');
            return <path key={i} d={d} fill={slice.color} stroke="white" strokeWidth={2} className={animate ? 'animate-slice' : ''} style={{ animationDelay: `${i * 0.12 + 0.2}s` } as React.CSSProperties} />;
          })}
          <text x={center} y={center - 6} textAnchor="middle" className={`fill-foreground-900 ${animate ? 'animate-fade-in' : ''}`} style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-heading)', animationDelay: '0.5s' }}>{total}</text>
          <text x={center} y={center + 12} textAnchor="middle" className={`fill-foreground-400 ${animate ? 'animate-fade-in' : ''}`} style={{ fontSize: '10px', animationDelay: '0.6s' }}>Catch-ups</text>
        </svg>
      </div>
      <div className={`flex items-center gap-4 flex-wrap justify-center ${animate ? 'animate-fade-up' : ''}`} style={{ animationDelay: '0.7s' }}>
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-[11px] text-foreground-600 font-medium whitespace-nowrap">{s.label}</span>
            <span className="text-[11px] font-semibold text-foreground-900">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════ Filter Dropdown ═══════ */
function FilterDropdown({ label, value, onChange, options, allLabel }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; allLabel?: string }) {
  return (
    <div className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value)} className="appearance-none pl-3 pr-8 py-2 bg-background-100 border border-foreground-200 rounded-lg text-xs font-medium text-foreground-700 cursor-pointer focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50 min-w-[140px]">
        <option value="all">{allLabel || `All ${label}s`}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <i className="ri-arrow-down-s-line absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-400 text-xs pointer-events-none"></i>
    </div>
  );
}

export default function CoachCatchupQueue() {
  const navigate = useNavigate();
  const { success, info } = useToast();

  const [filter, setFilter] = useState<'all' | 'scheduled' | 'overdue' | 'completed'>('all');
  const [cohortFilter, setCohortFilter] = useState<string>('all');
  const [programmeFilter, setProgrammeFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showEmployerDropdown, setShowEmployerDropdown] = useState(false);
  const [trendView, setTrendView] = useState<'week' | 'month'>('week');
  const [trendCount, setTrendCount] = useState<number>(12);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(8);
  const [statCardsReady, setStatCardsReady] = useState(false);
  const [chartAnimate, setChartAnimate] = useState(true);
  const [showEscalateModal, setShowEscalateModal] = useState(false);
  const [escalateReason, setEscalateReason] = useState('');
  const [escalateTo, setEscalateTo] = useState('');
  const [escalateSubmitted, setEscalateSubmitted] = useState(false);
  const [catchupQueue, setCatchupQueue] = useState<CatchUpItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');

  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setStatCardsReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setQueueLoading(true);
    setQueueError('');

    fetchCoachCalendarEvents(controller.signal)
      .then((data) => {
        const catchups = (data.events || [])
          .filter((event) => event.source === 'catch-up')
          .map(calendarEventToCatchUp);
        setCatchupQueue(catchups);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setCatchupQueue([]);
        setQueueError(requestError instanceof Error ? requestError.message : 'Could not load catch-up sessions.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setQueueLoading(false);
      });

    return () => controller.abort();
  }, []);

  const filtered = catchupQueue.filter((c) => {
    if (filter !== 'all' && c.status !== filter) return false;
    if (cohortFilter !== 'all' && c.cohort !== cohortFilter) return false;
    if (programmeFilter !== 'all' && c.programme !== programmeFilter) return false;
    if (priorityFilter !== 'all' && c.priority !== priorityFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        c.learner.toLowerCase().includes(q) ||
        c.initials.toLowerCase().includes(q) ||
        c.programme.toLowerCase().includes(q) ||
        c.cohort.toLowerCase().includes(q) ||
        c.missedSession.toLowerCase().includes(q) ||
        c.tutor.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const scheduled = catchupQueue.filter((c) => c.status === 'scheduled').length;
  const overdue = catchupQueue.filter((c) => c.status === 'overdue').length;
  const completed = catchupQueue.filter((c) => c.status === 'completed').length;
  const highPriority = catchupQueue.filter((c) => c.priority === 'high').length;
  const totalCatchups = catchupQueue.length;
  const overdueDays = catchupQueue.filter((c) => c.status === 'overdue').reduce((a, b) => a + b.daysOverdue, 0);

  const selectedItem = catchupQueue.find((c) => c.id === selectedItemId) || null;

  const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const cohorts = useMemo(() => [...new Set(catchupQueue.map((c) => c.cohort))].sort(), [catchupQueue]);
  const programmes = useMemo(() => [...new Set(catchupQueue.map((c) => c.programme))].sort(), [catchupQueue]);

  // Trend data
  const trendData = useMemo(() => {
    return buildCatchUpTrend(catchupQueue, trendView, trendCount);
  }, [catchupQueue, trendView, trendCount]);

  const maxCount = trendView === 'week' ? 52 : 12;
  const countLabel = trendView === 'week' ? 'Weeks' : 'Months';

  useEffect(() => {
    // re-trigger chart animation when trend data changes
    setChartAnimate(false);
    const t = setTimeout(() => setChartAnimate(true), 50);
    return () => clearTimeout(t);
  }, [trendData]);

  const handleExportCSV = () => {
    const headers = ['Learner', 'Programme', 'Cohort', 'Missed Session', 'Missed Date', 'Catch-up Date', 'Tutor', 'Status', 'Priority', 'Notes', 'Reason', 'Overdue Days'];
    const rows = filtered.map((c) => [
      c.learner, c.programme, c.cohort, c.missedSession, c.missedDate, c.catchupDate, c.tutor, c.status, c.priority, c.notes, c.reason, String(c.daysOverdue),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((cell) => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'catch-up-queue.csv';
    link.click();
    success('CSV exported', `${filtered.length} rows exported successfully`);
  };

  const handleExportPDF = () => {
    info('PDF export', 'PDF generation started. Download will begin shortly.');
    setTimeout(() => {
      const rows = filtered.map((c) => `${c.learner} | ${c.programme} | ${c.missedSession} | ${c.missedDate} | ${c.catchupDate} | ${c.status} | ${c.priority}`).join('\n');
      const text = `Catch-up Queue Report\nGenerated: ${new Date().toLocaleDateString()}\n\n${rows}`;
      const blob = new Blob([text], { type: 'text/plain' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'catch-up-queue-report.txt';
      link.click();
      success('PDF export', 'Report downloaded successfully');
    }, 800);
  };

  const handleViewProfile = (item: CatchUpItem) => {
    navigate(`/coach/learner-case-file?id=${item.id}`);
    success(`Opening profile`, item.learner);
  };

  const handleSendMessage = (item: CatchUpItem) => {
    const threadId = `th-catchup-${item.id}`;
    navigate(`/coach/messages?thread=${threadId}`);
  };

  const handleEmailEmployer = (item: CatchUpItem) => {
    window.open(`mailto:hr@${item.employer.toLowerCase().replace(/\s+/g, '')}.co.uk`, '_blank');
    setShowEmployerDropdown(false);
  };

  const handleZoomCall = () => {
    window.open('https://zoom.us/start/videomeeting', '_blank');
    setShowEmployerDropdown(false);
  };

  const handleOutlookCall = () => {
    window.open('https://outlook.office.com/calendar/deeplink/compose', '_blank');
    setShowEmployerDropdown(false);
  };

  const volumeTrend = trendData.map((item) => item.scheduled + item.overdue + item.completed);
  const trendUp = volumeTrend.length > 1 && volumeTrend[volumeTrend.length - 1] < volumeTrend[0];
  const percentageOfTotal = (value: number) => totalCatchups ? Math.round((value / totalCatchups) * 100) : 0;

  const statusCounts = [
    { key: 'all' as const, label: 'All', count: totalCatchups },
    { key: 'scheduled' as const, label: 'Scheduled', count: scheduled },
    { key: 'overdue' as const, label: 'Overdue', count: overdue },
    { key: 'completed' as const, label: 'Completed', count: completed },
  ];

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="Catch-up Queue" pageSubtitle="Manage and schedule catch-up sessions for missed learning" userName="Med Maher" userRole="Progress Coach">
      <ChartAnimations />
      <div className="p-4 md:p-6 space-y-6">

        {/* ===== Hero Banner ===== */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-5">
              <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
                <i className="ri-timer-line text-white text-2xl"></i>
              </span>
              <div className="flex-1">
                <h2 className="text-lg font-heading font-bold text-white mb-1">Catch-up Queue</h2>
                <p className="text-[13px] text-white/80 leading-relaxed">
                  <strong>{scheduled} scheduled</strong> catch-up sessions, <strong>{overdue} overdue</strong>, and <strong>{completed} completed</strong> across {totalCatchups} total items.
                  {highPriority} high priority items need immediate attention.{overdueDays > 0 ? ` Total ${overdueDays} overdue days accumulated.` : ''}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ===== 5 Stat Cards with staggered animation ===== */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            {
              delay: '0s',
              icon: 'ri-timer-line',
              iconColor: 'text-primary-600',
              iconBg: 'bg-primary-100',
              value: totalCatchups,
              label: 'Total Catch-ups',
              trend: trendUp ? 'Trending down' : 'Trending up',
              trendIcon: trendUp ? 'ri-arrow-down-line text-emerald-500' : 'ri-arrow-up-line text-red-500',
              trendColor: trendUp ? 'text-emerald-600' : 'text-red-500',
              sparkline: <Sparkline data={volumeTrend.slice(-6)} color="primary" width={80} height={32} animate={statCardsReady} />,
              cardBorder: 'border-foreground-200/60',
              cardHover: 'hover:border-primary-300/40',
              numberColor: 'text-foreground-900',
            },
            {
              delay: '0.08s',
              icon: 'ri-calendar-check-line',
              iconColor: 'text-primary-600',
              iconBg: 'bg-primary-100',
              value: scheduled,
              label: 'Scheduled',
              badge: `${percentageOfTotal(scheduled)}%`,
              badgeBg: 'bg-primary-100',
              badgeText: 'text-primary-700',
              cardBorder: 'border-primary-200/40',
              cardHover: 'hover:border-primary-300/60',
              numberColor: 'text-primary-600',
            },
            {
              delay: '0.16s',
              icon: 'ri-error-warning-line',
              iconColor: 'text-red-600',
              iconBg: 'bg-red-100',
              value: overdue,
              label: 'Overdue',
              badge: `${percentageOfTotal(overdue)}%`,
              badgeBg: 'bg-red-100',
              badgeText: 'text-red-700',
              sub: `${overdueDays} days overdue`,
              subColor: 'text-red-500',
              cardBorder: 'border-red-200/40',
              cardHover: 'hover:border-red-300/60',
              numberColor: 'text-red-600',
            },
            {
              delay: '0.24s',
              icon: 'ri-check-double-line',
              iconColor: 'text-emerald-600',
              iconBg: 'bg-emerald-100',
              value: completed,
              label: 'Completed',
              badge: `${percentageOfTotal(completed)}%`,
              badgeBg: 'bg-emerald-100',
              badgeText: 'text-emerald-700',
              cardBorder: 'border-emerald-200/40',
              cardHover: 'hover:border-emerald-300/60',
              numberColor: 'text-emerald-600',
            },
            {
              delay: '0.32s',
              icon: 'ri-alert-line',
              iconColor: 'text-amber-600',
              iconBg: 'bg-amber-100',
              value: highPriority,
              label: 'High Priority',
              badge: `${percentageOfTotal(highPriority)}%`,
              badgeBg: 'bg-amber-100',
              badgeText: 'text-amber-700',
              cardBorder: 'border-amber-200/40',
              cardHover: 'hover:border-amber-300/60',
              numberColor: 'text-amber-600',
            },
          ].map((card, i) => (
            <div
              key={i}
              className={`bg-background-50 rounded-xl border ${card.cardBorder} p-4 flex flex-col gap-2 ${card.cardHover} transition-smooth ${statCardsReady ? 'animate-stat' : 'opacity-0'}`}
              style={{ animationDelay: card.delay }}
            >
              <div className="flex items-center justify-between">
                <span className={`w-9 h-9 rounded-lg ${card.iconBg} flex items-center justify-center`}>
                  <i className={`${card.icon} ${card.iconColor} text-sm`}></i>
                </span>
                {card.sparkline ? (
                  <div className="w-20 h-8">{card.sparkline}</div>
                ) : card.badge ? (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${card.badgeBg} ${card.badgeText}`}>{card.badge}</span>
                ) : null}
              </div>
              <div>
                <p className={`text-2xl font-heading font-bold ${card.numberColor} ${statCardsReady ? 'animate-count' : 'opacity-0'}`} style={{ animationDelay: card.delay }}>{card.value}</p>
                <p className="text-[10px] text-foreground-400">{card.label}</p>
                {card.trend && (
                  <div className="flex items-center gap-1 mt-1">
                    <i className={`${card.trendIcon} text-[10px]`}></i>
                    <span className={`text-[10px] font-medium ${card.trendColor}`}>{card.trend}</span>
                  </div>
                )}
                {card.sub && <p className={`text-[10px] mt-0.5 ${card.subColor}`}>{card.sub}</p>}
              </div>
            </div>
          ))}
        </div>

        {/* ===== Charts Row ===== */}
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Stacked Bar Trend */}
          <div className="flex-1 min-w-0 bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="p-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center">
                    <i className="ri-bar-chart-grouped-line text-accent-600 text-sm"></i>
                  </span>
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground-900">Catch-up Volume Trend</h3>
                    <p className="text-[10px] text-foreground-400">Scheduled, overdue, and completed sessions over time</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-background-100 rounded-lg p-1">
                    <button onClick={() => setTrendView('week')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${trendView === 'week' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Week</button>
                    <button onClick={() => setTrendView('month')} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${trendView === 'month' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>Month</button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-foreground-400">Show</span>
                    <input type="number" min={1} max={maxCount} value={trendCount} onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= maxCount) setTrendCount(v); }} className="w-12 px-2 py-1 bg-background-100 border border-foreground-200 rounded-md text-[11px] text-center text-foreground-700 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50" />
                    <span className="text-[10px] text-foreground-400">{countLabel}</span>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto overflow-y-visible" ref={barRef}>
                <StackedBarChart data={trendData} height={260} animate={chartAnimate} />
              </div>
              {/* Legend */}
              <div className="flex items-center gap-4 mt-3 flex-wrap justify-center">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-emerald-500"></span>
                  <span className="text-[11px] text-foreground-500 font-medium">Completed</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-primary-500"></span>
                  <span className="text-[11px] text-foreground-500 font-medium">Scheduled</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-red-500"></span>
                  <span className="text-[11px] text-foreground-500 font-medium">Overdue</span>
                </div>
              </div>
            </div>
          </div>

          {/* Status Distribution */}
          <div className="lg:w-[280px] shrink-0 bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            <div className="p-5 flex flex-col items-center h-full">
              <div className="flex items-center gap-2.5 mb-4 self-start">
                <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                  <i className="ri-pie-chart-line text-red-600 text-sm"></i>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Status Distribution</h3>
                  <p className="text-[10px] text-foreground-400">Current catch-up breakdown</p>
                </div>
              </div>
              <StatusDistribution scheduled={scheduled} overdue={overdue} completed={completed} size={180} animate={chartAnimate} />
            </div>
          </div>
        </div>

        {/* ===== Status Tabs (like the screenshot) ===== */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 w-fit flex-wrap">
            {statusCounts.map((s) => (
              <button
                key={s.key}
                onClick={() => { setFilter(s.key); setCurrentPage(1); }}
                className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                  filter === s.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
                }`}
              >
                {s.label} <span className="text-[10px] opacity-60">({s.count})</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleExportCSV} className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-1.5">
              <i className="ri-file-download-line text-sm"></i> Export CSV
            </button>
            <button onClick={handleExportPDF} className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-1.5">
              <i className="ri-file-pdf-line text-sm"></i> Export PDF
            </button>
          </div>
        </div>

        {/* ===== Search + Filters (no status dropdown) ===== */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
            <div className="relative flex-1 w-full">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
              <input type="text" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }} placeholder="Search learners, sessions, tutors..." className="w-full pl-9 pr-3 py-2 bg-background-100 border border-foreground-200 rounded-lg text-xs text-foreground-700 placeholder:text-foreground-400 focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50" />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(''); setCurrentPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-400 hover:text-foreground-600 cursor-pointer">
                  <i className="ri-close-line text-xs"></i>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <FilterDropdown label="Cohort" allLabel="All Cohorts" value={cohortFilter} onChange={(v) => { setCohortFilter(v); setCurrentPage(1); }} options={cohorts.map((c) => ({ value: c, label: c }))} />
              <FilterDropdown label="Programme" allLabel="All Programmes" value={programmeFilter} onChange={(v) => { setProgrammeFilter(v); setCurrentPage(1); }} options={programmes.map((c) => ({ value: c, label: c }))} />
              <div className="relative">
                <select value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setCurrentPage(1); }} className="appearance-none pl-3 pr-8 py-2 bg-background-100 border border-foreground-200 rounded-lg text-xs font-medium text-foreground-700 cursor-pointer focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-300/50 min-w-[140px]">
                  <option value="all">All Priorities</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <i className="ri-arrow-down-s-line absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-400 text-xs pointer-events-none"></i>
              </div>
              {(filter !== 'all' || cohortFilter !== 'all' || programmeFilter !== 'all' || priorityFilter !== 'all' || searchQuery) && (
                <button onClick={() => { setFilter('all'); setCohortFilter('all'); setProgrammeFilter('all'); setPriorityFilter('all'); setSearchQuery(''); setCurrentPage(1); }} className="px-2 py-2 rounded-lg text-[11px] text-foreground-400 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-close-line mr-1"></i>Clear
                </button>
              )}
            </div>
          </div>
          {/* Active tags */}
          {(filter !== 'all' || cohortFilter !== 'all' || programmeFilter !== 'all' || priorityFilter !== 'all') && (
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              <span className="text-[10px] text-foreground-400">Active filters:</span>
              {filter !== 'all' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {filter.charAt(0).toUpperCase() + filter.slice(1)}
                  <button onClick={() => { setFilter('all'); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><i className="ri-close-line"></i></button>
                </span>
              )}
              {cohortFilter !== 'all' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {cohortFilter}
                  <button onClick={() => { setCohortFilter('all'); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><i className="ri-close-line"></i></button>
                </span>
              )}
              {programmeFilter !== 'all' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {programmeFilter}
                  <button onClick={() => { setProgrammeFilter('all'); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><i className="ri-close-line"></i></button>
                </span>
              )}
              {priorityFilter !== 'all' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 flex items-center gap-1">
                  {priorityFilter.charAt(0).toUpperCase() + priorityFilter.slice(1)} Priority
                  <button onClick={() => { setPriorityFilter('all'); setCurrentPage(1); }} className="hover:text-primary-900 cursor-pointer"><i className="ri-close-line"></i></button>
                </span>
              )}
            </div>
          )}
        </div>

        {/* ===== Professional Table ===== */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-foreground-200/60">
                  <th className="pl-4 pr-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Learner</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Missed Session</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Missed Date</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap">Catch-up Date</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Status</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Priority</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider whitespace-nowrap text-center">Overdue</th>
                  <th className="pr-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-200/30">
                {queueLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-14 text-center">
                      <i className="ri-loader-4-line text-primary-500 text-2xl animate-spin inline-block mb-2"></i>
                      <p className="text-sm text-foreground-400">Loading catch-up sessions...</p>
                    </td>
                  </tr>
                ) : queueError ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-14 text-center">
                      <i className="ri-error-warning-line text-red-500 text-2xl mb-2 block"></i>
                      <p className="text-sm font-medium text-red-600">Could not load catch-up sessions</p>
                      <p className="text-[11px] text-foreground-400 mt-1">{queueError}</p>
                    </td>
                  </tr>
                ) : paginated.map((item) => {
                  const isSel = selectedItemId === item.id;
                  const pc = priorityConfig[item.priority];
                  const sc = statusConfig[item.status];
                  return (
                    <tr key={item.id} onClick={() => setSelectedItemId(isSel ? null : item.id)} className={`transition-smooth cursor-pointer ${isSel ? 'bg-primary-50/30' : 'hover:bg-background-100/50'}`}>
                      <td className="pl-4 pr-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ring-1.5 ${item.priority === 'high' ? 'bg-red-100 text-red-700 ring-red-200' : item.priority === 'medium' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}`}>
                            <span className="text-[11px] font-bold">{item.initials}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-foreground-900 truncate">{item.learner}</p>
                            <p className="text-[10px] text-foreground-400 truncate">{item.programme}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-foreground-600 whitespace-nowrap max-w-[160px] truncate">{item.missedSession}</td>
                      <td className="px-3 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">{item.missedDate}</td>
                      <td className="px-3 py-2.5 text-[11px] text-foreground-500 whitespace-nowrap">{item.catchupDate}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${sc.bg} ${sc.text} whitespace-nowrap`}>{sc.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${pc.bg} ${pc.text} whitespace-nowrap`}>{pc.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {item.status === 'overdue' ? (
                          <span className="text-[11px] font-semibold text-red-600">{item.daysOverdue}d</span>
                        ) : (
                          <span className="text-[11px] text-foreground-300">—</span>
                        )}
                      </td>
                      <td className="pr-4 py-2.5 text-center">
                        <i className={`text-foreground-300 text-sm transition-transform duration-300 ${isSel ? 'ri-arrow-up-s-line rotate-180' : 'ri-arrow-down-s-line'}`}></i>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!queueLoading && !queueError && filtered.length === 0 && (
            <div className="py-12 text-center">
              <i className="ri-search-line text-foreground-300 text-3xl mb-2 block"></i>
              <p className="text-sm text-foreground-400">No catch-up items match your filter</p>
              <button onClick={() => { setFilter('all'); setCohortFilter('all'); setProgrammeFilter('all'); setPriorityFilter('all'); setSearchQuery(''); setCurrentPage(1); }} className="mt-2 text-[11px] font-medium text-primary-600 hover:text-primary-700 cursor-pointer">Clear all filters</button>
            </div>
          )}
          {/* Pagination bar */}
          {!queueLoading && !queueError && filtered.length > 0 && <div className="px-4 py-3 bg-background-100/30 border-t border-background-200/30 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] text-foreground-400">
              <span>Showing {filtered.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0}–{Math.min(currentPage * itemsPerPage, filtered.length)} of {filtered.length} items</span>
              <span className="text-foreground-300">|</span>
              <span>Page {currentPage} of {totalPages}</span>
            </div>
            <div className="flex items-center gap-2">
              <select value={itemsPerPage} onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }} className="px-2 py-1 bg-background-100 border border-foreground-200 rounded-lg text-[11px] text-foreground-700 cursor-pointer focus:outline-none">
                <option value={5}>5</option>
                <option value={8}>8</option>
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={20}>20</option>
              </select>
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                <i className="ri-skip-back-line"></i>
              </button>
              <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                <i className="ri-arrow-left-s-line"></i>
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) { pageNum = i + 1; } else if (currentPage <= 3) { pageNum = i + 1; } else if (currentPage >= totalPages - 2) { pageNum = totalPages - 4 + i; } else { pageNum = currentPage - 2 + i; }
                  return (
                    <button key={pageNum} onClick={() => setCurrentPage(pageNum)} className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-semibold transition-smooth cursor-pointer ${currentPage === pageNum ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700 hover:bg-background-200'}`}>
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                <i className="ri-arrow-right-s-line"></i>
              </button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-[11px] text-foreground-500 hover:text-foreground-700 hover:bg-background-200 transition-smooth cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                <i className="ri-skip-forward-line"></i>
              </button>
            </div>
          </div>}
        </div>
      </div>

      {/* ═══════ Right Slide Panel ═══════ */}
      <RightSlidePanel isOpen={selectedItem !== null} onClose={() => { setSelectedItemId(null); setShowEmployerDropdown(false); }} title={selectedItem?.learner || 'Learner Detail'} width="w-[520px]">
        {selectedItem && (
          <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ring-3 ${selectedItem.priority === 'high' ? 'bg-red-100 text-red-700 ring-red-200' : selectedItem.priority === 'medium' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}`}>
                <span className="text-lg font-bold">{selectedItem.initials}</span>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[selectedItem.status].bg} ${statusConfig[selectedItem.status].text}`}>{statusConfig[selectedItem.status].label}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${priorityConfig[selectedItem.priority].bg} ${priorityConfig[selectedItem.priority].text}`}>{priorityConfig[selectedItem.priority].label} Priority</span>
                </div>
                <p className="text-[12px] text-foreground-400">{selectedItem.programme} · {selectedItem.cohort}</p>
                <p className="text-[11px] text-foreground-300 mt-0.5">{selectedItem.employer} · {selectedItem.group}</p>
              </div>
            </div>

            {/* Status Alert */}
            {selectedItem.status === 'overdue' && (
              <div className="bg-red-50/50 rounded-xl border border-red-200/30 p-4">
                <h4 className="text-[11px] font-semibold text-red-700 mb-2 flex items-center gap-1.5"><i className="ri-alert-line"></i> Overdue Alert</h4>
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200/50">{selectedItem.daysOverdue} days overdue</span>
                  <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200/50">Missed: {selectedItem.missedDate}</span>
                  <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200/50">Priority: {selectedItem.priority}</span>
                </div>
                <p className="text-[11px] text-red-500 mt-2">{selectedItem.notes}</p>
              </div>
            )}

            {/* Donut Charts */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                <DonutChart percentage={selectedItem.overallProgress} size={64} color="primary" />
                <div>
                  <p className="text-[10px] text-foreground-400">Overall Progress</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedItem.overallProgress}%</p>
                  <p className="text-[9px] text-foreground-300">{selectedItem.overallProgress >= 70 ? 'On Track' : 'Needs Support'}</p>
                </div>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                <DonutChart percentage={selectedItem.attendance} size={64} color={selectedItem.attendance >= 90 ? 'emerald' : selectedItem.attendance >= 80 ? 'amber' : 'red'} />
                <div>
                  <p className="text-[10px] text-foreground-400">Attendance</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedItem.attendance}%</p>
                  <p className="text-[9px] text-foreground-300">{selectedItem.attendance >= 90 ? 'Excellent' : selectedItem.attendance >= 80 ? 'Good' : 'At Risk'}</p>
                </div>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                <DonutChart percentage={Math.round((selectedItem.otjhCompleted / selectedItem.otjhTarget) * 100)} size={64} color={selectedItem.otjhCompleted / selectedItem.otjhTarget >= 0.7 ? 'emerald' : selectedItem.otjhCompleted / selectedItem.otjhTarget >= 0.4 ? 'amber' : 'red'} />
                <div>
                  <p className="text-[10px] text-foreground-400">OTJH</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedItem.otjhCompleted}<span className="text-sm text-foreground-400">/{selectedItem.otjhTarget}</span></p>
                  <p className="text-[9px] text-foreground-300">{Math.round((selectedItem.otjhCompleted / selectedItem.otjhTarget) * 100)}% of target</p>
                </div>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3">
                <DonutChart percentage={selectedItem.ksbProgress} size={64} color={selectedItem.ksbProgress >= 70 ? 'emerald' : selectedItem.ksbProgress >= 40 ? 'primary' : 'red'} />
                <div>
                  <p className="text-[10px] text-foreground-400">KSB Progress</p>
                  <p className="text-lg font-bold text-foreground-900">{selectedItem.ksbProgress}%</p>
                  <p className="text-[9px] text-foreground-300">{selectedItem.ksbProgress >= 70 ? 'On pace' : 'Needs Support'}</p>
                </div>
              </div>
            </div>

            {/* Details */}
            <div className="space-y-2.5">
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                <span className="text-foreground-400">Missed Session</span>
                <span className="text-foreground-900 font-medium">{selectedItem.missedSession}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                <span className="text-foreground-400">Missed Date</span>
                <span className="text-foreground-900 font-medium">{selectedItem.missedDate}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                <span className="text-foreground-400">Catch-up Date</span>
                <span className="text-foreground-900 font-medium">{selectedItem.catchupDate}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                <span className="text-foreground-400">Tutor</span>
                <span className="text-foreground-900 font-medium">{selectedItem.tutor}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                <span className="text-foreground-400">Reason</span>
                <span className="text-foreground-900 font-medium">{selectedItem.reason}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                <span className="text-foreground-400">Catch-up Route</span>
                <span className="text-foreground-900 font-medium">{selectedItem.catchupRoute}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                <span className="text-foreground-400">Status</span>
                <span className={`font-medium ${selectedItem.status === 'overdue' ? 'text-red-600' : selectedItem.status === 'scheduled' ? 'text-primary-600' : 'text-emerald-600'}`}>{selectedItem.status}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-foreground-300/50 text-[12px]">
                <span className="text-foreground-400">Evidence</span>
                <span className={`font-medium ${selectedItem.evidenceSubmitted ? 'text-emerald-600' : 'text-foreground-500'}`}>{selectedItem.evidenceSubmitted ? (selectedItem.evidenceApproved ? 'Submitted & Approved' : 'Submitted') : 'Not Submitted'}</span>
              </div>
              <div className="flex justify-between py-2 text-[12px]">
                <span className="text-foreground-400">Notes</span>
                <span className="text-foreground-900 font-medium">{selectedItem.notes}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 pt-2">

              {/* Status-aware action button */}
              {selectedItem.status === 'overdue' && (
                <button onClick={() => { setShowEscalateModal(true); setEscalateSubmitted(false); setEscalateReason(''); setEscalateTo(''); }} className="w-full px-4 py-2.5 bg-red-600 text-white rounded-lg text-[13px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5 animate-fade-up">
                  <i className="ri-alert-line"></i> Escalate
                </button>
              )}
              {selectedItem.status === 'scheduled' && (
                <button onClick={() => { info(`1:1 Session started for ${selectedItem.learner}`, 'Redirecting to Zoom...'); window.open('https://zoom.us/start/videomeeting', '_blank'); }} className="w-full px-4 py-2.5 bg-amber-600 text-white rounded-lg text-[13px] font-semibold hover:bg-amber-700 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5 animate-fade-up">
                  <i className="ri-video-line"></i> Start 1:1 Session
                </button>
              )}

              <button onClick={() => handleViewProfile(selectedItem)} className="w-full px-4 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1.5">
                <i className="ri-file-chart-line"></i> View Full Profile
              </button>
              <div className="relative">
                <button onClick={() => setShowEmployerDropdown(!showEmployerDropdown)} className="w-full px-4 py-2.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap flex items-center justify-center gap-1">
                  <i className="ri-building-2-line mr-1.5"></i> Contact Employer
                  <i className={`ri-arrow-down-s-line text-xs transition-transform ${showEmployerDropdown ? 'rotate-180' : ''}`}></i>
                </button>
                {showEmployerDropdown && (
                  <div className="absolute bottom-full left-0 right-0 mb-1 bg-background-50 rounded-xl border border-background-200 shadow-xl overflow-hidden z-50">
                    <button onClick={() => handleSendMessage(selectedItem)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer">
                      <span className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center text-primary-600"><i className="ri-message-3-line text-xs"></i></span>
                      <div><p className="font-medium">Send Message</p><p className="text-[10px] text-foreground-400">Open in-app chat</p></div>
                    </button>
                    <button onClick={() => handleEmailEmployer(selectedItem)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer border-t border-background-200/30">
                      <span className="w-7 h-7 rounded-lg bg-accent-100 flex items-center justify-center text-accent-600"><i className="ri-mail-send-line text-xs"></i></span>
                      <div><p className="font-medium">Email</p><p className="text-[10px] text-foreground-400">hr@{selectedItem.employer.toLowerCase().replace(/\s+/g, '')}.co.uk</p></div>
                    </button>
                    <button onClick={handleZoomCall} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer border-t border-background-200/30">
                      <span className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600"><i className="ri-video-line text-xs"></i></span>
                      <div><p className="font-medium">Call via Zoom</p><p className="text-[10px] text-foreground-400">Start video meeting</p></div>
                    </button>
                    <button onClick={handleOutlookCall} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-foreground-700 hover:bg-background-100 transition-smooth text-left cursor-pointer border-t border-background-200/30">
                      <span className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600"><i className="ri-calendar-event-line text-xs"></i></span>
                      <div><p className="font-medium">Schedule via Outlook</p><p className="text-[10px] text-foreground-400">Book calendar meeting</p></div>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Escalate Modal */}
            {showEscalateModal && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowEscalateModal(false)}></div>
                <div className="relative bg-background-50 rounded-2xl border border-background-200 shadow-2xl w-full max-w-[420px] overflow-hidden animate-fade-up">
                  {!escalateSubmitted ? (
                    <>
                      <div className="p-5 border-b border-foreground-200/60">
                        <div className="flex items-center gap-3">
                          <span className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                            <i className="ri-alert-line text-red-600 text-lg"></i>
                          </span>
                          <div>
                            <h3 className="text-sm font-heading font-semibold text-foreground-900">Escalate Catch-up</h3>
                            <p className="text-[11px] text-foreground-400">{selectedItem.learner} — {selectedItem.missedSession}</p>
                          </div>
                        </div>
                      </div>
                      <div className="p-5 space-y-4">
                        <div>
                          <label className="text-[11px] font-semibold text-foreground-700 mb-1.5 block">Escalate to</label>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { value: 'engagement-team', label: 'Engagement Team', icon: 'ri-team-line' },
                              { value: 'leadership', label: 'Leadership', icon: 'ri-shield-star-line' },
                              { value: 'employer', label: 'Employer', icon: 'ri-building-2-line' },
                              { value: 'safeguarding', label: 'Safeguarding', icon: 'ri-shield-check-line' },
                            ].map((opt) => (
                              <button
                                key={opt.value}
                                onClick={() => setEscalateTo(opt.value)}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-medium transition-smooth cursor-pointer border ${
                                  escalateTo === opt.value
                                    ? 'border-red-300 bg-red-50 text-red-700'
                                    : 'border-foreground-200/60 text-foreground-600 hover:bg-background-100'
                                }`}
                              >
                                <i className={`${opt.icon} text-sm`}></i>
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-foreground-700 mb-1.5 block">Reason for escalation</label>
                          <textarea
                            value={escalateReason}
                            onChange={(e) => setEscalateReason(e.target.value.slice(0, 500))}
                            placeholder="Explain why this catch-up needs escalation..."
                            rows={3}
                            className="w-full px-3 py-2 bg-background-100 border border-foreground-200 rounded-lg text-xs text-foreground-700 placeholder:text-foreground-400 focus:outline-none focus:border-red-300 focus:ring-1 focus:ring-red-300/50 resize-none"
                          />
                          <div className="flex justify-between mt-1">
                            <span className="text-[10px] text-foreground-400">{escalateReason.length}/500</span>
                            {escalateReason.length >= 500 && <span className="text-[10px] text-red-500">Maximum reached</span>}
                          </div>
                        </div>
                        <div className="bg-red-50/50 rounded-lg border border-red-200/30 p-3">
                          <div className="flex items-start gap-2">
                            <i className="ri-information-line text-red-500 text-sm mt-0.5"></i>
                            <p className="text-[11px] text-red-600 leading-relaxed">This will notify the selected team and add a flag to the learner's record. The escalation will be tracked in the system.</p>
                          </div>
                        </div>
                      </div>
                      <div className="p-5 border-t border-foreground-200/60 flex items-center gap-2">
                        <button onClick={() => setShowEscalateModal(false)} className="flex-1 px-4 py-2.5 bg-background-100 rounded-lg text-[13px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (!escalateTo) { info('Please select a team', 'Choose who to escalate to'); return; }
                            setEscalateSubmitted(true);
                            setTimeout(() => {
                              setShowEscalateModal(false);
                              success('Escalation sent', `${selectedItem.learner} escalated to ${escalateTo.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}`);
                            }, 1500);
                          }}
                          disabled={!escalateTo || !escalateReason.trim()}
                          className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-[13px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Confirm Escalation
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="p-8 flex flex-col items-center text-center animate-fade-in">
                      <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mb-3">
                        <i className="ri-check-line text-red-600 text-2xl"></i>
                      </div>
                      <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-1">Escalation Sent</h3>
                      <p className="text-[12px] text-foreground-500 mb-4">{selectedItem.learner} has been escalated to {escalateTo.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}</p>
                      <p className="text-[11px] text-foreground-400 bg-background-100 rounded-lg px-3 py-2 max-w-full truncate">"{escalateReason}"</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </RightSlidePanel>
    </WorkspaceShell>
  );
}
