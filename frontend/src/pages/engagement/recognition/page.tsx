import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { ProgrammeFilter } from '@/components/feature/ProgrammeFilter';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import { ENGAGEMENT_LEARNERS, countByProgramme, filterByProgramme, type Recognition, type ProgrammeFilterValue } from '@/mocks/engagement-data';
import { fetchRecognitions, createRecognition, updateRecognition } from '@/api/engagement';
import { RecognitionCardSkeletonGrid } from '@/pages/engagement/EngagementSkeletons';
import { LearnerPickerModal } from '@/pages/engagement/LearnerPickerModal';

const engagementNav = roleNavMap.engagement;
const AWARDER = 'Tom Harrington';

type RecognitionType = Recognition['type'];
type SortKey = 'recent' | 'points' | 'name';

// The award TYPE is the real taxonomy of this page, so it drives each card's
// identity — a colored medallion, an eyebrow label, and a left accent strip.
// Full literal class strings (not interpolated) so Tailwind's JIT keeps them.
const typeConfig: Record<RecognitionType, { icon: string; label: string; wrap: string; bar: string }> = {
  badge: { icon: 'ri-award-line', label: 'Badge', wrap: 'bg-primary-100 text-primary-700', bar: 'bg-primary-400' },
  certificate: { icon: 'ri-file-shield-line', label: 'Certificate', wrap: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-400' },
  spotlight: { icon: 'ri-star-line', label: 'Spotlight', wrap: 'bg-accent-100 text-accent-700', bar: 'bg-accent-400' },
  milestone: { icon: 'ri-flag-line', label: 'Milestone', wrap: 'bg-secondary-100 text-secondary-700', bar: 'bg-secondary-400' },
  achievement: { icon: 'ri-trophy-line', label: 'Achievement', wrap: 'bg-amber-100 text-amber-700', bar: 'bg-amber-400' },
};

const AWARD_TYPES: RecognitionType[] = ['badge', 'certificate', 'spotlight', 'milestone', 'achievement'];

interface AwardFormData {
  learnerId: string;
  type: RecognitionType;
  title: string;
  description: string;
  category: string;
  points: number;
  public: boolean;
}

interface EditFormData {
  title: string;
  description: string;
  category: string;
  points: number;
  public: boolean;
}

interface FormErrors {
  learnerId?: string;
  title?: string;
  description?: string;
  category?: string;
  points?: string;
}

const blankAward: AwardFormData = { learnerId: '', type: 'badge', title: '', description: '', category: '', points: 50, public: true };

function validateAward(form: AwardFormData): FormErrors {
  const errs: FormErrors = {};
  if (!form.learnerId) errs.learnerId = 'Choose the learner being recognised';
  if (!form.title.trim()) errs.title = 'Give the recognition a title';
  else if (form.title.trim().length < 3) errs.title = 'Title must be at least 3 characters';
  if (!form.description.trim()) errs.description = 'Describe what earned it';
  if (!form.category.trim()) errs.category = 'Category is required';
  if (form.points < 0) errs.points = 'Points cannot be negative';
  return errs;
}

function validateEdit(form: EditFormData): FormErrors {
  const errs: FormErrors = {};
  if (!form.title.trim()) errs.title = 'Title is required';
  if (!form.description.trim()) errs.description = 'Description is required';
  if (!form.category.trim()) errs.category = 'Category is required';
  if (form.points < 0) errs.points = 'Points cannot be negative';
  return errs;
}

export default function RecognitionPage() {
  const navigate = useNavigate();
  const { success, warning } = useToast();
  const [recognitions, setRecognitions] = useState<Recognition[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | RecognitionType>('all');
  const [publicOnly, setPublicOnly] = useState(false);
  const [programmeFilter, setProgrammeFilter] = useState<ProgrammeFilterValue>('all');
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [showAward, setShowAward] = useState(false);
  const [awardForm, setAwardForm] = useState<AwardFormData>({ ...blankAward });
  const [awardErrors, setAwardErrors] = useState<FormErrors>({});
  const [showLearnerPicker, setShowLearnerPicker] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormData>({ title: '', description: '', category: '', points: 0, public: true });
  const [editErrors, setEditErrors] = useState<FormErrors>({});

  useEffect(() => {
    let cancelled = false;
    fetchRecognitions()
      .then(data => { if (!cancelled) setRecognitions(data); })
      .catch(err => { if (!cancelled) warning('Could not load recognitions', err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [warning]);

  const programmeCounts = countByProgramme(recognitions);
  const totalPoints = recognitions.reduce((s, r) => s + r.points, 0);
  const publicCount = recognitions.filter(r => r.public).length;

  const filtered = useMemo(() => {
    let list = filterByProgramme(recognitions, programmeFilter).filter(r => {
      const matchType = typeFilter === 'all' || r.type === typeFilter;
      const matchPublic = !publicOnly || r.public;
      const q = search.trim().toLowerCase();
      const matchSearch = !q || r.title.toLowerCase().includes(q) || r.learner.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
      return matchType && matchPublic && matchSearch;
    });
    if (sortKey !== 'recent') {
      list = [...list].sort((a, b) => {
        if (sortKey === 'name') {
          return sortDir === 'asc' ? a.learner.localeCompare(b.learner) : b.learner.localeCompare(a.learner);
        }
        return sortDir === 'asc' ? a.points - b.points : b.points - a.points;
      });
    }
    return list;
  }, [recognitions, programmeFilter, typeFilter, publicOnly, search, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === 'recent') { setSortKey('recent'); return; }
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  }

  function openAward() {
    setAwardForm({ ...blankAward });
    setAwardErrors({});
    setShowAward(true);
  }

  async function handleAward() {
    const errs = validateAward(awardForm);
    if (Object.keys(errs).length > 0) { setAwardErrors(errs); return; }
    const learner = ENGAGEMENT_LEARNERS.find(l => l.id === awardForm.learnerId);
    if (!learner) { setAwardErrors({ learnerId: 'Choose the learner being recognised' }); return; }
    try {
      const created = await createRecognition({
        learnerId: learner.id, learnerName: learner.name, avatarImg: learner.avatarImg,
        programmeCode: learner.programmeCode, programme: learner.programme, cohort: learner.cohort,
        type: awardForm.type, title: awardForm.title.trim(), description: awardForm.description.trim(),
        awardedBy: AWARDER, category: awardForm.category.trim(), points: awardForm.points, public: awardForm.public,
      });
      setRecognitions(prev => [created, ...prev]);
      setShowAward(false);
      success(`Recognition awarded to ${learner.name}`, `${awardForm.title.trim()} · ${awardForm.points} pts`);
    } catch (err: any) {
      warning('Could not award recognition', err.message);
    }
  }

  function openEdit(rec: Recognition) {
    setEditForm({ title: rec.title, description: rec.description, category: rec.category, points: rec.points, public: rec.public });
    setEditErrors({});
    setEditId(rec.id);
  }

  async function handleEdit() {
    if (!editId) return;
    const errs = validateEdit(editForm);
    if (Object.keys(errs).length > 0) { setEditErrors(errs); return; }
    try {
      const updated = await updateRecognition(editId, {
        title: editForm.title.trim(), description: editForm.description.trim(),
        category: editForm.category.trim(), points: editForm.points, public: editForm.public,
      });
      setRecognitions(prev => prev.map(r => r.id === editId ? updated : r));
      setEditId(null);
      success(`"${editForm.title.trim()}" updated`);
    } catch (err: any) {
      warning('Could not update recognition', err.message);
    }
  }

  async function togglePublic(rec: Recognition) {
    const next = !rec.public;
    try {
      const updated = await updateRecognition(rec.id, { public: next });
      setRecognitions(prev => prev.map(r => r.id === rec.id ? updated : r));
      (next ? success : warning)(`"${rec.title}" ${next ? 'is now public' : 'is now private'}`);
    } catch (err: any) {
      warning('Could not update recognition', err.message);
    }
  }

  async function shareRecognition(rec: Recognition) {
    const summary = `🏅 ${rec.title} — ${rec.learner} (${rec.cohort})\n${rec.description}\nAwarded by ${rec.awardedBy} · ${rec.awardedAt} · ${rec.points} pts`;
    try {
      await navigator.clipboard.writeText(summary);
      success('Recognition copied', 'Paste it anywhere to share this achievement.');
    } catch {
      warning('Could not copy', 'Your browser blocked clipboard access.');
    }
  }

  const editRec = recognitions.find(r => r.id === editId) ?? null;
  const selectedLearner = ENGAGEMENT_LEARNERS.find(l => l.id === awardForm.learnerId) ?? null;

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Recognition" pageSubtitle="Celebrate learner achievements with badges, certificates, and public recognition"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Recognition & Awards"
          description={`${recognitions.length} recognitions awarded. ${totalPoints.toLocaleString()} recognition points celebrated. ${publicCount} public spotlights lifting the community.`}
          icon="ri-thumb-up-line"
          imageUrl="https://readdy.ai/api/search-image?query=celebration%20awards%20recognition%20achievement%20ceremony%20warm%20professional%20modern&width=400&height=160&seq=recognition-01&orientation=landscape"
          imageAlt="Recognition"
          stats={[{ label: 'Awards', value: String(recognitions.length) }, { label: 'Points', value: String(totalPoints) }, { label: 'Public', value: String(publicCount) }]}
        />

        {/* Quick access */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/clubs')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-team-line text-sm"></i> Learner Clubs
          </button>
          <button onClick={() => navigate('/engagement/points-rules')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-accent-50 hover:text-accent-600 hover:border-accent-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-gift-2-line text-sm"></i> Points Rules
          </button>
          <button onClick={() => navigate('/engagement/rewards-shop')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-shopping-bag-3-line text-sm"></i> Rewards Shop
          </button>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-heart-line text-sm"></i> Learner Engagement
          </button>
        </div>

        {/* Programme Filter */}
        <ProgrammeFilter value={programmeFilter} onChange={setProgrammeFilter} counts={programmeCounts} />

        {/* Search + Award */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input type="text" placeholder="Search by learner, title, or reason..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <label className="flex items-center gap-2 text-[12px] text-foreground-600 cursor-pointer">
            <input type="checkbox" checked={publicOnly} onChange={e => setPublicOnly(e.target.checked)} className="w-4 h-4 rounded border-background-300 accent-primary-500 cursor-pointer" />
            Public only
          </label>
          <div className="flex-1"></div>
          <button onClick={openAward} className="px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap shrink-0">
            <i className="ri-add-line mr-1"></i> Award Recognition
          </button>
        </div>

        {/* Type filter + sort */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex items-center gap-1 bg-background-100 rounded-lg p-1 overflow-x-auto">
            {(['all', ...AWARD_TYPES] as const).map(t => (
              <button key={t} onClick={() => setTypeFilter(t)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${typeFilter === t ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
                <i className={`${t === 'all' ? 'ri-list-check' : typeConfig[t].icon} text-sm`}></i>
                {t === 'all' ? 'All' : typeConfig[t].label}
              </button>
            ))}
          </div>
          <div className="flex-1"></div>
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <span className="font-semibold text-foreground-500">Sort by:</span>
            {([
              { key: 'recent' as SortKey, label: 'Most Recent' },
              { key: 'points' as SortKey, label: 'Points' },
              { key: 'name' as SortKey, label: 'Learner Name' },
            ]).map(opt => (
              <button key={opt.key} onClick={() => handleSort(opt.key)} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-smooth cursor-pointer whitespace-nowrap ${sortKey === opt.key ? 'bg-primary-50 text-primary-700 border border-primary-200/50' : 'text-foreground-500 hover:text-foreground-700 border border-transparent'}`}>
                {opt.label}
                {sortKey === opt.key && opt.key !== 'recent' && <i className={sortDir === 'asc' ? 'ri-arrow-up-line' : 'ri-arrow-down-line'}></i>}
              </button>
            ))}
          </div>
        </div>

        {loading && <RecognitionCardSkeletonGrid />}

        {!loading && filtered.length === 0 && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-10 flex flex-col items-center justify-center text-center gap-2">
            <i className="ri-award-line text-2xl text-foreground-300"></i>
            <p className="text-sm font-semibold text-foreground-700">No recognitions match this view</p>
            <p className="text-[11px] text-foreground-400">Try switching the type, programme, or public-only filter — or award a new one.</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {filtered.map(rec => {
            const cfg = typeConfig[rec.type] ?? typeConfig.badge;
            return (
              <div key={rec.id} className="relative bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden card-premium hover:border-primary-200/50 transition-smooth">
                {/* Type accent strip — the award type is the card's identity. */}
                <span className={`absolute inset-y-0 left-0 w-1 ${cfg.bar}`} aria-hidden="true"></span>
                <div className="p-4 pl-5">
                  {/* Type eyebrow + public state */}
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${cfg.wrap}`}>
                        <i className={`${cfg.icon} text-base`}></i>
                      </span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-foreground-400">{cfg.label}</span>
                    </div>
                    <button onClick={() => togglePublic(rec)} title={rec.public ? 'Public — visible to the community. Click to make private.' : 'Private. Click to make public.'} className={`flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded-full cursor-pointer transition-smooth shrink-0 ${rec.public ? 'bg-accent-100 text-accent-700 hover:bg-accent-200' : 'bg-foreground-100 text-foreground-500 hover:bg-foreground-200'}`}>
                      <i className={rec.public ? 'ri-global-line' : 'ri-lock-line'}></i>
                      {rec.public ? 'Public' : 'Private'}
                    </button>
                  </div>

                  {/* Title + reason */}
                  <h4 className="text-[14px] font-semibold text-foreground-900 leading-snug mb-1">{rec.title}</h4>
                  <p className="text-[11px] text-foreground-500 leading-relaxed mb-3 line-clamp-2">{rec.description}</p>

                  {/* The learner being celebrated */}
                  <div className="flex items-center gap-2.5 mb-3 pb-3 border-b border-foreground-200/50">
                    <div className="w-8 h-8 rounded-full shrink-0 overflow-hidden bg-primary-100">
                      {rec.avatarImg ? (
                        <img src={rec.avatarImg} alt={rec.learner} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[11px] font-bold text-primary-600">{rec.learner.charAt(0)}</div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-foreground-900 truncate">{rec.learner}</p>
                      <p className="text-[10px] text-foreground-400 truncate">{rec.cohort}</p>
                    </div>
                    <span className="ml-auto text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-50 text-secondary-700 shrink-0">{rec.category}</span>
                  </div>

                  {/* Provenance + points */}
                  <div className="flex items-center justify-between mb-3 text-[10px] text-foreground-400">
                    <span className="truncate"><i className="ri-shield-star-line mr-1 text-secondary-500"></i>{rec.awardedBy}</span>
                    <span className="shrink-0 ml-2"><i className="ri-calendar-line mr-1 text-primary-500"></i>{rec.awardedAt}</span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-[12px] font-bold text-accent-600">
                      <i className="ri-copper-coin-line"></i>{rec.points} pts
                    </span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => shareRecognition(rec)} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                        <i className="ri-share-line mr-1"></i> Share
                      </button>
                      <button onClick={() => openEdit(rec)} className="px-3 py-1.5 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[10px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                        <i className="ri-edit-line mr-1"></i> Edit
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* AWARD MODAL */}
      {showAward && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAward(false)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center"><i className="ri-award-line text-lg"></i></span>
                <div>
                  <h3 className="text-base font-heading font-semibold text-foreground-900">Award Recognition</h3>
                  <p className="text-[11px] text-foreground-400">Celebrate a learner's achievement</p>
                </div>
              </div>
              <button onClick={() => setShowAward(false)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><i className="ri-close-line text-lg"></i></button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Learner <span className="text-red-500">*</span></label>
                <button
                  type="button"
                  onClick={() => setShowLearnerPicker(true)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 bg-background-50 border rounded-lg text-left transition-smooth cursor-pointer hover:border-primary-300 ${awardErrors.learnerId ? 'border-red-300' : 'border-foreground-200/60'}`}
                >
                  {selectedLearner ? (
                    <>
                      <div className="w-7 h-7 rounded-full shrink-0 overflow-hidden bg-primary-100">
                        {selectedLearner.avatarImg ? (
                          <img src={selectedLearner.avatarImg} alt={selectedLearner.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-primary-600">{selectedLearner.name.charAt(0)}</div>
                        )}
                      </div>
                      <span className="text-[12px] font-semibold text-foreground-900 truncate">{selectedLearner.name}</span>
                      <span className="text-[10px] text-foreground-400 truncate">· {selectedLearner.cohort}</span>
                    </>
                  ) : (
                    <span className="text-[12px] text-foreground-400 flex items-center gap-2"><i className="ri-user-search-line"></i> Select a learner…</span>
                  )}
                  <i className="ri-arrow-down-s-line ml-auto text-foreground-400 shrink-0"></i>
                </button>
                {awardErrors.learnerId && <p className="text-[10px] text-red-500 mt-1">{awardErrors.learnerId}</p>}
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Type <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-5 gap-1.5">
                  {AWARD_TYPES.map(t => {
                    const cfg = typeConfig[t];
                    const on = awardForm.type === t;
                    return (
                      <button type="button" key={t} onClick={() => setAwardForm(f => ({ ...f, type: t }))} title={cfg.label} className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-center transition-smooth cursor-pointer ${on ? 'border-primary-400 bg-primary-50' : 'border-foreground-200/60 bg-background-50 hover:border-foreground-300'}`}>
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${cfg.wrap}`}><i className={`${cfg.icon} text-sm`}></i></span>
                        <span className={`text-[8px] font-semibold ${on ? 'text-primary-700' : 'text-foreground-500'}`}>{cfg.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Title <span className="text-red-500">*</span></label>
                <input type="text" value={awardForm.title} onChange={e => { setAwardForm(f => ({ ...f, title: e.target.value })); setAwardErrors(er => ({ ...er, title: undefined })); }} placeholder="e.g. Perfect Attendance" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${awardErrors.title ? 'border-red-300' : 'border-foreground-200/60'}`} />
                {awardErrors.title && <p className="text-[10px] text-red-500 mt-1">{awardErrors.title}</p>}
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Reason <span className="text-red-500">*</span></label>
                <textarea value={awardForm.description} onChange={e => { setAwardForm(f => ({ ...f, description: e.target.value })); setAwardErrors(er => ({ ...er, description: undefined })); }} rows={2} maxLength={200} placeholder="What did they do to earn it?" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none ${awardErrors.description ? 'border-red-300' : 'border-foreground-200/60'}`}></textarea>
                {awardErrors.description && <p className="text-[10px] text-red-500 mt-1">{awardErrors.description}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Category <span className="text-red-500">*</span></label>
                  <input type="text" value={awardForm.category} onChange={e => { setAwardForm(f => ({ ...f, category: e.target.value })); setAwardErrors(er => ({ ...er, category: undefined })); }} placeholder="e.g. Attendance" className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${awardErrors.category ? 'border-red-300' : 'border-foreground-200/60'}`} />
                  {awardErrors.category && <p className="text-[10px] text-red-500 mt-1">{awardErrors.category}</p>}
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Points</label>
                  <input type="number" value={awardForm.points} onChange={e => setAwardForm(f => ({ ...f, points: parseInt(e.target.value) || 0 }))} min={0} className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-[12px] text-foreground-600 cursor-pointer">
                <input type="checkbox" checked={awardForm.public} onChange={e => setAwardForm(f => ({ ...f, public: e.target.checked }))} className="w-4 h-4 rounded border-background-300 accent-primary-500 cursor-pointer" />
                Public spotlight — visible to the wider learner community
              </label>
            </div>
            <div className="p-5 border-t border-foreground-200/60 bg-background-100/30 flex items-center justify-between">
              <button onClick={() => setShowAward(false)} className="px-4 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[12px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
              <button onClick={handleAward} className="px-5 py-2 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 bg-primary-500 text-white hover:bg-primary-600">
                <i className="ri-award-line"></i> Award Recognition
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {editRec && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditId(null)}>
          <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm"></div>
          <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-accent-100 text-accent-600 flex items-center justify-center"><i className="ri-edit-line text-lg"></i></span>
                <div>
                  <h3 className="text-base font-heading font-semibold text-foreground-900">Edit Recognition</h3>
                  <p className="text-[11px] text-foreground-400">{editRec.learner} · {typeConfig[editRec.type]?.label ?? editRec.type}</p>
                </div>
              </div>
              <button onClick={() => setEditId(null)} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><i className="ri-close-line text-lg"></i></button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Title <span className="text-red-500">*</span></label>
                <input type="text" value={editForm.title} onChange={e => { setEditForm(f => ({ ...f, title: e.target.value })); setEditErrors(er => ({ ...er, title: undefined })); }} className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${editErrors.title ? 'border-red-300' : 'border-foreground-200/60'}`} />
                {editErrors.title && <p className="text-[10px] text-red-500 mt-1">{editErrors.title}</p>}
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Reason <span className="text-red-500">*</span></label>
                <textarea value={editForm.description} onChange={e => { setEditForm(f => ({ ...f, description: e.target.value })); setEditErrors(er => ({ ...er, description: undefined })); }} rows={2} maxLength={200} className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 resize-none ${editErrors.description ? 'border-red-300' : 'border-foreground-200/60'}`}></textarea>
                {editErrors.description && <p className="text-[10px] text-red-500 mt-1">{editErrors.description}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Category <span className="text-red-500">*</span></label>
                  <input type="text" value={editForm.category} onChange={e => { setEditForm(f => ({ ...f, category: e.target.value })); setEditErrors(er => ({ ...er, category: undefined })); }} className={`w-full px-3 py-2 bg-background-50 border rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300 ${editErrors.category ? 'border-red-300' : 'border-foreground-200/60'}`} />
                  {editErrors.category && <p className="text-[10px] text-red-500 mt-1">{editErrors.category}</p>}
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-foreground-700 mb-1.5">Points</label>
                  <input type="number" value={editForm.points} onChange={e => setEditForm(f => ({ ...f, points: parseInt(e.target.value) || 0 }))} min={0} className="w-full px-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-[12px] text-foreground-600 cursor-pointer">
                <input type="checkbox" checked={editForm.public} onChange={e => setEditForm(f => ({ ...f, public: e.target.checked }))} className="w-4 h-4 rounded border-background-300 accent-primary-500 cursor-pointer" />
                Public spotlight
              </label>
            </div>
            <div className="p-5 border-t border-foreground-200/60 bg-background-100/30 flex items-center justify-between">
              <button onClick={() => setEditId(null)} className="px-4 py-2 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[12px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
              <button onClick={handleEdit} className="px-5 py-2 rounded-lg text-[12px] font-semibold transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-2 bg-accent-500 text-white hover:bg-accent-600">
                <i className="ri-save-line"></i> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      <LearnerPickerModal
        open={showLearnerPicker}
        onClose={() => setShowLearnerPicker(false)}
        selectedId={awardForm.learnerId}
        onSelect={l => { setAwardForm(f => ({ ...f, learnerId: l.id })); setAwardErrors(er => ({ ...er, learnerId: undefined })); }}
      />
    </WorkspaceShell>
  );
}
