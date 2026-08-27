// ============================================================================
// The guided run's last step: the handoff to the Module Builder.
//
// The wizard's job ends with the module. Programme, cohort, group and module are
// created and linked by the steps before this one, and the module already carries
// its weeks. What goes *inside* those weeks — components, their titles, media and
// KSB mappings — is the Module Builder's to own, so this page names that rather
// than doing a piece of it here.
//
// It used to pick component types and write empty shells into every week, and a
// review page followed it. Both are gone: the shells still had to be opened in
// the Module Builder to mean anything, reading the new module's weeks back to
// offer the choice was the one slow request in the run, and a separate review
// only restated the rail above. So this page closes the run — it loads nothing,
// saves nothing, and carries the one thing the review had of its own: what the
// run leaves outstanding.
// ============================================================================

import { AppIcon } from '@/components/feature/AppIcon';
import { EntityDrawer, type FormChainStep } from './ui';

export function StructureWizardOutlineStep({
  open,
  moduleName,
  outstanding,
  chain,
  onClose,
  onDone,
}: {
  open: boolean;
  moduleName: string;
  /** What the run still leaves for someone to do, said here rather than found later. */
  outstanding: string[];
  chain: FormChainStep;
  onClose: () => void;
  /** Nothing is written here, so this only closes the run. */
  onDone: () => void;
}) {
  const module = moduleName || 'the new module';

  return (
    <EntityDrawer
      open={open}
      title="Where the components are added"
      subtitle={`Everything this wizard sets up is saved. The components inside ${module}'s weeks are authored in the Module Builder.`}
      banner={chain.banner}
      onClose={onClose}
      onSubmit={onDone}
      submitLabel={chain.submitLabel || 'Finish'}
      cancelLabel={chain.cancelLabel}
      extraAction={chain.extraAction}
      backAction={chain.backAction}
      width={chain.width}
    >
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <p className="flex items-center gap-2 text-[12px] font-bold text-emerald-800">
          <AppIcon className="ri-checkbox-circle-fill text-sm"></AppIcon>
          The guided setup has done its part
        </p>
        <p className="mt-1 text-[12px] leading-5 text-emerald-700">
          {module} is saved with its weeks, and every record above it is linked to it. There is nothing
          left for the wizard to create.
        </p>
      </div>

      <div className="rounded-lg border border-background-200 bg-background-50 px-3 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-foreground-400">What is left to do</p>
        <p className="mt-1 text-[12px] leading-5 text-foreground-500">
          The weeks are empty. Open the Module Builder, pick {module}, and add the components each week
          delivers — that is also where their titles, content, media and KSB mappings are written.
        </p>
        <p className="mt-1.5 text-[11px] leading-4 text-foreground-400">
          <AppIcon className="ri-information-line mr-1 text-[11px]"></AppIcon>
          You can go there whenever you like — the module keeps its weeks until you do.
        </p>
      </div>

      {outstanding.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Still outstanding</p>
          <ul className="mt-1.5 space-y-1">
            {outstanding.map(item => (
              <li key={item} className="flex gap-1.5 text-[12px] leading-5 text-amber-800">
                <AppIcon className="ri-error-warning-line mt-0.5 shrink-0 text-sm"></AppIcon>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11px] leading-4 text-foreground-400">
        Every record in the run is already saved. Finishing closes it; nothing is written or undone by that.
      </p>
    </EntityDrawer>
  );
}
