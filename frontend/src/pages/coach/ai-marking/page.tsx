import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;

export default function CoachAiMarking() {
  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="AI-assisted Marking" pageSubtitle="Review AI-generated assessments and provide final scores" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <AppIcon className="ri-robot-line text-white text-2xl"></AppIcon>
            </span>
            <div>
              <h2 className="text-lg font-heading font-bold text-white mb-1">AI-assisted Marking</h2>
              <p className="text-[13px] text-white/80">AI-assisted assessment and marking tools.</p>
            </div>
          </div>
        </div>

        <div className="bg-background-50 rounded-xl border border-foreground-200/60 px-6 py-24 text-center">
          <div className="flex flex-col items-center gap-3">
            <span className="w-14 h-14 rounded-2xl bg-primary-50 text-primary-500 flex items-center justify-center">
              <AppIcon className="ri-time-line text-2xl"></AppIcon>
            </span>
            <p className="text-base font-semibold text-foreground-700">Coming Soon</p>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
