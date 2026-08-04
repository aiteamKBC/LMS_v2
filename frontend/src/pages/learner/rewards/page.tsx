import { useEffect, useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import {
  createVoucherClaim,
  fetchPointsGrants,
  fetchRecognitions,
  fetchRewards,
  fetchVoucherClaims,
} from '@/api/engagement';
import { useMyLearner } from '@/hooks/useMyLearner';

const learnerNav = roleNavMap.learner;
type Reward = Awaited<ReturnType<typeof fetchRewards>>[number];
type Claim = Awaited<ReturnType<typeof fetchVoucherClaims>>[number];
type Recognition = Awaited<ReturnType<typeof fetchRecognitions>>[number];
type Grant = Awaited<ReturnType<typeof fetchPointsGrants>>[number];
type Tab = 'shop' | 'claims' | 'recognition' | 'activity';

const tabs: { key: Tab; label: string; icon: string }[] = [
  { key: 'shop', label: 'Rewards shop', icon: 'ri-gift-line' },
  { key: 'claims', label: 'My claims', icon: 'ri-coupon-3-line' },
  { key: 'recognition', label: 'Recognition', icon: 'ri-medal-line' },
  { key: 'activity', label: 'Points activity', icon: 'ri-history-line' },
];

const claimStyle: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  approved: 'bg-blue-50 text-blue-700 ring-blue-200',
  rejected: 'bg-red-50 text-red-700 ring-red-200',
  fulfilled: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

function RewardCard({ reward, available, onClaim }: { reward: Reward; available: number; onClaim: (reward: Reward) => void }) {
  const remaining = Math.max(reward.stock - reward.totalClaimed, 0);
  const unavailable = !reward.active || remaining === 0;
  const affordable = available >= reward.points;
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-foreground-200/70 bg-white shadow-[0_5px_24px_rgba(28,10,55,0.05)] transition-all duration-300 hover:-translate-y-1 hover:border-primary-200 hover:shadow-[0_16px_38px_rgba(68,30,115,0.12)]">
      <div className="absolute inset-x-0 top-0 z-10 h-1 bg-gradient-to-r from-primary-600 via-secondary-500 to-amber-400 opacity-70 transition group-hover:opacity-100"></div>
      {reward.image ? <div className="flex h-44 items-center justify-center border-b border-background-200 bg-gradient-to-br from-white to-background-100 p-5"><img src={reward.image} alt={reward.name} className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.03]" /></div> : <div className="flex h-44 items-center justify-center border-b border-primary-100 bg-gradient-to-br from-primary-50 to-secondary-100 text-primary-500"><i className="ri-gift-2-line text-4xl"></i></div>}
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary-600">{reward.category || 'Reward'}</p><h2 className="mt-1 text-base font-bold text-foreground-900">{reward.name}</h2></div>{reward.popular && <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-700">Popular</span>}</div>
        <p className="mt-2 line-clamp-3 min-h-[72px] flex-1 text-sm leading-6 text-foreground-500">{reward.description || 'No description has been added yet.'}</p>
        <div className="mt-4 flex items-center justify-between rounded-2xl bg-background-100/70 px-4 py-3"><div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-amber-600 shadow-sm"><i className="ri-coins-line"></i></span><div><p className="text-lg font-bold leading-none text-primary-700">{reward.points.toLocaleString()}</p><p className="mt-1 text-[9px] uppercase tracking-wider text-foreground-400">Points</p></div></div><div className="text-right"><p className="text-xs font-semibold text-foreground-700">{remaining} left</p><p className="mt-1 text-[9px] capitalize text-foreground-400">{reward.deliveryType} delivery</p></div></div>
        <button onClick={() => onClaim(reward)} disabled={unavailable || !affordable} className="mt-4 h-10 rounded-xl bg-gradient-to-r from-primary-700 to-secondary-600 text-xs font-bold text-white shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-none disabled:bg-background-200 disabled:text-foreground-400 disabled:shadow-none">{unavailable ? 'Unavailable' : affordable ? 'Claim reward' : `Need ${(reward.points - available).toLocaleString()} more points`}</button>
      </div>
    </article>
  );
}

