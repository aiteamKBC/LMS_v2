import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import type { HomeModule } from '../useCurriculumHome';
import { HomeModal } from './HomeModal';
import { clean } from './attentionMeta';
import { ModuleStatusBadge } from './HomeParts';

export function ContinueModuleModal({ module, onClose }: { module: HomeModule; onClose: () => void }) {
  const weeks = Number(module.weeks || 0);
  const rows = [
    { label: 'Programme', value: clean(module.programme) || 'Not linked to a programme (reusable module)' },
    { label: 'Status', value: <ModuleStatusBadge status={module.status} /> },
    { label: 'Weeks', value: weeks ? `${weeks} ${weeks === 1 ? 'week' : 'weeks'}` : 'No weeks added yet' },
  ];
  return (
    <HomeModal onClose={onClose} eyebrow="Continue working" title={clean(module.name) || `Unnamed module (${module.id})`}
      footer={<Link data-autofocus to={`/curriculum/module-builder?module=${encodeURIComponent(module.id)}`} onClick={onClose} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary-600 px-4 text-[12px] font-bold text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300">Open in Module Builder<AppIcon className="ri-arrow-right-line" /></Link>}>
      <dl className="m-4 divide-y divide-background-200 rounded-xl border border-background-200 bg-background-50">
        {rows.map(row => (
          <div key={row.label} className="flex min-w-0 items-center justify-between gap-4 px-3 py-2.5">
            <dt className="shrink-0 text-[11px] font-semibold text-foreground-500">{row.label}</dt>
            <dd className="min-w-0 break-words text-right text-[12px] text-foreground-800">{row.value}</dd>
          </div>
        ))}
      </dl>
    </HomeModal>
  );
}
