import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { getGuidesForRole, type GuideSection } from '@/mocks/user-guide-data';

const learnerNav = roleNavMap.learner;
const p = LEARNER_PROFILE;

const RECOMMENDED_FIRST = ['learner-overview', 'learner-this-week', 'learner-ksbs'];

const FLOW_ZONES = [
  { zone: 'core', label: 'Core Learning', icon: 'ri-compass-3-line', color: 'primary', order: 1, guides: ['learner-overview', 'learner-this-week', 'learner-training-plan', 'learner-modules'] },
  { zone: 'assessments', label: 'Assessments', icon: 'ri-questionnaire-line', color: 'accent', order: 2, guides: ['learner-quizzes'] },
  { zone: 'progress', label: 'Progress & Evidence', icon: 'ri-bar-chart-2-line', color: 'secondary', order: 3, guides: ['learner-ksbs', 'learner-evidence', 'learner-otjh'] },
  { zone: 'attendance', label: 'Attendance', icon: 'ri-calendar-check-line', color: 'primary', order: 4, guides: ['learner-attendance', 'learner-catchup'] },
  { zone: 'reviews', label: 'Reviews & Coaching', icon: 'ri-chat-smile-2-line', color: 'accent', order: 5, guides: ['learner-monthly-cycle', 'learner-monthly-coaching', 'learner-progress-reviews'] },
  { zone: 'gateway', label: 'Gateway', icon: 'ri-flag-line', color: 'secondary', order: 6, guides: ['learner-gateway'] },
  { zone: 'community', label: 'Community', icon: 'ri-team-line', color: 'primary', order: 7, guides: ['learner-rewards', 'learner-clubs', 'learner-calendar'] },
  { zone: 'account', label: 'Account & Help', icon: 'ri-settings-3-line', color: 'secondary', order: 8, guides: ['learner-profile', 'learner-support', 'learner-messages'] },
];