export default function LearnerRewardsPage() {
  const myLearner = useMyLearner();
  const [learner, setLearner] = useState<LearnerDetail | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [recognitions, setRecognitions] = useState<Recognition[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [tab, setTab] = useState<Tab>('shop');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Reward | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchLearnerDetail(myLearner.kind, myLearner.id),
      fetchRewards(), fetchVoucherClaims(myLearner.id),
      fetchRecognitions(myLearner.id), fetchPointsGrants(myLearner.id),
    ]).then(([detail, rewardRows, claimRows, recognitionRows, grantRows]) => {
      if (cancelled) return;
      setLearner(detail); setRewards(rewardRows); setClaims(claimRows); setRecognitions(recognitionRows); setGrants(grantRows); setError('');
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load rewards.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.id, myLearner.kind]);

  const earned = grants.reduce((sum, grant) => sum + grant.points, 0);
  const committed = claims.filter((claim) => claim.status !== 'rejected').reduce((sum, claim) => sum + claim.points, 0);
  const available = Math.max(earned - committed, 0);
  const categories = useMemo(() => Array.from(new Set(rewards.map((reward) => reward.category).filter(Boolean))).sort(), [rewards]);
  const filteredRewards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rewards.filter((reward) => (category === 'all' || reward.category === category) && (!needle || [reward.name, reward.description, reward.category].some((value) => value.toLowerCase().includes(needle))));
  }, [category, query, rewards]);

  async function confirmClaim() {
    if (!selected || !learner) return;
    setClaiming(true); setError('');
    try {
      const claim = await createVoucherClaim({ learnerId: myLearner.id, learnerName: learner.name, rewardId: selected.id });
      setClaims((current) => [claim, ...current]); setSelected(null); setNotice(`${selected.name} has been submitted for review.`); setTab('claims');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not submit this claim.'); setSelected(null);
    } finally { setClaiming(false); }
  }

  return (
    <WorkspaceShell
      role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Rewards" pageSubtitle="Your points, recognition and reward claims"
      userName={learner?.name || 'Learner'} userRole={learner?.programme ? `${learner.programme} Apprentice` : 'Apprentice'}
    >
      <main className="w-full space-y-4 p-3 sm:p-4 md:space-y-5 md:p-6">
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#17032d] via-[#33105e] to-[#6a2ca0] p-4 text-white shadow-[0_18px_50px_rgba(39,12,73,0.18)] sm:rounded-3xl sm:p-6 md:p-7">
          <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-amber-300/15 blur-3xl"></div>
          <div className="relative flex flex-col gap-4 sm:gap-5 lg:flex-row lg:items-end lg:justify-between"><div><span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-secondary-100"><i className="ri-award-line text-amber-300"></i>Recognition & rewards</span><h1 className="mt-3 text-[22px] font-bold leading-tight text-white sm:text-2xl md:text-3xl">Turn your progress into rewards</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">See every point earned, celebrate recognition and claim available rewards.</p></div><div className="rounded-xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur sm:rounded-2xl sm:px-5"><p className="text-[10px] uppercase tracking-wider text-white/60">Available balance</p><p className="mt-1 text-2xl font-bold text-white sm:text-3xl">{loading ? '–' : available.toLocaleString()} <span className="text-xs font-medium text-amber-300">pts</span></p></div></div>
          <div className="relative mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 sm:mt-5">{[
            ['Lifetime earned', earned, 'ri-sparkling-line', 'text-amber-300'], ['Recognition', recognitions.length, 'ri-medal-line', 'text-emerald-300'], ['Claims', claims.length, 'ri-gift-line', 'text-pink-300'],
          ].map(([label, value, icon, colour]) => <div key={String(label)} className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.07] p-2.5 sm:rounded-2xl sm:p-3"><i className={`${icon} ${colour}`}></i><p className="mt-1 text-lg font-bold text-white sm:text-xl">{loading ? '–' : Number(value).toLocaleString()}</p><p className="truncate text-[9px] text-white/60 sm:text-[10px]">{label}</p></div>)}</div>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><i className="ri-error-warning-line mr-2"></i>{error}</div>}
        {notice && <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"><span><i className="ri-checkbox-circle-line mr-2"></i>{notice}</span><button onClick={() => setNotice('')}><i className="ri-close-line"></i></button></div>}

        <section className="rounded-2xl border border-foreground-200/70 bg-white/95 p-2.5 shadow-[0_8px_30px_rgba(31,14,59,0.08)] backdrop-blur-xl md:sticky md:top-2 md:z-10">
          <div className="grid grid-cols-2 gap-1.5 sm:flex">{tabs.map((item) => { const count = item.key === 'shop' ? rewards.length : item.key === 'claims' ? claims.length : item.key === 'recognition' ? recognitions.length : grants.length; return <button key={item.key} onClick={() => setTab(item.key)} className={`flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2.5 text-[11px] font-semibold transition sm:gap-2 sm:px-4 sm:text-xs ${tab === item.key ? 'bg-primary-700 text-white shadow-md shadow-primary-700/20' : 'text-foreground-500 hover:bg-primary-50 hover:text-primary-700'}`}><i className={`${item.icon} shrink-0`}></i><span className="truncate">{item.label}</span><span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] ${tab === item.key ? 'bg-white/15 text-white' : 'bg-background-100 text-foreground-400'}`}>{count}</span></button>; })}</div>
        </section>

        {loading ? <Loading /> : tab === 'shop' ? <section><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-bold text-foreground-900">Rewards shop</h2><p className="mt-1 text-xs text-foreground-500">Available items from Engagement.rewards</p></div><div className="flex flex-col gap-2 sm:flex-row"><select value={category} onChange={(event) => setCategory(event.target.value)} className="h-10 w-full rounded-xl border border-foreground-200 bg-white px-3 text-xs outline-none sm:w-auto"><option value="all">All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><label className="relative block sm:w-56"><i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400"></i><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search rewards…" className="h-10 w-full rounded-xl border border-foreground-200 pl-9 pr-3 text-sm outline-none focus:border-primary-400" /></label></div></div>{filteredRewards.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filteredRewards.map((reward) => <RewardCard key={reward.id} reward={reward} available={available} onClaim={setSelected} />)}</div> : <Empty icon="ri-gift-line" title="No rewards found" />}</section>
        : tab === 'claims' ? <ListSection title="My claims" subtitle="Requests submitted from your account">{claims.length ? claims.map((claim) => <ClaimRow key={claim.id} claim={claim} />) : <Empty icon="ri-coupon-3-line" title="You have not claimed a reward yet" />}</ListSection>
        : tab === 'recognition' ? <ListSection title="Recognition" subtitle="Awards recorded for your learner account">{recognitions.length ? <div className="grid gap-4 md:grid-cols-2">{recognitions.map((recognition) => <RecognitionCard key={recognition.id} recognition={recognition} />)}</div> : <Empty icon="ri-medal-line" title="No recognition has been recorded yet" />}</ListSection>
        : <ListSection title="Points activity" subtitle="Every points grant recorded for your learner account">{grants.length ? grants.map((grant) => <GrantRow key={grant.id} grant={grant} />) : <Empty icon="ri-history-line" title="No points activity has been recorded yet" />}</ListSection>}
      </main>

      {selected && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground-950/50 p-4 backdrop-blur-sm" onMouseDown={() => !claiming && setSelected(null)}><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-700"><i className="ri-gift-2-line text-xl"></i></span><h2 className="mt-4 text-xl font-bold text-foreground-900">Claim {selected.name}?</h2><p className="mt-2 text-sm leading-6 text-foreground-500">This request will reserve <strong className="text-foreground-800">{selected.points.toLocaleString()} points</strong> from your available balance and send the claim for review.</p><div className="mt-5 flex gap-2"><button onClick={() => setSelected(null)} disabled={claiming} className="h-11 flex-1 rounded-xl border border-foreground-200 text-sm font-semibold text-foreground-600">Cancel</button><button onClick={confirmClaim} disabled={claiming} className="h-11 flex-1 rounded-xl bg-primary-700 text-sm font-bold text-white">{claiming ? <i className="ri-loader-4-line animate-spin"></i> : 'Confirm claim'}</button></div></div></div>}
    </WorkspaceShell>
  );
}

function ListSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section><div className="mb-4"><h2 className="text-lg font-bold text-foreground-900">{title}</h2><p className="mt-1 text-xs text-foreground-500">{subtitle}</p></div><div className="space-y-3">{children}</div></section>; }
function ClaimRow({ claim }: { claim: Claim }) { return <article className="flex flex-col gap-3 rounded-2xl border border-background-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600"><i className="ri-coupon-3-line"></i></span><div className="min-w-0 flex-1"><h3 className="text-sm font-bold text-foreground-900">{claim.reward}</h3><p className="mt-1 text-xs text-foreground-400">Requested {new Date(claim.requestedAt).toLocaleDateString('en-GB')} · {claim.points.toLocaleString()} points</p></div><span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ring-1 ring-inset ${claimStyle[claim.status] || 'bg-background-100 text-foreground-600 ring-background-200'}`}>{claim.status}</span></article>; }
function RecognitionCard({ recognition }: { recognition: Recognition }) { return <article className="rounded-2xl border border-background-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><i className="ri-medal-line text-lg"></i></span><div><p className="text-[10px] font-bold uppercase tracking-wider text-primary-600">{recognition.type}</p><h3 className="mt-1 text-sm font-bold text-foreground-900">{recognition.title}</h3></div></div><p className="mt-3 text-sm leading-6 text-foreground-500">{recognition.description}</p><div className="mt-4 flex flex-wrap items-center gap-3 border-t border-background-200 pt-3 text-[10px] text-foreground-400"><span><i className="ri-user-star-line mr-1"></i>{recognition.awardedBy}</span><span><i className="ri-calendar-line mr-1"></i>{recognition.awardedAt}</span>{recognition.points > 0 && <span className="font-bold text-primary-600">+{recognition.points} points</span>}</div></article>; }
function GrantRow({ grant }: { grant: Grant }) { return <article className="flex items-center gap-3 rounded-2xl border border-background-200 bg-white p-4 shadow-sm"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><i className="ri-add-circle-line"></i></span><div className="min-w-0 flex-1"><h3 className="text-sm font-bold text-foreground-900">{grant.rule}</h3><p className="mt-1 text-xs text-foreground-400">{grant.category || 'Points award'} · {grant.awardedAt}</p></div><span className="text-sm font-bold text-emerald-600">+{grant.points.toLocaleString()}</span></article>; }
function Loading() { return <div className="rounded-2xl border border-background-200 bg-white px-4 py-10 text-center text-sm text-foreground-400 sm:p-14"><i className="ri-loader-4-line mr-2 animate-spin text-primary-600"></i>Loading rewards from the database…</div>; }
function Empty({ icon, title }: { icon: string; title: string }) { return <div className="rounded-2xl border border-dashed border-foreground-300 bg-white px-4 py-10 text-center sm:px-6 sm:py-14"><span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 text-primary-500"><i className={`${icon} text-xl`}></i></span><p className="mt-3 text-sm font-semibold text-foreground-700">{title}</p></div>; }
