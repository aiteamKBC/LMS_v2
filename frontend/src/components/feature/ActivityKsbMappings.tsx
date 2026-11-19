import type { ComponentKsbMapping, LearnerKsbItem } from '@/api/learnerDetail';

export function ActivityKsbMappings({ mappings, learnerKsbs = [] }: {
  mappings?: ComponentKsbMapping[];
  learnerKsbs?: LearnerKsbItem[];
}) {
  if (!mappings?.length) return null;

  return (
    <section aria-label="Mapped KSBs" className="my-4 rounded-xl border border-primary-200 bg-primary-50/50 p-4">
      <h2 className="text-sm font-semibold text-foreground-900">Mapped KSBs</h2>
      <p className="mt-1 text-xs text-foreground-600">Knowledge, skills and behaviours covered by this activity.</p>
      <ul className="mt-3 space-y-2">
        {mappings.map(mapping => {
          const description = mapping.description?.trim()
            || learnerKsbs.find(item => item.code === mapping.code)?.description;
          return (
            <li key={mapping.code} className="flex min-w-0 items-start gap-2 text-sm">
              <span className="shrink-0 rounded-md bg-primary-100 px-2 py-0.5 font-semibold text-primary-800">{mapping.code}</span>
              {description && <span className="min-w-0 break-words leading-6 text-foreground-700">{description}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
