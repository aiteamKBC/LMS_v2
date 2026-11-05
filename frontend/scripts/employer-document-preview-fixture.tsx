import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AppIcon } from '../src/components/feature/AppIcon';
import { EmployerDocumentsTable } from '../src/pages/employer/EmployerDocumentsTable';
import { EmployerDocumentPreview } from '../src/pages/employer/EmployerDocumentPreview';
import { targetKey, type SigningTarget } from '../src/pages/employer/useEmployerSigning';
import type { EmployerOwnedItem } from '../src/api/employerPortal';
import '../src/index.css';
import '../src/learner-theme.css';

Object.assign(window, { AppIcon });
const item: EmployerOwnedItem = {
  kind: 'review', eventKey: 'draft-1', reviewInstanceId: 'ri-1', reviewType: 'progress', label: 'Draft progress review',
  scheduledDate: '2026-10-21', signable: false, completed: false, signed: false, signedName: '', signedAt: null,
  sectionsTotal: 1, employerSignatureRequired: true, learnerSigned: false, adminSigned: false,
  learner: { id: '101', kind: 'commercial', name: 'Example learner', programme: 'Example programme' },
};
function Fixture() {
  const [preview, setPreview] = useState<SigningTarget | null>(null);
  return <MemoryRouter><main className="dashboard-theme p-5" data-workspace-role="learner">
    <h1 className="mb-6 text-2xl font-bold text-primary-800">All documents</h1>
    <EmployerDocumentsTable employerId="9" items={[item, { ...item, eventKey: 'signed-1', label: 'Signed progress review', completed: true, signed: true }]}
      opening={preview ? targetKey(preview) : null} onShow={setPreview} onSign={() => { throw new Error('Preview must not sign'); }} />
    {preview && <EmployerDocumentPreview employerId="9" target={preview} onClose={() => setPreview(null)} />}
  </main></MemoryRouter>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
