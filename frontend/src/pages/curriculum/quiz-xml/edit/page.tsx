// Route wrapper for /curriculum/quiz-xml/:id/edit — just supplies the
// curriculum WorkspaceShell chrome around the shared QuizEditorPanel, which
// holds the entire editor. The Week Builder renders the same panel inline.
import { useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { QuizEditorPanel } from './QuizEditorPanel';

const curriculumNav = roleNavMap.curriculum;

export default function QuizEditPage() {
  const { quizId } = useParams();
  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel={curriculumNav.label}
      navItems={curriculumNav.items}
      workspaceLabel={curriculumNav.workspaceLabel}
      pageTitle="Quiz Editor"
      pageSubtitle="Review questions, learner settings and Q&A content"
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <QuizEditorPanel quizId={quizId} />
    </WorkspaceShell>
  );
}
