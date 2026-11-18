import type { QualityRecord } from "@/types/qms";

interface MeetingTypesModalProps {
  records: QualityRecord[];
  onClose: () => void;
  onOpenType: (formId: string) => void;
}

function meetingTypeLabel(record: QualityRecord) {
  const value = `${record.formName} ${record.formId}`.toLowerCase();
  if (value.includes("monthly coaching") || value.includes("mcm")) return "Monthly Coaching";
  if (/progress review|\bpr\b/i.test(value)) return "Progress Review";
  if (value.includes("gateway")) return "Gateway Review";
  if (value.includes("epa")) return "EPA Review";
  return record.formName;
}

export default function MeetingTypesModal({ records, onClose, onOpenType }: MeetingTypesModalProps) {
  const types = [...records
    .filter((record) => record.category === "Quality Audit")
    .reduce((map, record) => {
      const current = map.get(record.formId) ?? { id: record.formId, label: meetingTypeLabel(record), count: 0 };
      current.count += 1;
      map.set(record.formId, current);
      return map;
    }, new Map<string, { id: string; label: string; count: number }>())]
    .map(([, value]) => value)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-foreground-950/35 p-4" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-types-title"
        className="w-full max-w-lg rounded-2xl border border-background-200 bg-background-50 p-5 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.12em] text-primary-700">Completed audits</p>
            <h2 id="meeting-types-title" className="mt-1 font-heading text-lg font-semibold text-foreground-950">Meeting types</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-foreground-600">Choose a meeting type to open its saved quality audit records.</p>
          </div>
          <button type="button" aria-label="Close meeting types" onClick={onClose} className="rounded-md p-1.5 text-foreground-500 hover:bg-background-100 hover:text-foreground-900">
            <i className="ri-close-line text-lg" aria-hidden="true" />
          </button>
        </div>

        {types.length ? (
          <div className="mt-5 space-y-2">
            {types.map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => onOpenType(type.id)}
                className="flex w-full items-center justify-between gap-4 rounded-xl border border-background-200 bg-white px-4 py-3 text-left transition-colors hover:border-primary-300 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground-900">{type.label}</span>
                  <span className="mt-0.5 block text-[11px] text-foreground-500">Open saved audit records</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs font-semibold text-primary-700">
                  {type.count} audits
                  <i className="ri-arrow-right-line" aria-hidden="true" />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-lg bg-background-100 p-4 text-sm text-foreground-600">No completed audits match the current filters.</p>
        )}
      </section>
    </div>
  );
}
