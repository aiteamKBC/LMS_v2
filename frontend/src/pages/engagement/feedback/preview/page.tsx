import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { feedbackApi, type FeedbackForm } from '@/api/feedback';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { FormRenderer } from '@/features/feedback/FormRenderer';
import { useOperatorIdentity } from '@/hooks/useOperatorIdentity';
import { roleNavMap } from '@/mocks/navigation';

export default function FeedbackPreviewPage() {
  const { formId } = useParams(); const navigate = useNavigate(); const operator = useOperatorIdentity();
  const [form, setForm] = useState<FeedbackForm | null>(null);
  useEffect(() => { if (formId) feedbackApi.getForm(Number(formId)).then(x => setForm(x.form)).catch(error => void Swal.fire({ icon: 'error', title: 'Could not load preview', text: error.message })); }, [formId]);
  const nav = roleNavMap.engagement;
  return <WorkspaceShell role="engagement" roleLabel={nav.label} navItems={nav.items} workspaceLabel={nav.workspaceLabel} pageTitle="Feedback Preview" pageSubtitle="Learner view of this feedback form" userName={operator.name} userRole={operator.role}>
    <div className="p-6"><button onClick={() => navigate(-1)} className="mb-4 text-xs font-semibold text-primary-600">← Back</button>{form ? <div className="mx-auto max-w-4xl rounded-2xl border border-foreground-200/60 bg-background-100 p-6"><div className="mb-5"><span className="rounded-full bg-primary-100 px-2 py-1 text-[10px] font-semibold text-primary-700">Learner View</span><h1 className="mt-3 font-heading text-2xl font-bold text-foreground-900">{form.title}</h1><p className="mt-1 text-sm text-foreground-500">{form.description}</p>{form.instructions && <div className="mt-3 rounded-lg bg-primary-50 p-3 text-xs text-primary-800">{form.instructions}</div>}</div><FormRenderer sections={form.sections || []} answers={{}} readOnly /></div> : <p className="text-center text-sm text-foreground-400">Loading preview…</p>}</div>
  </WorkspaceShell>;
}
