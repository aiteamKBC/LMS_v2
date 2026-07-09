import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { KsbFrameworkManager } from '@/components/feature/KsbFrameworkManager';
import { useCurriculumKsbFrameworks } from '@/hooks/useCurriculumKsbFrameworks';
import { useCurriculumKsbSets } from '@/hooks/useCurriculumKsbSets';
import { useCurriculumProgrammes } from '@/hooks/useCurriculumProgrammes';
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;

export default function CurriculumKsbFrameworks() {
  const { frameworks, loading, error, reload: reloadFrameworks } = useCurriculumKsbFrameworks();
  const { ksbSets, reload: reloadKsbSets } = useCurriculumKsbSets();
  const { programmes } = useCurriculumProgrammes();

  const refresh = () => {
    reloadFrameworks();
    reloadKsbSets();
  };

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel={curriculumNav.label}
      navItems={curriculumNav.items}
      workspaceLabel={curriculumNav.workspaceLabel}
      pageTitle="KSB Frameworks"
      pageSubtitle="Create, edit and manage KSB profiles for curriculum standards."
      userName="Emma Walsh"
      userRole="Curriculum Lead"
    >
      <div className="p-6 space-y-4">
        {error && (
          <div className="rounded-xl border border-red-200/60 bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">
            Curriculum API error: {error}. Start the Django backend on port 8000 and refresh.
          </div>
        )}
        <KsbFrameworkManager
          frameworks={frameworks}
          ksbSets={ksbSets}
          programmes={programmes}
          loading={loading}
          onRefresh={refresh}
          onClose={() => window.REACT_APP_NAVIGATE('/curriculum/ksb-mapping')}
        />
      </div>
    </WorkspaceShell>
  );
}