function loadReadGuides(): Set<string> {
  try {
    const raw = localStorage.getItem('ug-read-guides');
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveReadGuides(set: Set<string>) {
  try { localStorage.setItem('ug-read-guides', JSON.stringify([...set])); } catch { /* noop */ }
}

export default function UserGuidePage() {
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [readGuides, setReadGuides] = useState<Set<string>>(() => loadReadGuides());
  const [showVideo, setShowVideo] = useState(true);
  const navigate = useNavigate();

  const allGuides = getGuidesForRole('learner');
  const guideMap = useMemo(() => {
    const map: Record<string, GuideSection> = {};
    allGuides.forEach(g => { map[g.id] = g; });
    return map;
  }, [allGuides]);

  const readCount = useMemo(() => {
    return allGuides.filter(g => readGuides.has(g.id)).length;
  }, [allGuides, readGuides]);

  const progressPercent = allGuides.length > 0 ? Math.round((readCount / allGuides.length) * 100) : 0;

  const toggleRead = (id: string) => {
    setReadGuides(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveReadGuides(next);
      return next;
    });
  };

  const toggleGuide = (id: string) => {
    setExpandedGuide(prev => prev === id ? null : id);
    setActiveStep(null);
  };

  const recommendedGuides = RECOMMENDED_FIRST.map(id => guideMap[id]).filter(Boolean);

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="User Guide" pageSubtitle="Everything you need to know about your LearningOS dashboard — explore, click, and learn"
      userName={p.fullName} userRole={`${p.programme} Apprentice`}
    >
      <div className="p-4 md:p-6 space-y-6">

        {/* ══════════════════════════════════════════════════════════
            SECTION 1 — QUICK START VIDEO
            ══════════════════════════════════════════════════════════ */}
        {showVideo && (
          <section className="relative rounded-2xl overflow-hidden bg-foreground-900 border border-foreground-800">
            <button
              onClick={() => setShowVideo(false)}
              className="absolute top-3 right-3 z-20 w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm flex items-center justify-center cursor-pointer transition-smooth"
              aria-label="Close video"
            >
              <i className="ri-close-line text-white text-xs"></i>
            </button>

            {/* Video Thumbnail */}
            <div className="relative w-full aspect-[21/9] bg-foreground-950 overflow-hidden">
              <img
                src="https://readdy.ai/api/search-image?query=Modern%20minimalist%20clean%20abstract%20geometric%20background%20with%20soft%20flowing%20gradient%20shapes%20in%20warm%20gold%20and%20deep%20navy%20tones%20representing%20learning%20platform%20interface%20overview%20professional%20corporate%20training%20video%20intro%20aesthetic%20with%20subtle%20tech%20patterns%20and%20elegant%20composition&width=1600&height=686&seq=ug-video-thumb-01&orientation=landscape"
                alt="Quick Start Video — LearningOS Dashboard Overview"
                className="w-full h-full object-cover opacity-70"
                loading="eager"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-foreground-950/70 via-foreground-950/30 to-transparent" />

              {/* Play Button */}
              <button className="absolute inset-0 flex items-center justify-center cursor-pointer group" aria-label="Play Quick Start Video">
                <span className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border-2 border-white/30 group-hover:bg-white/30 group-hover:scale-105 transition-all duration-300">
                  <i className="ri-play-fill text-white text-3xl sm:text-4xl ml-1"></i>
                </span>
              </button>

              {/* Overlay Info Bar */}
              <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="px-2.5 py-1 rounded-full bg-accent-500/20 backdrop-blur-sm border border-accent-400/30 text-accent-300 text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5">
                    <i className="ri-play-circle-line text-xs"></i> Quick Start Video
                  </span>
                  <span className="text-white/60 text-[11px] hidden sm:inline">Get to know your dashboard in under 4 minutes</span>
                </div>
                <span className="px-2 py-0.5 rounded bg-white/10 text-white/60 text-[10px] font-medium">4 min</span>
              </div>
            </div>
          </section>
        )}

        {/* ══════════════════════════════════════════════════════════
            SECTION 2 — HERO (compact)
            ══════════════════════════════════════════════════════════ */}
        <section className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(145deg, oklch(var(--primary-900)) 0%, oklch(var(--primary-800)) 50%, oklch(var(--primary-700)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-15" style={{ width: '50%', height: '35%', left: '-5%', top: '-15%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.2) 0%, transparent 70%)', filter: 'blur(70px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-10" style={{ width: '55%', height: '30%', right: '-10%', bottom: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.15) 0%, transparent 70%)', filter: 'blur(60px)' }} />
          </div>
          <div className="relative p-5 sm:p-6 flex flex-col lg:flex-row items-start lg:items-center gap-5">
            <span className="w-12 h-12 rounded-2xl bg-white/12 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-book-read-line text-white text-xl"></i>
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-heading font-bold text-white mb-1.5">Your Complete Dashboard Guide</h2>
              <p className="text-sm text-white/70 leading-relaxed max-w-2xl">
                Welcome to your LearningOS guide. Explore every page, understand every feature, and learn how to get the most out of your apprenticeship journey — all in one place.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="px-3 py-1.5 rounded-lg bg-white/10 text-white/80 text-xs font-medium">{allGuides.length} pages</span>
              <span className="px-3 py-1.5 rounded-lg bg-white/10 text-white/80 text-xs font-medium">{FLOW_ZONES.length} zones</span>
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════
            SECTION 3 — GETTING STARTED WIZARD
            ══════════════════════════════════════════════════════════ */}
        <section className="bg-background-50 rounded-2xl border border-background-200/50 overflow-hidden">
          <div className="p-5 border-b border-background-200/40">
            <div className="flex items-center gap-3 mb-1">
              <span className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center">
                <i className="ri-compass-3-line text-accent-600 text-sm"></i>
              </span>
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">First Time Here? Start With These 3</h3>
                <p className="text-xs text-foreground-400">Follow this recommended path to get comfortable with your dashboard in the right order.</p>
              </div>
            </div>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {recommendedGuides.map((guide, idx) => (
                <div key={guide.id} className="relative group">
                  {/* Connector between steps (desktop only) */}
                  {idx < recommendedGuides.length - 1 && (
                    <div className="hidden lg:flex absolute top-8 -right-2 z-10 items-center text-foreground-200">
                      <i className="ri-arrow-right-line text-lg"></i>
                    </div>
                  )}
                  <div className="bg-white rounded-xl border border-background-200/60 p-4 h-full hover:border-accent-200/60 transition-smooth">
                    {/* Step number badge */}
                    <div className="flex items-start justify-between mb-3">
                      <span className="w-8 h-8 rounded-full bg-accent-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                        {idx + 1}
                      </span>
                      {readGuides.has(guide.id) && (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">
                          <i className="ri-check-line text-[10px]"></i> Read
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm font-heading font-semibold text-foreground-900 mb-1">{guide.title}</h4>
                    <p className="text-xs text-foreground-400 leading-relaxed mb-3 line-clamp-2">{guide.description}</p>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(guide.pagePath)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary-500 text-background-50 text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
                      >
                        <i className="ri-arrow-right-line"></i> Open Page
                      </button>
                      <button
                        onClick={() => toggleGuide(guide.id)}
                        className="w-8 h-8 rounded-lg border border-background-200/60 flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:border-background-300 transition-smooth cursor-pointer"
                        title="Read guide"
                      >
                        <i className="ri-book-open-line text-xs"></i>
                      </button>
                      <button
                        onClick={() => toggleRead(guide.id)}
                        className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-smooth cursor-pointer ${
                          readGuides.has(guide.id)
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-600'
                            : 'border-background-200/60 text-foreground-400 hover:text-foreground-700'
                        }`}
                        title={readGuides.has(guide.id) ? 'Mark as unread' : 'Mark as read'}
                      >
                        <i className={`${readGuides.has(guide.id) ? 'ri-check-double-line' : 'ri-check-line'} text-xs`}></i>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════
            SECTION 4 — READING PROGRESS BAR
            ══════════════════════════════════════════════════════════ */}
        <section className="bg-background-50 rounded-2xl border border-background-200/50 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <i className="ri-book-read-line text-foreground-400 text-sm"></i>
              <span className="text-xs font-semibold text-foreground-700">Your Reading Progress</span>
            </div>
            <span className="text-xs font-bold text-primary-600">{readCount} / {allGuides.length} guides</span>
          </div>
          <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${progressPercent}%`,
                background: 'linear-gradient(90deg, oklch(var(--primary-400)), oklch(var(--primary-500)))',
              }}
            />
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-[10px] text-foreground-400">{progressPercent}% complete</span>
            {progressPercent === 100 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">
                <i className="ri-trophy-line text-[10px]"></i> All guides read!
              </span>
            )}
            {progressPercent > 0 && progressPercent < 100 && (
              <span className="text-[10px] text-foreground-300">{allGuides.length - readCount} remaining</span>
            )}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════
            SECTION 5 — DASHBOARD FLOW MAP (how to explore)
            ══════════════════════════════════════════════════════════ */}
        <section className="bg-background-50 rounded-2xl border border-background-200/50 overflow-hidden">
          <div className="p-5 border-b border-background-200/40">
            <div className="flex items-center gap-3 mb-1">
              <span className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                <i className="ri-node-tree text-primary-600 text-sm"></i>
              </span>
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">How Your Dashboard Is Organised</h3>
                <p className="text-xs text-foreground-400">8 zones arranged in the order you'll use them. Click a zone to see its pages.</p>
              </div>
            </div>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {FLOW_ZONES.map((zone, zi) => {
                const isActive = activeZone === zone.zone;
                const zoneGuides = zone.guides.map(id => guideMap[id]).filter(Boolean);
                const zoneReadCount = zone.guides.filter(id => readGuides.has(id)).length;
                const colorMap: Record<string, { bg: string; text: string; border: string; dot: string }> = {
                  primary: { bg: 'bg-primary-50', text: 'text-primary-700', border: 'border-primary-200/60', dot: 'bg-primary-500' },
                  accent: { bg: 'bg-accent-50', text: 'text-accent-700', border: 'border-accent-200/60', dot: 'bg-accent-500' },
                  secondary: { bg: 'bg-secondary-50', text: 'text-secondary-700', border: 'border-secondary-200/60', dot: 'bg-secondary-500' },
                };
                const c = colorMap[zone.color] || colorMap.primary;
                const zoneComplete = zoneReadCount === zoneGuides.length && zoneGuides.length > 0;
                return (
                  <div key={zone.zone} className="relative">
                    {zi > 0 && (
                      <div className="hidden lg:flex absolute -left-3 top-6 items-center text-foreground-200 z-10">
                        <i className="ri-arrow-right-s-line text-lg"></i>
                      </div>
                    )}
                    <button
                      onClick={() => setActiveZone(isActive ? null : zone.zone)}
                      className={`w-full rounded-xl border p-4 text-left transition-all duration-200 cursor-pointer ${
                        isActive ? `${c.bg} ${c.border} shadow-sm` : 'border-background-200/50 hover:border-background-300/60 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 mb-2">
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${isActive ? c.dot + ' text-white' : (zoneComplete ? 'bg-emerald-100 text-emerald-600' : 'bg-background-100 text-foreground-500')}`}>
                          <i className={`${zone.icon} text-xs`}></i>
                        </span>
                        <span className="text-xs font-semibold text-foreground-900 whitespace-nowrap">{zone.label}</span>
                        <span className="text-[9px] font-bold text-foreground-300 ml-auto">{zone.order}</span>
                      </div>
                      {/* Mini progress dots */}
                      <div className="flex items-center gap-1">
                        {zone.guides.map(gid => (
                          <span
                            key={gid}
                            className={`w-1.5 h-1.5 rounded-full ${readGuides.has(gid) ? 'bg-emerald-400' : 'bg-background-300'}`}
                          />
                        ))}
                        {zoneReadCount > 0 && (
                          <span className="text-[9px] text-foreground-400 ml-1">{zoneReadCount}/{zone.guides.length}</span>
                        )}
                      </div>
                      {isActive && (
                        <div className="space-y-1 mt-3 pt-3 border-t border-background-200/40 animate-in fade-in duration-150">
                          {zoneGuides.map(g => (
                            <button
                              key={g.id}
                              onClick={(e) => { e.stopPropagation(); toggleGuide(g.id); }}
                              className="w-full flex items-center gap-1.5 text-[11px] text-foreground-600 hover:text-foreground-900 py-1 transition-smooth cursor-pointer"
                            >
                              {readGuides.has(g.id) && (
                                <i className="ri-check-line text-[9px] text-emerald-500 shrink-0"></i>
                              )}
                              <i className={`${g.icon} text-[10px] ${readGuides.has(g.id) ? 'text-emerald-400' : 'text-foreground-300'}`}></i>
                              <span className="truncate">{g.title}</span>
                              <i className="ri-arrow-right-s-line text-foreground-200 ml-auto shrink-0"></i>
                            </button>
                          ))}
                        </div>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════
            SECTION 6 — QUICK STATS + FILTER
            ══════════════════════════════════════════════════════════ */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
            {[
              { label: 'Total Pages', value: allGuides.length, icon: 'ri-pages-line', bg: 'bg-primary-50', text: 'text-primary-700' },
              { label: 'Learning Zones', value: FLOW_ZONES.length, icon: 'ri-stack-line', bg: 'bg-accent-50', text: 'text-accent-700' },
              { label: 'Pages Read', value: readCount, icon: 'ri-book-open-line', bg: 'bg-emerald-50', text: 'text-emerald-700' },
              { label: 'Total Steps', value: allGuides.reduce((acc, g) => acc + g.steps.length, 0), icon: 'ri-list-check', bg: 'bg-secondary-50', text: 'text-secondary-700' },
            ].map(stat => (
              <div key={stat.label} className="bg-background-50 rounded-xl border border-background-200/50 p-3.5 flex items-center gap-3">
                <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${stat.bg}`}>
                  <i className={`${stat.icon} ${stat.text} text-sm`}></i>
                </span>
                <div>
                  <p className="text-lg font-bold text-foreground-900 leading-none">{stat.value}</p>
                  <p className="text-[10px] text-foreground-400 uppercase tracking-wide">{stat.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground-500 uppercase tracking-wide">Explore All Guides</span>
          <span className="text-[10px] text-foreground-300">{allGuides.length} guides — click any to expand</span>
        </div>

        {/* ══════════════════════════════════════════════════════════
            SECTION 7 — ALL GUIDE CARDS
            ══════════════════════════════════════════════════════════ */}
        <div className="space-y-3">
          {allGuides.map((guide, index) => (
            <GuideCard
              key={guide.id}
              guide={guide}
              index={index}
              isExpanded={expandedGuide === guide.id}
              isRead={readGuides.has(guide.id)}
              isRecommended={RECOMMENDED_FIRST.includes(guide.id)}
              activeStep={activeStep}
              onToggle={() => toggleGuide(guide.id)}
              onStepClick={setActiveStep}
              onNavigate={() => navigate(guide.pagePath)}
              onToggleRead={() => toggleRead(guide.id)}
            />
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════
            SECTION 8 — FOOTER
            ══════════════════════════════════════════════════════════ */}
        <div className="flex items-center justify-between pt-3 border-t border-background-200/40 text-[11px] text-foreground-400">
          <div className="flex items-center gap-1.5">
            <i className="ri-information-line text-secondary-400"></i>
            <span>Guides are updated regularly. If something is missing, contact your coach.</span>
          </div>
          <a href="/learner/support" className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap cursor-pointer">
            <i className="ri-question-line"></i> Need Help?
          </a>
        </div>
      </div>
    </WorkspaceShell>
  );
}

/* ═══════════════════════════════════════════════════════════════
   GUIDE CARD COMPONENT
   ═══════════════════════════════════════════════════════════════ */
function GuideCard({
  guide, index, isExpanded, isRead, isRecommended, activeStep,
  onToggle, onStepClick, onNavigate, onToggleRead,
}: {
  guide: GuideSection;
  index: number;
  isExpanded: boolean;
  isRead: boolean;
  isRecommended: boolean;
  activeStep: number | null;
  onToggle: () => void;
  onStepClick: (step: number | null) => void;
  onNavigate: () => void;
  onToggleRead: () => void;
}) {
  const stepIcons = ['ri-number-1', 'ri-number-2', 'ri-number-3', 'ri-number-4', 'ri-number-5', 'ri-number-6', 'ri-number-7', 'ri-number-8', 'ri-number-9'];
  const totalStepsCompleted = guide.steps.length; // in real data, this would be dynamic; for now all steps are available

  return (
    <div className={`bg-background-50 rounded-2xl border overflow-hidden transition-smooth ${
      isExpanded ? 'border-primary-200/60 shadow-sm' : isRead ? 'border-emerald-200/40 bg-emerald-50/20' : 'border-background-200/50'
    }`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 p-4 sm:p-5 text-left hover:bg-background-100/40 transition-smooth cursor-pointer"
      >
        {/* Number + Icon */}
        <div className="flex items-center gap-2 shrink-0">
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold ${
            isRead ? 'bg-emerald-100 text-emerald-600' : 'bg-foreground-100 text-foreground-400'
          }`}>
            {index + 1}
          </span>
          <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
            isRead ? 'bg-emerald-100' : 'bg-primary-100'
          }`}>
            <i className={`${guide.icon} ${isRead ? 'text-emerald-600' : 'text-primary-600'} text-lg`}></i>
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-heading font-semibold text-foreground-900">{guide.title}</h4>
            {isRecommended && (
              <span className="inline-flex items-center gap-1 text-[9px] font-bold text-accent-600 bg-accent-50 px-1.5 py-0.5 rounded-full">
                <i className="ri-star-fill text-[8px]"></i> Recommended
              </span>
            )}
            {isRead && (
              <span className="inline-flex items-center gap-1 text-[9px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                <i className="ri-check-double-line text-[8px]"></i> Read
              </span>
            )}
          </div>
          <p className="text-xs text-foreground-400 mt-0.5 line-clamp-1">{guide.description}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] font-medium text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
              {guide.steps.length} steps
            </span>
            {guide.steps.some(s => s.tip) && (
              <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                <i className="ri-lightbulb-line mr-0.5"></i>Pro Tips
              </span>
            )}
            {guide.steps.some(s => s.action) && (
              <span className="text-[10px] font-medium text-accent-600 bg-accent-50 px-1.5 py-0.5 rounded">
                <i className="ri-flashlight-line mr-0.5"></i>Actions
              </span>
            )}
          </div>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onNavigate(); }}
            className="hidden sm:inline-flex items-center gap-1 px-3.5 py-2 rounded-lg bg-primary-500 text-background-50 text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
          >
            <i className="ri-arrow-right-line"></i> Open
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleRead(); }}
            className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-smooth cursor-pointer ${
              isRead ? 'border-emerald-300 bg-emerald-50 text-emerald-600' : 'border-background-200/60 text-foreground-400 hover:text-emerald-500 hover:border-emerald-200'
            }`}
            title={isRead ? 'Mark as unread' : 'Mark as read'}
          >
            <i className={`${isRead ? 'ri-check-double-line' : 'ri-check-line'} text-sm`}></i>
          </button>
          <i className={`${isExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-foreground-300 text-lg`}></i>
        </div>
      </button>

      {/* Mobile "Open" button */}
      <div className="sm:hidden px-4 pb-2 flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(); }}
          className="inline-flex items-center gap-1 px-3.5 py-2 rounded-lg bg-primary-500 text-background-50 text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
        >
          <i className="ri-arrow-right-line"></i> Open Page
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleRead(); }}
          className={`inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border text-xs font-medium transition-smooth cursor-pointer ${
            isRead ? 'border-emerald-300 bg-emerald-50 text-emerald-600' : 'border-background-200/60 text-foreground-500 hover:text-emerald-500'
          }`}
        >
          <i className={`${isRead ? 'ri-check-double-line' : 'ri-check-line'} text-sm`}></i>
          {isRead ? 'Read' : 'Done?'}
        </button>
      </div>

      {/* Expanded steps */}
      {isExpanded && (
        <div className="border-t border-background-200/50 bg-background-50">
          {/* Screenshot preview */}
          <div className="px-5 pt-4 pb-2">
            <div className="relative w-full h-40 sm:h-48 rounded-xl overflow-hidden bg-background-100 flex items-center justify-center border border-background-200/40 group">
              <img
                src={GUIDE_IMAGES[guide.id] || GUIDE_IMAGES.default}
                alt={guide.title}
                className="w-full h-full object-cover object-top"
                loading="lazy"
              />
              {/* Image overlay with guide name */}
              <div className="absolute inset-0 bg-gradient-to-t from-foreground-950/40 to-transparent opacity-0 group-hover:opacity-100 transition-smooth flex items-end p-3">
                <span className="text-white text-xs font-semibold">{guide.title} Preview</span>
              </div>
            </div>
          </div>

          {/* Steps count summary */}
          <div className="px-5 pb-3 flex items-center gap-2">
            <span className="text-[10px] font-semibold text-foreground-500 uppercase tracking-wide">
              {guide.steps.length} Step Guide
            </span>
            <span className="text-[10px] text-foreground-300">— click any step to see actions &amp; tips</span>
          </div>

          {/* Steps list */}
          <div className="px-5 pb-5">
            <div className="space-y-2">
              {guide.steps.map((step, stepIdx) => (
                <div
                  key={step.step}
                  className={`rounded-xl border transition-all duration-200 ${
                    activeStep === stepIdx ? 'border-primary-300 bg-primary-50/40' : 'border-background-200/40 bg-white hover:border-background-300/60'
                  }`}
                >
                  <button
                    onClick={() => onStepClick(activeStep === stepIdx ? null : stepIdx)}
                    className="w-full flex items-start gap-3 p-3 text-left cursor-pointer hover:bg-background-50 transition-smooth rounded-xl"
                  >
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold transition-smooth ${
                      activeStep === stepIdx ? 'bg-primary-500 text-white' : 'bg-primary-100 text-primary-600'
                    }`}>
                      {stepIdx < 9 ? stepIcons[stepIdx] : step.step}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h5 className="text-sm font-semibold text-foreground-900">{step.title}</h5>
                        <span className="w-5 h-5 rounded flex items-center justify-center bg-background-50 shrink-0">
                          <i className={`${step.icon} text-foreground-300 text-[10px]`}></i>
                        </span>
                        {step.action && (
                          <span className="text-[9px] font-bold text-accent-600 bg-accent-50 px-1 py-0 rounded-full">Action</span>
                        )}
                        {step.tip && (
                          <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1 py-0 rounded-full">Tip</span>
                        )}
                      </div>
                      <p className="text-xs text-foreground-500 mt-0.5 leading-relaxed">{step.description}</p>
                    </div>
                    <i className={`${activeStep === stepIdx ? 'ri-subtract-line' : 'ri-add-line'} text-foreground-300 mt-0.5 shrink-0 text-sm`}></i>
                  </button>
                  {activeStep === stepIdx && (
                    <div className="px-3 pb-3 ml-10 animate-in fade-in duration-150">
                      {step.action && (
                        <div className="bg-accent-50 rounded-lg border border-accent-200/50 p-2.5 mb-2">
                          <div className="flex items-center gap-1.5 mb-1">
                            <i className="ri-flashlight-line text-accent-500 text-xs"></i>
                            <p className="text-[10px] font-bold text-accent-700 uppercase tracking-wide">Action Required</p>
                          </div>
                          <p className="text-xs text-accent-700">{step.action}</p>
                        </div>
                      )}
                      {step.tip && (
                        <div className="bg-amber-50 rounded-lg border border-amber-200/50 p-2.5">
                          <div className="flex items-center gap-1.5 mb-1">
                            <i className="ri-lightbulb-line text-amber-500 text-xs"></i>
                            <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">Pro Tip</p>
                          </div>
                          <p className="text-xs text-amber-700">{step.tip}</p>
                        </div>
                      )}
                      {!step.action && !step.tip && (
                        <div className="bg-background-100 rounded-lg p-2.5">
                          <p className="text-[10px] text-foreground-400">Read the description above. No additional actions or tips for this step.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Bottom action: Open Page + Mark as Read */}
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-background-200/40">
              <button
                onClick={onNavigate}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-500 text-background-50 text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
              >
                <i className="ri-arrow-right-line"></i> Open This Page
              </button>
              <button
                onClick={onToggleRead}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-smooth cursor-pointer ${
                  isRead ? 'border-emerald-300 bg-emerald-50 text-emerald-600' : 'border-background-200/60 text-foreground-500 hover:text-emerald-500'
                }`}
              >
                <i className={`${isRead ? 'ri-check-double-line' : 'ri-check-line'} text-sm`}></i>
                {isRead ? 'Marked as Read' : 'Mark as Read'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const GUIDE_IMAGES: Record<string, string> = {
  'learner-overview': 'https://readdy.ai/api/search-image?query=Modern%20minimalist%20learning%20management%20dashboard%20interface%20with%20cards%20showing%20progress%20bars%20and%20weekly%20stats%20on%20a%20clean%20white%20background%20with%20subtle%20warm%20accents%20professional%20apprenticeship%20platform%20design%20with%20sidebar%20navigation%20and%20top%20header%20bar&width=1200&height=600&seq=ug-overview-01&orientation=landscape',
  'learner-this-week': 'https://readdy.ai/api/search-image?query=Clean%20web%20application%20dashboard%20showing%20weekly%20learning%20plan%20with%20component%20checklist%20cards%20and%20progress%20indicators%20on%20a%20light%20neutral%20background%20with%20soft%20green%20and%20amber%20accent%20colors%20modern%20minimalist%20educational%20interface%20design&width=1200&height=600&seq=ug-thisweek-01&orientation=landscape',
  'learner-training-plan': 'https://readdy.ai/api/search-image?query=Web%20application%20interface%20showing%20a%20training%20plan%20timeline%20with%2060%20week%20grid%20layout%20and%20monthly%20groupings%20on%20a%20clean%20white%20background%20with%20subtle%20green%20highlighting%20for%20current%20week%20modern%20education%20platform%20design%20with%20filter%20tabs&width=1200&height=600&seq=ug-trainplan-01&orientation=landscape',
  'learner-modules': 'https://readdy.ai/api/search-image?query=Modern%20dashboard%20showing%20learning%20module%20cards%20in%20a%20grid%20layout%20with%20roadmap%20timeline%20and%20progress%20bars%20each%20card%20with%20icon%20title%20and%20status%20badge%20on%20a%20light%20neutral%20background%20professional%20LMS%20interface%20design&width=1200&height=600&seq=ug-modules-01&orientation=landscape',
  'learner-quizzes': 'https://readdy.ai/api/search-image?query=Assessment%20dashboard%20web%20interface%20showing%20quiz%20cards%20with%20scores%20and%20progress%20indicators%20on%20a%20clean%20white%20background%20with%20tabs%20for%20library%20history%20and%20KSB%20impact%20modern%20educational%20platform%20design%20with%20warm%20amber%20accents&width=1200&height=600&seq=ug-quizzes-01&orientation=landscape',
  'learner-ksbs': 'https://readdy.ai/api/search-image?query=Knowledge%20skills%20behaviors%20tracker%20dashboard%20interface%20with%20progress%20cards%20showing%20percentages%20and%20color%20coded%20status%20indicators%20on%20a%20clean%20light%20background%20with%20sidebar%20showing%20circular%20progress%20chart%20modern%20professional%20design&width=1200&height=600&seq=ug-ksbs-01&orientation=landscape',
  'learner-evidence': 'https://readdy.ai/api/search-image?query=File%20library%20dashboard%20interface%20showing%20uploaded%20documents%20in%20a%20list%20view%20with%20status%20badges%20and%20file%20type%20icons%20on%20a%20clean%20white%20background%20with%20upload%20button%20modern%20minimalist%20design%20with%20search%20bar&width=1200&height=600&seq=ug-evidence-01&orientation=landscape',
  'learner-otjh': 'https://readdy.ai/api/search-image?query=Time%20tracking%20dashboard%20interface%20showing%20monthly%20hour%20targets%20with%20progress%20bars%20and%20activity%20breakdown%20charts%20on%20a%20clean%20light%20background%20with%20add%20entry%20button%20and%20history%20table%20modern%20professional%20design&width=1200&height=600&seq=ug-otjh-01&orientation=landscape',
  'learner-attendance': 'https://readdy.ai/api/search-image?query=Attendance%20tracking%20dashboard%20with%20session%20history%20timeline%20and%20attendance%20rate%20donut%20chart%20on%20a%20clean%20white%20background%20with%20green%20and%20red%20status%20indicators%20modern%20educational%20platform%20interface%20design&width=1200&height=600&seq=ug-attendance-01&orientation=landscape',
  'learner-catchup': 'https://readdy.ai/api/search-image?query=Catch%20up%20learning%20hub%20dashboard%20interface%20showing%20outstanding%20and%20completed%20items%20in%20expandable%20rows%20with%20progress%20rings%20and%20status%20labels%20on%20a%20clean%20light%20background%20modern%20minimalist%20design&width=1200&height=600&seq=ug-catchup-01&orientation=landscape',
  'learner-monthly-cycle': 'https://readdy.ai/api/search-image?query=Monthly%20learning%20cycle%20dashboard%20with%20assignment%20progress%20and%20month%20summary%20cards%20on%20a%20clean%20white%20background%20with%20timeline%20indicators%20and%20coaching%20readiness%20panel%20modern%20educational%20platform%20design&width=1200&height=600&seq=ug-monthly-01&orientation=landscape',
  'learner-monthly-coaching': 'https://readdy.ai/api/search-image?query=Coaching%20meeting%20dashboard%20interface%20with%20agenda%20sections%20and%20action%20tracker%20on%20a%20clean%20light%20background%20with%20presentation%20preview%20and%20readiness%20score%20modern%20professional%20design%20with%20warm%20accents&width=1200&height=600&seq=ug-coaching-01&orientation=landscape',
  'learner-progress-reviews': 'https://readdy.ai/api/search-image?query=Progress%20review%20dashboard%20with%20review%20areas%20and%20timeline%20on%20a%20clean%20white%20background%20with%20sidebar%20showing%20next%20review%20date%20and%20preparation%20actions%20modern%20educational%20platform%20interface&width=1200&height=600&seq=ug-reviews-01&orientation=landscape',
  'learner-gateway': 'https://readdy.ai/api/search-image?query=Gateway%20readiness%20dashboard%20showing%20EPA%20timeline%20and%20component%20readiness%20cards%20on%20a%20clean%20light%20background%20with%20circular%20progress%20charts%20and%20risk%20analysis%20modern%20professional%20design&width=1200&height=600&seq=ug-gateway-01&orientation=landscape',
  'learner-rewards': 'https://readdy.ai/api/search-image?query=Rewards%20and%20badges%20dashboard%20interface%20showing%20earned%20badges%20in%20a%20grid%20layout%20with%20gold%20and%20silver%20styling%20on%20a%20clean%20white%20background%20modern%20gamification%20platform%20design&width=1200&height=600&seq=ug-rewards-01&orientation=landscape',
  'learner-clubs': 'https://readdy.ai/api/search-image?query=Community%20clubs%20dashboard%20showing%20club%20cards%20with%20member%20counts%20and%20activity%20feeds%20on%20a%20clean%20light%20background%20modern%20social%20learning%20platform%20interface%20design%20with%20event%20listings&width=1200&height=600&seq=ug-clubs-01&orientation=landscape',
  'learner-calendar': 'https://readdy.ai/api/search-image?query=Calendar%20dashboard%20interface%20showing%20monthly%20grid%20with%20colored%20event%20markers%20on%20a%20clean%20white%20background%20with%20upcoming%20events%20sidebar%20modern%20minimalist%20design&width=1200&height=600&seq=ug-calendar-01&orientation=landscape',
  'learner-profile': 'https://readdy.ai/api/search-image?query=User%20profile%20page%20interface%20showing%20personal%20details%20and%20programme%20information%20with%20edit%20buttons%20on%20a%20clean%20light%20background%20modern%20professional%20design%20with%20avatar&width=1200&height=600&seq=ug-profile-01&orientation=landscape',
  'learner-support': 'https://readdy.ai/api/search-image?query=Support%20ticket%20dashboard%20interface%20showing%20ticket%20list%20with%20status%20badges%20and%20FAQ%20section%20on%20a%20clean%20white%20background%20modern%20helpdesk%20platform%20design&width=1200&height=600&seq=ug-support-01&orientation=landscape',
  'learner-messages': 'https://readdy.ai/api/search-image?query=Messaging%20interface%20showing%20chat%20list%20sidebar%20and%20conversation%20view%20on%20a%20clean%20light%20background%20modern%20communication%20platform%20design%20with%20contact%20cards&width=1200&height=600&seq=ug-messages-01&orientation=landscape',
  'default': 'https://readdy.ai/api/search-image?query=Modern%20minimalist%20dashboard%20interface%20with%20clean%20white%20background%20showing%20cards%20and%20navigation%20sidebar%20professional%20learning%20platform%20design%20with%20subtle%20warm%20accent%20colors%20and%20soft%20shadows&width=1200&height=600&seq=ug-default-01&orientation=landscape',
};