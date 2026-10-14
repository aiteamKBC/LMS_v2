import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { feedbackApi, type FeedbackForm } from '@/api/feedback';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { FeedbackFormHeader, FormRenderer } from '@/features/feedback/FormRenderer';
import { useOperatorIdentity } from '@/hooks/useOperatorIdentity';
import { roleNavMap } from '@/mocks/navigation';

export default function FeedbackPreviewPage() {
  const { formId } = useParams(); const navigate = useNavigate(); const operator = useOperatorIdentity();
  const [form, setForm] = useState<FeedbackForm | null>(null);
  useEffect(() => { if (formId) feedbackApi.getForm(Number(formId)).then(x => setForm(x.form)).catch(error => void Swal.fire({ icon: 'error', title: 'Could not load preview', text: error.message })); }, [formId]);
  const nav = roleNavMap.engagement;
  return <WorkspaceShell role="engagement" roleLabel={nav.label} navItems={nav.items} workspaceLabel={nav.workspaceLabel} pageTitle="Feedback Preview" pageSubtitle="Learner view of this feedback form" userName={operator.name} userRole={operator.role}>
    <div className="p-6"><button onClick={() => navigate(-1)} className="mb-4 text-xs font-semibold text-primary-600">← Back</button>{form ? <div className="mx-auto max-w-4xl rounded-2xl border border-foreground-200/60 bg-background-100 p-6"><span className="mb-4 inline-block rounded-full bg-primary-100 px-2 py-1 text-[10px] font-semibold text-primary-700">Learner View</span><FeedbackFormHeader title={form.title} description={form.description} instructions={form.instructions} /><FormRenderer sections={form.sections || []} answers={{}} readOnly /></div> : <p className="text-center text-sm text-foreground-400">Loading preview…</p>}</div>
  </WorkspaceShell>;
}
