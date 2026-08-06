import { useState } from 'react';
import type { EnrolmentReviewRecord } from '@/mocks/enrolment-review';

interface ReviewActionsProps {
  record: EnrolmentReviewRecord;
}

export function ReviewActions({ record }: ReviewActionsProps) {
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [showEvidenceForm, setShowEvidenceForm] = useState(false);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [showEscalateConfirm, setShowEscalateConfirm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);

  const [returnReason, setReturnReason] = useState('');
  const [evidenceItems, setEvidenceItems] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [escalateReason, setEscalateReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const isReturnedOrAbove = record.overallStatus === 'Returned to Learner' ||
    record.overallStatus === 'Rejected at Enrolment' ||
    record.overallStatus === 'Escalated';

  const handleApprove = () => {
    setActionFeedback('Learner approved for eligibility review. Case will be forwarded to the eligibility team.');
    setShowApproveConfirm(false);
  };

  const handleReturn = () => {
    if (!returnReason.trim()) return;
    setActionFeedback('Learner returned with corrections requested. They will be notified to update their submission.');
    setShowReturnForm(false);
    setReturnReason('');
  };

  const handleRequestEvidence = () => {
    if (!evidenceItems.trim()) return;
    setActionFeedback('Evidence request sent to learner. They have 7 days to upload the requested documents.');
    setShowEvidenceForm(false);
    setEvidenceItems('');
  };

  const handleAddNote = () => {
    if (!noteContent.trim()) return;
    setActionFeedback('Internal note saved. It will appear in the case file.');
    setShowNoteForm(false);
    setNoteContent('');
  };

  const handleEscalate = () => {
    if (!escalateReason.trim()) return;
    setActionFeedback('Case escalated to senior compliance officer for review.');
    setShowEscalateConfirm(false);
    setEscalateReason('');
  };

  const handleReject = () => {
    if (!rejectReason.trim()) return;
    setActionFeedback('Case rejected at enrolment. Learner and employer will be notified.');
    setShowRejectConfirm(false);
    setRejectReason('');
  };

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <AppIcon className="ri-tools-line text-foreground-400"></AppIcon>
        <h3 className="text-sm font-heading font-semibold text-foreground-900">Review Actions</h3>
      </div>

      {/* Feedback banner */}
      {actionFeedback && (
        <div className="mb-4 px-3 py-2.5 bg-emerald-50 rounded-lg border border-emerald-200/50 flex items-start gap-2">
          <AppIcon className="ri-checkbox-circle-line text-emerald-500 text-sm mt-0.5 shrink-0"></AppIcon>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-emerald-700">{actionFeedback}</p>
          </div>
          <button
            onClick={() => setActionFeedback(null)}
            className="text-emerald-400 hover:text-emerald-600 cursor-pointer shrink-0"
          >
            <AppIcon className="ri-close-line"></AppIcon>
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {/* Approve */}
        <button
          onClick={() => setShowApproveConfirm(true)}
          disabled={isReturnedOrAbove}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200/50 text-emerald-700 hover:bg-emerald-100 transition-smooth text-[12px] font-medium cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <AppIcon className="ri-check-line"></AppIcon>
          Approve for Eligibility
        </button>

        {/* Return */}
        <button
          onClick={() => setShowReturnForm(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200/50 text-amber-700 hover:bg-amber-100 transition-smooth text-[12px] font-medium cursor-pointer whitespace-nowrap"
        >
          <AppIcon className="ri-arrow-go-back-line"></AppIcon>
          Return to Learner
        </button>

        {/* Request Evidence */}
        <button
          onClick={() => setShowEvidenceForm(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary-50 border border-primary-200/50 text-primary-700 hover:bg-primary-100 transition-smooth text-[12px] font-medium cursor-pointer whitespace-nowrap"
        >
          <AppIcon className="ri-file-search-line"></AppIcon>
          Request Evidence
        </button>

        {/* Add Note */}
        <button
          onClick={() => setShowNoteForm(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-background-100 border border-background-200/50 text-foreground-600 hover:bg-background-200/60 transition-smooth text-[12px] font-medium cursor-pointer whitespace-nowrap"
        >
          <AppIcon className="ri-sticky-note-line"></AppIcon>
          Add Internal Note
        </button>

        {/* Escalate */}
        <button
          onClick={() => setShowEscalateConfirm(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-secondary-50 border border-secondary-200/50 text-secondary-700 hover:bg-secondary-100 transition-smooth text-[12px] font-medium cursor-pointer whitespace-nowrap"
        >
          <AppIcon className="ri-alert-line"></AppIcon>
          Escalate
        </button>

        {/* Reject */}
        <button
          onClick={() => setShowRejectConfirm(true)}
          disabled={record.overallStatus === 'Rejected at Enrolment'}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200/50 text-red-700 hover:bg-red-100 transition-smooth text-[12px] font-medium cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <AppIcon className="ri-close-circle-line"></AppIcon>
          Reject Case
        </button>
      </div>

      {/* === MODALS === */}

      {/* Approve Confirmation */}
      {showApproveConfirm && (
        <Modal onClose={() => setShowApproveConfirm(false)}>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <AppIcon className="ri-check-line text-emerald-600"></AppIcon>
              </div>
              <h4 className="text-sm font-heading font-semibold text-foreground-900">Approve for Eligibility Review</h4>
            </div>
            <p className="text-[12px] text-foreground-500 mb-1">You are about to approve <strong className="text-foreground-700">{record.learnerName}</strong> for eligibility review.</p>
            {record.missingInformation.length > 0 && (
              <div className="mt-2 p-2.5 bg-amber-50 rounded-lg border border-amber-200/50">
                <p className="text-[11px] text-amber-700 font-medium">Warning: {record.missingInformation.length} item{record.missingInformation.length !== 1 ? 's' : ''} still flagged as missing. The eligibility team will be notified.</p>
              </div>
            )}
            <div className="flex items-center gap-2.5 mt-4">
              <button onClick={handleApprove} className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[12px] font-medium cursor-pointer whitespace-nowrap transition-smooth">Confirm Approval</button>
              <button onClick={() => setShowApproveConfirm(false)} className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-600 rounded-lg text-[12px] font-medium cursor-pointer whitespace-nowrap transition-smooth">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Return Form */}
      {showReturnForm && (
        <Modal onClose={() => { setShowReturnForm(false); setReturnReason(''); }}>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                <AppIcon className="ri-arrow-go-back-line text-amber-600"></AppIcon>
              </div>
              <h4 className="text-sm font-heading font-semibold text-foreground-900">Return to Learner</h4>
            </div>
            <p className="text-[12px] text-foreground-500 mb-3">Explain what {record.learnerName} needs to correct or complete.</p>
            <textarea
              value={returnReason}
              onChange={e => setReturnReason(e.target.value)}
              placeholder="List the corrections needed..."
              maxLength={500}
              rows={4}
              className="w-full px-3 py-2 text-[13px] text-foreground-700 bg-background-50 border border-foreground-200 rounded-lg focus:outline-none focus:border-primary-300/60 focus:ring-1 focus:ring-primary-200/40 resize-none text-sm"
            />
            <p className="text-[10px] text-foreground-400 mt-1">{returnReason.length}/500</p>
            <div className="flex items-center gap-2.5 mt-3">
              <button onClick={handleReturn} disabled={!returnReason.trim()} className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-lg text-[12px] font-medium cursor-pointer whitespace-nowrap transition-smooth disabled:cursor-not-allowed">Return to Learner</button>
              <button onClick={() => { setShowReturnForm(false); setReturnReason(''); }} className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-600 rounded-lg text-[12px] font-medium cursor-pointer whitespace-nowrap transition-smooth">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Evidence Request Form */}
      {showEvidenceForm && (
        <Modal onClose={() => { setShowEvidenceForm(false); setEvidenceItems(''); }}>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                <AppIcon className="ri-file-search-line text-primary-600"></AppIcon>
              </div>
              <h4 className="text-sm font-heading font-semibold text-foreground-900">Request Evidence</h4>
            </div>
            <p className="text-[12px] text-foreground-500 mb-3">List the documents or evidence you need from {record.learnerName}.</p>
            <textarea
              value={evidenceItems}
              onChange={e => setEvidenceItems(e.target.value)}
              placeholder="Specify what evidence is needed..."
              maxLength={500}
              rows={4}
              className="w-full px-3 py-2 text-[13px] text-foreground-700 bg-background-50 border border-foreground-200 rounded-lg focus:outline-none focus:border-primary-300/60 focus:ring-1 focus:ring-primary-200/40 resize-none text-sm"
            />
            <p className="text-[10px] text-foreground-400 mt-1">{evidenceItems.length}/500</p>
            <div className="flex items-center gap-2.5 mt-3">
              <button onClick={handleRequestEvidence} disabled={!evidenceItems.trim()} className="flex-1 px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 text-white rounded-lg text-[12px] font-medium cursor-pointer whitespace-nowrap transition-smooth disabled:cursor-not-allowed">Send Request</button>
              <button onClick={() => { setShowEvidenceForm(false); setEvidenceItems(''); }} className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-600 rounded-lg text-[12px] font-medium cursor-pointer whitespace-nowrap transition-smooth">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add Note Form */}
      {showNoteForm && (
        <Modal onClose={() => { setShowNoteForm(false); setNoteContent(''); }}>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-background-200 flex items-center justify-center">
                <AppIcon className="ri-sticky-note-line text-foreground-500"></AppIcon>
              </div>
              <h4 className="text-sm font-heading font-semibold text-foreground-900">Add Internal Note</h4>
            </div>
            <p className="text-[12px] text-foreground-500 mb-3">This note will be visible to the compliance team.</p>
            <textarea
              value={noteContent}
              onChange={e => setNoteContent(e.target.value)}
              placeholder="Write your note..."
              maxLength={500}
              rows={4}
              className="w-full px-3 py-2 text-[13px] text-foreground-700 bg-background-50 border border-foreground-200 rounded-lg focus:outline-none focus:border-primary-300/60 focus:ring-1 focus:ring-primary-200/40 resize-none text-sm"
            />
            <p className="text-[10px] text-foreground-400 mt-1">{noteContent.length}/500</p>
            <div className="flex items-center gap-2.5 mt-3">
              <button onClick={handleAddNote} disabled={!noteContent.trim()} className="flex-1 px-4 py-2 bg-foreground-600 hover:bg-foreground-700 disabled:bg-foreground-300 text-background-50 rounded-lg text-[12px] font-medium cursor-pointer whitespace-nowrap transition-smooth disabled:cursor-not-allowed">Save Note</button>
              <button onClick={() => { setShowNoteForm(false); setNoteContent(''); }} className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-600 rounded-lg text-[12px] font-medium cursor-pointer whitespace-nowrap transition-smooth">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Escalate Confirmation */}
      {showEscalateConfirm && (
        <Modal onClose={() => { setShowEscalateConfirm(false); setEscalateReason(''); }}>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-secondary-100 flex items-center justify-center">
                <AppIcon className="ri-alert-line text-secondary-600"></AppIcon>
              </div>
              <h4 className="text-sm font-heading font-semibold text-foreground-900">Escalate Case</h4>
            </div>
            <p className="text-[12px] text-foreground-500 mb-3">Escalate {record.learnerName}&apos;s case to senior compliance for urgent review. Provide a reason.</p>
            <textarea
              value={escalateReason}
              onChange={e => setEscalateReason(e.target.value)}
              placeholder="Reason for escalation..."
              maxLength={500}
              rows={3}
              className="w-full px-3 py-2 text-[13px] text-foreground-700 bg-background-50 border border-foreground-200 rounded-lg focus:outline-none focus:border-primary-300/60 focus:ring-1 focus:ring-primary-200/40 resize-none text-sm"
            />
            <p className="text-[10px] text-foreground-400 mt-1">{escalateReason.length}/500</p>
            <div className="flex items-center gap-2.5 mt-3">
              <button onClick={handleEscalate} disabled={!escalateReason.trim()} className="flex-1 px-4 py-2 bg-secondary-500 hover:bg-secondary-600 disabled:bg-secondary-300 text-white rounded-lg text-[12px] font-medium cursor-pointer whitespace-nowrap transition-smooth disabled:cursor-not-allowed">Escalate</button>
              <button onClick={() => { setShowEscalateConfirm(false); setEscalateReason(''); }} className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-600 rounded-lg text-[12px] font-medium cursor-pointer whitespace-nowrap transition-smooth">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Confirmation */}
      {showRejectConfirm && (
        <Modal onClose={() => { setShowRejectConfirm(false); setRejectReason(''); }}>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                <AppIcon className="ri-close-circle-line text-red-600"></AppIcon>
              </div>
              <h4 className="text-sm font-heading font-semibold text-foreground-900">Reject at Enrolment</h4>
            </div>
            <p className="text-[12px] text-foreground-500 mb-1">This will permanently reject <strong className="text-foreground-700">{record.learnerName}</strong> at the enrolment stage. This action cannot be undone.</p>
            <div className="mt-2 p-2.5 bg-red-50 rounded-lg border border-red-200/50 mb-3">
              <p className="text-[11px] text-red-700">The learner and employer will be notified. The case will be archived with the rejection reason.</p>
            </div>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (required)..."
              maxLength={500}
              rows={3}
              className="w-full px-3 py-2 text-[13px] text-foreground-700 bg-background-50 border border-foreground-200 rounded-lg focus:outline-none focus:border-red-300/60 focus:ring-1 focus:ring-red-200/40 resize-none text-sm"
            />
            <p className="text-[10px] text-foreground-400 mt-1">{rejectReason.length}/500</p>
            <div className="flex items-center gap-2.5 mt-3">
              <button onClick={handleReject} disabled={!rejectReason.trim()} className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white rounded-lg text-[12px] font-medium cursor-pointer whitespace-nowrap transition-smooth disabled:cursor-not-allowed">Confirm Rejection</button>
              <button onClick={() => { setShowRejectConfirm(false); setRejectReason(''); }} className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-600 rounded-lg text-[12px] font-medium cursor-pointer whitespace-nowrap transition-smooth">Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground-950/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background-50 rounded-xl shadow-lg border border-background-200/30 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}