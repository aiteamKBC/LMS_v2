import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { FormBuilder } from '@/features/feedback/FormBuilder';
import { useOperatorIdentity } from '@/hooks/useOperatorIdentity';
import { roleNavMap } from '@/mocks/navigation';

export default function FeedbackEditorPage() {
  const operator = useOperatorIdentity();
  const navigation = roleNavMap.engagement;
  return <WorkspaceShell role="engagement" roleLabel={navigation.label} navItems={navigation.items} workspaceLabel={navigation.workspaceLabel} pageTitle="Feedback Form Builder" pageSubtitle="Create and preview reusable learner feedback forms" userName={operator.name} userRole={operator.role}>
    <FormBuilder />
  </WorkspaceShell>;
}
