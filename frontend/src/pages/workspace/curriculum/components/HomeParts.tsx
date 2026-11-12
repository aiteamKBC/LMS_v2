import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import type { HomeModule, ProgrammeFocus } from '../useCurriculumHome';
import { clean } from './attentionMeta';

const STATUS_TONES: Record<string, string> = {
  published: 'bg-emerald-50 text-emerald-700',
  active: 'bg-emerald-50 text-emerald-700',
  draft: 'bg-amber-50 text-amber-700',
  archived: 'bg-background-200 text-foreground-600',
};

/** The module's own status in words; a blank status reads as a draft, as before. */
export function ModuleStatusBadge({ status }: { status: string }) {
  const key = clean(status).toLowerCase() || 'draft';
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  return <span className={`inline-flex shrink-0 rounded-full px-2 py-1 text-[9px] font-extrabold uppercase ${STATUS_TONES[key] ?? 'bg-sky-50 text-sky-700'}`}>{label}</span>;
}

export function ContinueModuleRow({ module, onOpen }: { module: HomeModule; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className="group flex min-h-[58px] w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-200 hover:bg-primary-50/35 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-inset"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700"><AppIcon className="ri-layout-4-line" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-bold text-foreground-900">{clean(module.name) || 'Untitled module'}</span><span className="mt-0.5 block truncate text-[10px] leading-4 text-foreground-500">{clean(module.programme) || 'Reusable module'} · {Number(module.weeks || 0)} weeks</span></span><ModuleStatusBadge status={module.status} /><AppIcon className="ri-arrow-right-s-line shrink-0 text-foreground-300 transition-colors group-hover:text-primary-600" /></button>;
}

export function ProgrammeFocusCard({ item, onOpen }: { item: ProgrammeFocus; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className="group flex min-h-[128px] w-full flex-col rounded-[14px] border border-foreground-200/70 bg-background-50 p-4 text-left shadow-[0_4px_14px_-12px_rgba(31,14,59,0.25)] transition-all duration-200 hover:border-primary-200 hover:shadow-[0_10px_20px_-14px_rgba(68,30,115,0.28)] focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2"><div className="flex items-start justify-between gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-700"><AppIcon className="ri-stack-line" /></span><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-extrabold text-amber-700">{item.issueCount} {item.issueCount === 1 ? 'action' : 'actions'}</span></div><h3 className="mt-2 line-clamp-1 text-[13px] font-bold text-foreground-950">{item.programme.name}</h3><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-foreground-500">{item.issues.join(' · ')}</p><span className="mt-auto inline-flex items-center gap-1 pt-2 text-[10px] font-bold text-primary-700">Review programme <AppIcon className="ri-arrow-right-line transition-transform duration-200 group-hover:translate-x-0.5" /></span></button>;
}

export function WorkflowCard({ step, title, detail, href, icon }: { step: string; title: string; detail: string; href: string; icon: string }) {
  return <Link to={href} className="group flex min-h-[88px] items-center gap-3 rounded-[14px] border border-foreground-200/75 bg-background-50 p-4 shadow-[0_5px_16px_-12px_rgba(31,14,59,0.28)] transition-all duration-200 hover:border-primary-200 hover:shadow-[0_10px_22px_-14px_rgba(68,30,115,0.3)] focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><AppIcon className={`${icon} text-lg`} /></span><span className="min-w-0"><span className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-primary-600">Step {step}</span><span className="mt-0.5 block text-[12px] font-bold text-foreground-900">{title}</span><span className="mt-1 block text-[11px] leading-4 text-foreground-500">{detail}</span></span></Link>;
}

export function SectionHeader({ title, detail, href, action }: { title: string; detail: string; href: string; action: string }) {
  return <div className="flex flex-col gap-2.5 border-b border-background-200 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-heading text-lg font-bold leading-tight text-foreground-950">{title}</h2><p className="mt-1 text-[11px] leading-4 text-foreground-500">{detail}</p></div><Link to={href} className="compact-action rounded-md text-[11px] font-bold text-primary-700 transition-colors duration-200 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:ring-offset-2">{action}<AppIcon className="ri-arrow-right-line" /></Link></div>;
}

export function EmptyState({ icon, title, detail, compact = false }: { icon: string; title: string; detail: string; compact?: boolean }) {
  return <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6' : 'py-8'}`}><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><AppIcon className={`${icon} text-xl`} /></span><p className="mt-3 text-[12px] font-bold text-foreground-900">{title}</p><p className="mt-1 max-w-md text-[11px] leading-5 text-foreground-500">{detail}</p></div>;
}

export function LoadingRows({ count }: { count: number }) {
  return <div className="space-y-2 py-1">{Array.from({ length: count }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-background-100" />)}</div>;
}
