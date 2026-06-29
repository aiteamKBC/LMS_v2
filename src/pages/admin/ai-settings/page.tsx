import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { adminNavItems } from '@/mocks/navigation';
import AiSettingsPage from '@/pages/admin/settings/AiSettingsPage';

export default function StandaloneAiSettings() {
  return (
    <WorkspaceShell role="admin" roleLabel="Admin" navItems={adminNavItems} pageTitle="AI Settings" pageSubtitle="Configure AI-assisted features, audit trail, and governance rules" userName="Admin User" userRole="Tenant Administrator">
      <AiSettingsPage />
    </WorkspaceShell>
  );
}