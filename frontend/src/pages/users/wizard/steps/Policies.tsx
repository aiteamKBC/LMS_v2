import { useWizard } from '../WizardContext';
import { POLICY_DOCS_KBC, POLICY_DOCS_IBIS } from '@/mocks/enrolment-console';
import { StepHeading } from './fields';

export default function Policies() {
  const { draft, setSection } = useWizard();
  const acknowledged = draft.policies.acknowledged;

  const toggle = (id: string) =>
    setSection('policies', { acknowledged: { ...acknowledged, [id]: !acknowledged[id] } });

  const ackCount = POLICY_DOCS_KBC.filter((d) => acknowledged[d.id]).length;

  return (
    <div>
      <StepHeading title="Documents" />

      {/* Group A — KBC (with acknowledgement) */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-heading font-semibold text-foreground-800">Kent Business College</h3>
          <span className="text-[11px] text-foreground-400">{ackCount} of {POLICY_DOCS_KBC.length} acknowledged</span>
        </div>
        <div className="divide-y divide-foreground-100 border border-foreground-100 rounded-lg">
          {POLICY_DOCS_KBC.map((doc) => (
            <div key={doc.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <a href={doc.url} className="text-[12px] text-primary-600 hover:underline inline-flex items-center gap-1.5 min-w-0">
                <i className="ri-file-pdf-2-line text-red-500 shrink-0" />
                <span className="break-all">{doc.label}</span>
              </a>
              <label className="flex items-center gap-1.5 text-[11px] text-foreground-600 cursor-pointer shrink-0">
                <input type="checkbox" checked={!!acknowledged[doc.id]} onChange={() => toggle(doc.id)} className="accent-primary-500" />
                I have read and understood this document
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* Group B — IBIS (links only) */}
      <div>
        <h3 className="text-[13px] font-heading font-semibold text-foreground-800 mb-2">IBIS</h3>
        <div className="divide-y divide-foreground-100 border border-foreground-100 rounded-lg">
          {POLICY_DOCS_IBIS.map((doc) => (
            <div key={doc.id} className="px-3 py-2.5">
              <a href={doc.url} className="text-[12px] text-primary-600 hover:underline inline-flex items-center gap-1.5">
                <i className="ri-file-pdf-2-line text-red-500 shrink-0" />
                <span className="break-all">{doc.label}</span>
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
