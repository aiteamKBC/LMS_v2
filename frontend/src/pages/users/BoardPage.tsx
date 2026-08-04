import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useToast } from '@/hooks/useToast';
import { roleNavMap } from '@/mocks/navigation';
import { fetchEnrolmentBoard, updateEnrolmentUser, finishEnrolment, PROGRAMME_STATUS_OPTIONS } from '@/api/enrolmentUsers';
import { fetchCommercialBoard } from '@/api/commercialUsers';
import { fetchEnrolmentDocuments, getEnrolmentDocumentUrl, uploadEnrolmentDocument, type EnrolmentDocument, type EnrolmentDocType } from '@/api/enrolmentDocuments';
import { fetchReviewDocuments, fetchReviewForm, type ReviewDocument, type ReviewFormResponse } from '@/api/reviewForm';
import SignReviewModal from '@/pages/learner/onboarding/reviews/SignReviewModal';
import { downloadReviewPdf } from '@/pages/learner/onboarding/reviews/reviewDocument';
import { REVIEW_QUESTION_LABELS } from '@/pages/learner/onboarding/reviews/questions';
import type { LearnerKind } from '@/api/extendedIlr';
import type { EnrolmentBoard, FsBlock } from './types';
import { SectionPanel, FieldRow, Table, EmptyState, ActionLink, StatusBadge, FileList, Pagination, Hero, HeroStat, iconBtn, btnSecondary } from './components/ui';

const enrolmentNav = roleNavMap.apprentice;

function Actions({ items }: { items: { label: string; icon?: string; onClick?: () => void }[] }) {
  return <>{items.map((a, i) => <ActionLink key={i} label={a.label} icon={a.icon} onClick={a.onClick} />)}</>;
}

/**
 * Compliance document types, mirroring DOC_TYPES in
 * backend/enrolment_api/documents.py — that registry validates the upload, so a
 * value missing there is rejected on save.
 */
const DOC_TYPE_LABELS: Record<EnrolmentDocType, string> = {
  'extended-ilr': 'Extended ILR',
  'training-plan': 'Training Plan',
  'commitment-statement': 'Commitment Statement',
  'apprenticeship-agreement': 'Apprenticeship Agreement',
  'contract-of-services': 'Contract of Services',
  'initial-assessment': 'Initial Assessment',
  'learning-agreement': 'Learning Agreement',
  'privacy-notice': 'Privacy Notice',
};

/**
 * Download rows as a CSV file.
 *
 * Values are quoted and inner quotes doubled per RFC 4180, and a UTF-8 BOM is
 * prepended so Excel doesn't mangle names with accents.
 */
function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Programme status, set from the page hero.
 *
 * Replaced the separate "Enrolled learners" delivery list, which re-listed the
 * same learners this page already covers. Styled for the hero's dark gradient
 * rather than with the standard light `inputClass`. The pick is held locally
 * until Save, so a mis-click never writes to the learner's record.
 */
function HeroProgrammeStatus({ learnerId, initial }: { learnerId: string; initial: string }) {
  const [val, setVal] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setVal(initial); setSaved(initial); }, [initial]);

  const dirty = val !== saved;

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setErr(null);
    try {
      // One endpoint for both learner kinds — they share one table.
      await updateEnrolmentUser(learnerId, { programmeStatus: val });
      setSaved(val);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-white/60">Programme status</span>
      <div className="flex items-center gap-2">
        <select
          value={val}
          onChange={(e) => setVal(e.target.value)}
          aria-label="Programme status"
          className="px-3 py-2 text-[13px] font-medium bg-white/15 backdrop-blur-sm border border-white/25 rounded-lg text-white outline-none cursor-pointer hover:bg-white/20 focus:border-white/50 transition-smooth max-w-[200px] [&>option]:text-foreground-900 [&>option]:bg-background-50"
        >
          <option value="">— Set status —</option>
          {PROGRAMME_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {dirty && (
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white text-primary-700 rounded-lg text-[12px] font-semibold hover:bg-white/90 transition-smooth cursor-pointer disabled:opacity-60 shrink-0"
          >
            {saving ? <><i className="ri-loader-4-line animate-spin" />Saving…</> : <><i className="ri-save-line" />Save</>}
          </button>
        )}
      </div>
      {err && <span className="text-[11px] text-red-200"><i className="ri-error-warning-line mr-1" />{err}</span>}
    </div>
  );
}

/**
 * Finish enrolment — the one gate out of enrolment."Created_users".
 *
 * Every learner the console creates lives only as an enrolment record. Pressing
 * this promotes them into the live learner tables (same id), sets them Active
 * and starts their journey, so an in-progress enrolment never shows up as a
 * live learner. Confirmed first because it is not a routine status tweak.
 */
function FinishEnrolment({ learnerId, status, onFinished }: { learnerId: string; status: string; onFinished: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Already promoted — the learner is live, so the gate is spent.
  const done = status.trim().toLowerCase() === 'active';

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await finishEnrolment(learnerId);
      setConfirming(false);
      onFinished();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not finish enrolment');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/20 border border-emerald-300/40 text-[12px] font-semibold text-white">
        <i className="ri-check-double-line" />Enrolment complete
      </span>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            onClick={run}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-emerald-500 text-white rounded-xl text-[12px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer disabled:opacity-60 shadow-lg shadow-black/10"
          >
            {busy ? <><i className="ri-loader-4-line animate-spin" />Finishing…</> : <><i className="ri-check-line" />Confirm</>}
          </button>
          <button
            onClick={() => { setConfirming(false); setErr(null); }}
            disabled={busy}
            className="px-3 py-2.5 rounded-xl text-[12px] font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-smooth cursor-pointer disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          title="Move this learner into the live learner tables and set them Active"
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-500 text-white rounded-xl text-[13px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer shadow-lg shadow-black/10"
        >
          <i className="ri-graduation-cap-line" />Finish enrolment
        </button>
      )}
      {confirming && !err && <span className="text-[11px] text-white/70 max-w-[220px]">Starts this learner&apos;s journey and sets them Active.</span>}
      {err && <span className="text-[11px] text-red-200 max-w-[220px]"><i className="ri-error-warning-line mr-1" />{err}</span>}
    </div>
  );
}

function FunctionalSkill({ subject, block }: { subject: string; block: FsBlock }) {
  const [exempt, setExempt] = useState(block.exempt);
  return (
    <div className="border border-foreground-100 rounded-lg p-3">
      <p className="text-[12px] font-semibold text-foreground-800 mb-2">{subject} Assessments</p>
      {block.assessments.length === 0 ? <EmptyState text={`No ${subject} assessment records yet`} /> : (
        <ul className="text-[12px] text-foreground-700 space-y-1">{block.assessments.map((a) => <li key={a.id}>{a.name} — {a.level} ({a.date})</li>)}</ul>
      )}
      <div className="mt-3 pt-3 border-t border-foreground-100">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-medium text-foreground-700">{subject} Exemption from Functional Skills</span>
          <button onClick={() => setExempt((e) => !e)} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border cursor-pointer transition-smooth ${exempt ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50' : 'bg-background-100 text-foreground-500 border-foreground-200/60'}`}>{exempt ? 'Exempt' : 'Not Exempt'}</button>
        </div>
        <p className="text-[11px] text-foreground-400 mb-1">Exemption evidence</p>
        <FileList files={block.evidence.map((d) => ({ id: d.id, name: d.fileName ?? d.description, url: d.url }))} onDelete={() => {}} onAdd={() => {}} emptyText="No evidence" addLabel="Add file" />
      </div>
    </div>
  );
}

/**
 * Generated compliance paperwork for this learner (Extended ILR today, the other
 * seven document types as they are built). Rows come from
 * enrolment."Enrolment_Documents"; opening one mints a short-lived SAS URL so the
 * Azure container itself stays private.
 */
function ComplianceDocuments({ kind, learnerId, programme }: { kind: LearnerKind; learnerId: string; programme: string }) {
  const [docs, setDocs] = useState<EnrolmentDocument[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEnrolmentDocuments(kind, learnerId)
      .then((r) => !cancelled && setDocs(r))
      .catch((e: Error) => !cancelled && setErr(e.message));
    return () => { cancelled = true; };
  }, [kind, learnerId]);

  const open = async (id: string) => {
    setOpening(id);
    try {
      window.open(await getEnrolmentDocumentUrl(kind, learnerId, id), '_blank', 'noopener');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not open the document');
    } finally {
      setOpening(null);
    }
  };

  return (
    <>
      <p className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider mb-2">{programme || 'Programme Name'}</p>
      {err && <p className="text-[12px] text-red-600 mb-2"><i className="ri-error-warning-line mr-1" />{err}</p>}
      {docs === null && !err && <p className="text-[12px] text-foreground-400 py-2"><i className="ri-loader-4-line animate-spin mr-1.5" />Loading documents…</p>}
      {docs !== null && docs.length === 0 && <EmptyState text="No documents" />}
      {docs !== null && docs.length > 0 && (
        <div className="divide-y divide-foreground-100 border border-foreground-100 rounded-lg">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-[12px] text-foreground-700 inline-flex items-center gap-1.5 min-w-0">
                <i className="ri-file-pdf-line text-red-500 shrink-0" />
                <span className="truncate">{d.docLabel}</span>
                {d.signed && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/50 px-2 py-0.5 rounded-full shrink-0">signed</span>}
              </span>
              <span className="flex items-center gap-3 shrink-0">
                <span className="text-[11px] text-foreground-400">{d.generatedAt ? new Date(d.generatedAt).toLocaleString('en-GB') : ''}</span>
                <ActionLink label={opening === d.id ? 'Opening…' : 'View'} icon="ri-external-link-line" onClick={() => open(d.id)} />
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Reviews the learner has started or finished, from
 * enrolment."Enrolment_Reviews". A merely-booked review is not listed: there is
 * no document until someone opens the form.
 *
 * "Open" goes to the same form the learner uses — staff and learner share it.
 */
function ReviewDocuments({ kind, learnerId, programme }: { kind: LearnerKind; learnerId: string; programme: string }) {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<ReviewDocument[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // Signing and exporting both need the full review (signature images, answers),
  // which the list omits — so it is fetched for the row being acted on.
  const [signing, setSigning] = useState<ReviewFormResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchReviewDocuments(kind, learnerId)
      .then((r) => !cancelled && setDocs(r.documents))
      .catch((e: Error) => !cancelled && setErr(e.message));
    return () => { cancelled = true; };
  }, [kind, learnerId, reload]);

  const withReview = async (eventKey: string, action: (r: ReviewFormResponse) => void) => {
    setBusy(eventKey);
    setErr(null);
    try {
      action(await fetchReviewForm(kind, learnerId, eventKey));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not open the review.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <p className="text-[11px] font-semibold text-foreground-500 uppercase tracking-wider mb-2">{programme || 'Programme Name'}</p>
      {err && <p className="text-[12px] text-red-600 mb-2"><i className="ri-error-warning-line mr-1" />{err}</p>}
      {docs === null && !err && <p className="text-[12px] text-foreground-400 py-2"><i className="ri-loader-4-line animate-spin mr-1.5" />Loading reviews…</p>}
      {docs !== null && docs.length === 0 && <EmptyState text="No reviews started yet" />}
      {docs !== null && docs.length > 0 && (
        <div className="divide-y divide-foreground-100 border border-foreground-100 rounded-lg">
          {docs.map((d) => (
            <div key={d.eventKey} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-[12px] text-foreground-700 inline-flex items-center gap-1.5 min-w-0">
                <i className="ri-file-list-3-line text-foreground-400 shrink-0" />
                <span className="truncate">
                  {d.label}{d.scheduledDate ? ` — ${d.scheduledDate}` : ''}
                </span>
                {d.completed ? (
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/50 px-2 py-0.5 rounded-full shrink-0">completed</span>
                ) : (
                  <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200/50 px-2 py-0.5 rounded-full shrink-0">
                    in progress {d.sectionsDone}/{d.sectionsTotal}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-3 shrink-0">
                {d.signatures.learner.signed && (
                  <span className="text-[10px] text-emerald-700" title="Learner signed"><i className="ri-user-line" /> signed</span>
                )}
                {d.reviewedBy && <span className="text-[11px] text-foreground-400 hidden lg:inline">{d.reviewedBy}</span>}
                {/* Sign-off and export are only meaningful on a finished review. */}
                {d.completed && (
                  <>
                    <ActionLink
                      label={busy === d.eventKey ? 'Opening…' : d.signatures.admin.signed ? 'Signed' : 'Sign'}
                      icon={d.signatures.admin.signed ? 'ri-check-line' : 'ri-pen-nib-line'}
                      onClick={() => withReview(d.eventKey, setSigning)}
                    />
                    <ActionLink
                      label="PDF"
                      icon="ri-file-pdf-line"
                      onClick={() => withReview(d.eventKey, (r) => downloadReviewPdf(r, REVIEW_QUESTION_LABELS))}
                    />
                  </>
                )}
                <ActionLink
                  label={d.completed ? 'View' : 'Continue'}
                  icon="ri-external-link-line"
                  onClick={() => navigate(`/learner/onboarding/reviews/${encodeURIComponent(d.eventKey)}`)}
                />
              </span>
            </div>
          ))}
        </div>
      )}

      {signing && (
        <SignReviewModal
          kind={kind}
          learnerId={learnerId}
          eventKey={signing.eventKey}
          party="admin"
          defaultName={signing.reviewedBy}
          signatures={signing.signatures}
          onClose={() => setSigning(null)}
          onSigned={() => setReload((n) => n + 1)}
        />
      )}
    </>
  );
}

export default function BoardPage() {
  const { userId = '' } = useParams();
  const [search] = useSearchParams();
  // Ids overlap between the two learner tables, so the row's source travels
  // in the URL and decides which record this board reads.
  const isCommercial = search.get('source') === 'commercial';
  const suffix = isCommercial ? '?source=commercial' : '';
  const [board, setBoard] = useState<EnrolmentBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    (isCommercial ? fetchCommercialBoard(userId) : fetchEnrolmentBoard(userId))
      .then(setBoard)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [userId, isCommercial]);

  if (loading || error || !board) {
    return (
      <WorkspaceShell role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel} pageTitle="Enrolment Details" pageSubtitle="" userName="Enrolment Officer" userRole="Enrolment Officer">
        <div className="p-6 max-w-5xl mx-auto">
          {loading && <div className="py-20 text-center text-[13px] text-foreground-400"><i className="ri-loader-4-line animate-spin mr-2" />Loading profile…</div>}
          {!loading && error && (
            <div className="py-20 text-center text-[13px]">
              <p className="text-red-600 mb-3"><i className="ri-error-warning-line mr-1.5" />{error}</p>
              <button className={btnSecondary} onClick={load}><i className="ri-refresh-line" />Retry</button>
            </div>
          )}
        </div>
      </WorkspaceShell>
    );
  }

  return <BoardView board={board} onReload={load} />;
}

function BoardView({ board, onReload }: { board: EnrolmentBoard; onReload: () => void }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { info, success, error } = useToast();
  const userId = board.user.id;
  const [contactPage, setContactPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  // Activities panel filters, applied to the rows already on the board.
  const [activityQuery, setActivityQuery] = useState('');
  const [activityStatus, setActivityStatus] = useState('');
  const activityStatuses = Array.from(new Set(board.activities.map((a) => a.timeAndStatus).filter(Boolean))).sort();
  const shownActivities = board.activities.filter((a) => {
    if (activityStatus && a.timeAndStatus !== activityStatus) return false;
    if (!activityQuery) return true;
    const q = activityQuery.toLowerCase();
    return `${a.event} ${a.date} ${a.timeAndStatus}`.toLowerCase().includes(q);
  });

  const CONTACTS_PER_PAGE = 5;
  const contactPages = Math.max(1, Math.ceil(board.contacts.length / CONTACTS_PER_PAGE));
  const contactRows = board.contacts.slice((contactPage - 1) * CONTACTS_PER_PAGE, contactPage * CONTACTS_PER_PAGE);
  // Carry the learner's source through to the wizard — ids overlap across tables.
  const isCommercial = search.get('source') === 'commercial';
  const kind: LearnerKind = isCommercial ? 'commercial' : 'apprenticeship';
  const suffix = isCommercial ? '?source=commercial' : '';
  const showWizard = () => navigate(`/users/${userId}/wizard${suffix}`);

  /**
   * Several panels are read-only views of data captured elsewhere (notes and
   * activities come from the onboarding wizard, competencies from the skills
   * radar). Their "add" links come from the Aptem screen this page mirrors, but
   * there is no create endpoint behind them yet — so they say where the data
   * actually comes from rather than silently doing nothing when clicked.
   */
  const notWritable = (what: string, where: string) =>
    info(`${what} can't be added here yet`, `This panel is read-only — ${where}`);

  /**
   * Upload a signed compliance document.
   *
   * The store behind this is the compliance-document container, which is keyed
   * to a fixed doc-type registry and accepts PDFs only — it isn't a general
   * file drop. So the picker asks which document this is, and the accept
   * attribute matches what the backend will actually take.
   */
  const [uploadType, setUploadType] = useState<EnrolmentDocType>('extended-ilr');

  /**
   * Withdraw the learner from their programme.
   *
   * Destructive and outward-facing (it changes what the learner sees on their
   * own landing page), so it confirms first and names the learner — this link
   * sits next to read-only fields and is easy to hit by accident.
   */
  const [cancelling, setCancelling] = useState(false);
  const cancelUser = async () => {
    if (cancelling) return;
    const ok = window.confirm(
      `Withdraw ${board.user.name} from ${board.programme.name || 'their programme'}?\n\n` +
      'Their programme status becomes "Withdrawn". You can set it back from the status picker at the top of this page.',
    );
    if (!ok) return;
    setCancelling(true);
    try {
      await updateEnrolmentUser(userId, { programmeStatus: 'Withdrawn' });
      success('Learner withdrawn', `${board.user.name} is now Withdrawn.`);
      onReload();
    } catch (e) {
      error('Could not withdraw learner', e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setCancelling(false);
    }
  };

  const onUploadPicked = async (file?: File) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      error('PDFs only', 'The compliance document store accepts PDF files.');
      return;
    }
    setUploading(true);
    try {
      await uploadEnrolmentDocument(kind, userId, uploadType, file, file.name, {
        signed: true,
        learnerName: board.user.name,
      });
      success('Document uploaded', `${file.name} was filed as ${DOC_TYPE_LABELS[uploadType]}.`);
      onReload();
    } catch (e) {
      error('Upload failed', e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <WorkspaceShell role="compliance" roleLabel={enrolmentNav.label} navItems={enrolmentNav.items} workspaceLabel={enrolmentNav.workspaceLabel} pageTitle="Enrolment Details" pageSubtitle={board.user.name} userName="Enrolment Officer" userRole="Enrolment Officer">
      <div className="p-6 max-w-5xl mx-auto">
        {/* Hero */}
        <div className="animate-fade-in-up mb-6">
          <Hero
            icon="ri-user-3-line"
            title={board.user.reference ? `${board.user.name} · ${board.user.reference}` : board.user.name}
            subtitle={<>Owner: {board.user.owner || '—'}{board.programme.name ? ` · ${board.programme.name}` : ''}</>}
            right={
              <>
                <HeroProgrammeStatus learnerId={userId} initial={board.programme.status || ''} />
                <HeroStat value={board.programme.onboardingStatus} label="Onboarding" />
                <button onClick={showWizard} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white text-primary-700 rounded-xl text-[13px] font-semibold hover:bg-white/90 transition-smooth cursor-pointer shadow-lg shadow-black/10">
                  <i className="ri-magic-line" />Show Wizard
                </button>
                <FinishEnrolment learnerId={userId} status={board.programme.status || ''} onFinished={onReload} />
              </>
            }
          />
        </div>

        <div className="space-y-4 stagger-children">
          {/* 3.1 Contact details */}
          <SectionPanel title="Contact details" icon="ri-contacts-line" actions={<Actions items={[
            { label: 'view profile in console', onClick: () => navigate(`/workspace/learner/${kind}/${userId}`) },
            { label: 'communication report', onClick: () => navigate('/admin/reports') },
            { label: 'edit users details', onClick: showWizard },
          ]} />}>
            <FieldRow readonly label="User email address" value={board.contact.email} />
            <FieldRow readonly label="Phone number" value={board.contact.phone} />
            <FieldRow readonly label="Date of birth" value={board.contact.dob} />
            <FieldRow readonly label="Group membership of user" value={board.contact.groupMembership} />
            <FieldRow readonly label="Signature (no mandate)" value={
              <div className="flex items-center gap-3 flex-wrap">
                {board.contact.signatureUrl ? <img src={board.contact.signatureUrl} alt="Signature" className="h-12 border border-foreground-100 rounded" /> : <span className="text-foreground-300 italic">No signature</span>}
                {/* A direct-debit mandate is a finance document: it has no
                    generator and no entry in the compliance doc-type registry,
                    so neither of these can be honestly wired to the document
                    store without mislabelling the record it creates. */}
                <ActionLink label="prepare mandate" onClick={() => notWritable('A mandate', 'there is no mandate template yet. The learner’s signature is captured in the enrolment wizard.')} />
                <ActionLink label="upload signed mandate" onClick={() => notWritable('A mandate', 'the document store has no mandate type yet — use Documents › upload for compliance paperwork.')} />
              </div>
            } />
          </SectionPanel>

          {/* 3.2 Activity Summary */}
          <SectionPanel title="Activity Summary (last 30 days)" icon="ri-pulse-line" actions={<Actions items={[
            { label: 'usage report', onClick: () => navigate('/admin/reports') },
            { label: 'view activity list', onClick: () => navigate(`/workspace/learner/${kind}/${userId}`) },
            { label: 'view user tasks', onClick: () => navigate(`/learner/training-plan/${kind}/${userId}`) },
          ]} />}>
            <FieldRow readonly label="Aptem usage" value={board.activity.aptemUsage} />
            <FieldRow readonly label="Number of days till next reporting period" value={String(board.activity.daysTillNextReporting)} />
            <FieldRow readonly label="Date last logged in" value={board.activity.lastLoggedIn} />
            <FieldRow readonly label="Number of logins" value={String(board.activity.logins)} />
            <FieldRow readonly label="Number of new tasks added by user" value={String(board.activity.tasksAddedByUser)} />
            <FieldRow readonly label="Number of uncompleted tasks" value={<span className="inline-flex items-center gap-2">{board.activity.uncompletedTasks}<ActionLink label="add new task" onClick={() => notWritable('Tasks', 'learner tasks come from the training plan — use “build training plan”.')} /></span>} />
            <FieldRow readonly label="Number of advice items accessed" value={String(board.activity.adviceItemsAccessed)} />
            <FieldRow readonly label="Date advice centre last accessed" value={board.activity.adviceLastAccessed} />
            <FieldRow readonly label="Action plans" value={board.activity.actionPlans} />
          </SectionPanel>

          {/* 3.3 Programme */}
          {/* "build training plan" carried over from the retired delivery list,
              which was the only route into the builder. */}
          <SectionPanel title="Programme" icon="ri-graduation-cap-line" actions={<Actions items={[{ label: 'build training plan', icon: 'ri-tools-line', onClick: () => navigate(`/training-plan/${isCommercial ? 'commercial' : 'apprenticeship'}/${userId}`) }, { label: 'show wizard', onClick: showWizard }, { label: 'stop', onClick: cancelUser }]} />}>
            <div className="border border-foreground-100 rounded-lg p-3 mb-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[12px] font-semibold text-foreground-800">Programme Details</p>
                {/* Programme and cohort are chosen in the wizard; the dates come
                    from the cohort record, not from this page. */}
                <button className={iconBtn} aria-label="Edit programme" onClick={showWizard}><i className="ri-pencil-line text-sm" /></button>
              </div>
              <FieldRow readonly label="Programme Type" value={board.programme.type} />
              <FieldRow readonly label="Programme" value={board.programme.name} />
              <FieldRow readonly label="Cohort" value={board.programme.cohort} />
              <FieldRow readonly label="Start date" value={board.programme.startDate} />
              <FieldRow readonly label="End date" value={board.programme.endDate} />
              <FieldRow readonly label="Enrolled" value={`${board.programme.enrolledAt} by ${board.programme.enrolledBy}`} />
            </div>
            <div className="border border-foreground-100 rounded-lg p-3">
              <p className="text-[12px] font-semibold text-foreground-800 mb-1">Onboarding</p>
              <FieldRow readonly label="Onboarding status" value={<StatusBadge status={board.programme.onboardingStatus} />} />
              <FieldRow readonly label="Onboarding completed" value={board.programme.onboardingCompletedAt} />
            </div>
          </SectionPanel>

          {/* 3.4 Sub-programme */}
          <SectionPanel title="Sub-programme" icon="ri-node-tree">
            <Table headers={['Sub-programme', 'Start Date', 'End Date']}>
              {board.subProgrammes.map((s, i) => (
                <tr key={i} className="border-b border-foreground-100 last:border-0">
                  <td className="py-2 px-3 text-foreground-700">{s.name}</td><td className="py-2 px-3 text-foreground-600 whitespace-nowrap">{s.startDate}</td><td className="py-2 px-3 text-foreground-600 whitespace-nowrap">{s.endDate}</td>
                </tr>
              ))}
            </Table>
          </SectionPanel>

          {/* 3.5 Aims / Qualifications */}
          <SectionPanel title="Aims / Qualifications" icon="ri-award-line">
            <Table headers={['Aim ref number', 'Qualification', 'Start Date', 'End Date', 'Exempt?']}>
              {board.aims.map((a, i) => (
                <tr key={i} className="border-b border-foreground-100 last:border-0">
                  <td className="py-2 px-3 text-foreground-700">{a.aimRef}</td><td className="py-2 px-3 text-foreground-700">{a.qualification}</td><td className="py-2 px-3 text-foreground-600 whitespace-nowrap">{a.startDate}</td><td className="py-2 px-3 text-foreground-600 whitespace-nowrap">{a.endDate}</td><td className="py-2 px-3 text-foreground-600">{a.exempt ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </Table>
            <p className="text-[12px] font-semibold text-foreground-500 mt-3 mb-1">Previous programmes:</p>
            {board.previousProgrammes.length === 0 ? <EmptyState text="No previous programmes" /> : <ul className="text-[12px] text-foreground-700 list-disc pl-5">{board.previousProgrammes.map((p, i) => <li key={i}>{p}</li>)}</ul>}
          </SectionPanel>

          {/* 3.6 Functional Skills */}
          <SectionPanel title="Functional Skills" icon="ri-calculator-line">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <FunctionalSkill subject="English" block={board.functionalSkills.english} />
              <FunctionalSkill subject="Maths" block={board.functionalSkills.maths} />
              <FunctionalSkill subject="ICT" block={board.functionalSkills.ict} />
            </div>
          </SectionPanel>

          {/* 3.7 Managed jobs */}
          <SectionPanel title="Managed jobs and placements/workshops" icon="ri-briefcase-line" actions={<Actions items={[
            { label: 'application report', onClick: () => navigate('/admin/reports') },
            { label: 'matching', onClick: () => notWritable('Vacancy matching', 'this learner’s placement comes from their onboarding employer details.') },
          ]} />}>
            <Table headers={['Employer', 'Title', 'Categories', 'From', 'To', 'Planned/Logged', 'Status', 'Date', 'Notes', 'Actions']}>
              {board.managedJobs.map((j) => (
                <tr key={j.id} className="border-b border-foreground-100 last:border-0">
                  <td className="py-2 px-3 text-foreground-700">{j.employer}</td><td className="py-2 px-3 text-foreground-700">{j.title}</td><td className="py-2 px-3 text-foreground-600">{j.categories}</td><td className="py-2 px-3 text-foreground-600 whitespace-nowrap">{j.availableFrom}</td><td className="py-2 px-3 text-foreground-600 whitespace-nowrap">{j.availableTo}</td><td className="py-2 px-3 text-foreground-600 whitespace-nowrap">{j.hoursPlanned} / {j.hoursLogged}</td><td className="py-2 px-3"><StatusBadge status={j.status} /></td><td className="py-2 px-3 text-foreground-600 whitespace-nowrap">{j.date}</td><td className="py-2 px-3 text-foreground-600">{j.comments}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <ActionLink label="Edit" onClick={() => notWritable('Placements', 'the employer details are captured in the enrolment wizard’s Extended ILR step.')} />
                    <span className="mx-1 text-foreground-200">·</span>
                    <ActionLink label={j.canUnverify ? 'Unverify' : 'Delete'} onClick={() => notWritable('Placements', 'the employer details are captured in the enrolment wizard’s Extended ILR step.')} />
                  </td>
                </tr>
              ))}
            </Table>
          </SectionPanel>

          {/* 3.8 Tracker */}
          <SectionPanel title="Tracker" icon="ri-map-pin-line" actions={<ActionLink label="add" icon="ri-add-line" onClick={() => notWritable('Tracker items', 'these are derived from the learner’s onboarding progress.')} />}>
            {board.tracker.length === 0 ? <EmptyState text="No tracker items" /> : (
              <Table headers={['Type', 'Status', 'Programme', 'Descripton', 'Documents', 'Edit', 'Print']}>{board.tracker.map((t) => <tr key={t.id} className="border-b border-foreground-100 last:border-0"><td className="py-2 px-3">{t.type}</td><td className="py-2 px-3">{t.status}</td><td className="py-2 px-3">{t.programme}</td><td className="py-2 px-3">{t.description}</td><td className="py-2 px-3">{t.documents}</td><td className="py-2 px-3" /><td className="py-2 px-3" /></tr>)}</Table>
            )}
          </SectionPanel>

          {/* 3.9 Milestones */}
          <SectionPanel title="Milestones" icon="ri-flag-line" actions={<ActionLink label="add" icon="ri-add-line" onClick={() => notWritable('Milestones', 'there is no milestone store yet — programme dates come from the cohort.')} />}>
            {board.milestones.length === 0 ? <EmptyState text="No milestones" /> : (
              <Table headers={['Programme', 'Description', 'Date', 'Emp Wks left', 'Alw Wks left', 'Status', 'Claimed', 'Edit']}>{board.milestones.map((m) => <tr key={m.id} className="border-b border-foreground-100 last:border-0"><td className="py-2 px-3">{m.programme}</td><td className="py-2 px-3">{m.description}</td><td className="py-2 px-3">{m.date}</td><td className="py-2 px-3">{m.empWksLeft}</td><td className="py-2 px-3">{m.alwWksLeft}</td><td className="py-2 px-3">{m.status}</td><td className="py-2 px-3">{m.claimed}</td><td className="py-2 px-3" /></tr>)}</Table>
            )}
          </SectionPanel>

          {/* 3.10 Notes */}
          <SectionPanel title="Notes" icon="ri-sticky-note-line" actions={<ActionLink label="add new note" icon="ri-add-line" onClick={() => notWritable('Notes', 'these are the learner’s own written answers from the enrolment wizard.')} />}>
            {board.notes.length === 0 ? <EmptyState text="No notes" /> : (
              <Table headers={['text', 'administrator', 'date time']}>{board.notes.map((n) => <tr key={n.id} className="border-b border-foreground-100 last:border-0"><td className="py-2 px-3">{n.text}</td><td className="py-2 px-3">{n.administrator}</td><td className="py-2 px-3">{n.dateTime}</td></tr>)}</Table>
            )}
          </SectionPanel>

          {/* 3.11 Course progress */}
          <SectionPanel title="Course progress" icon="ri-book-open-line" actions={<ActionLink label="start course" icon="ri-play-line" onClick={() => navigate(`/learner/modules/${kind}/${userId}`)} />}>
            {board.courseProgress.length === 0 ? <EmptyState text="No courses" /> : (
              <Table headers={['Is locked', 'Course name', 'Completed steps / %', 'Status']}>{board.courseProgress.map((c) => <tr key={c.id} className="border-b border-foreground-100 last:border-0"><td className="py-2 px-3">{c.isLocked ? 'Yes' : 'No'}</td><td className="py-2 px-3">{c.courseName}</td><td className="py-2 px-3">{c.progress}</td><td className="py-2 px-3">{c.status}</td></tr>)}</Table>
            )}
          </SectionPanel>

          {/* 3.12 Contacts */}
          <SectionPanel title="Contacts" icon="ri-team-line" actions={<ActionLink label="add contact" icon="ri-add-line" onClick={() => notWritable('Contacts', 'next of kin and line manager are captured in the enrolment wizard’s Extended ILR step.')} />}>
            <Table headers={['Name', 'Type', 'Phone', 'Email', 'Role', 'Notes', 'Edit', 'Delete']}>
              {contactRows.map((c) => (
                <tr key={c.id} className="border-b border-foreground-100 last:border-0">
                  {/* A contact has no profile page of its own, so the name opens
                      a mail draft — an href="#" just jumped to the top of the page. */}
                  <td className="py-2 px-3">{c.email ? <a href={`mailto:${c.email}`} className="text-primary-600 hover:underline">{c.name}</a> : <span className="text-foreground-700">{c.name}</span>}</td><td className="py-2 px-3 text-foreground-600">{c.type}</td><td className="py-2 px-3 text-foreground-600">{c.phone || '—'}</td><td className="py-2 px-3 text-foreground-600">{c.email}</td><td className="py-2 px-3 text-foreground-600">{c.role || '—'}</td><td className="py-2 px-3 text-foreground-600">{c.notes || '—'}</td>
                  <td className="py-2 px-3"><button className={iconBtn} aria-label="Edit contact" onClick={() => notWritable('Contacts', 'next of kin and line manager are captured in the enrolment wizard’s Extended ILR step.')}><i className="ri-pencil-line text-sm" /></button></td><td className="py-2 px-3"><button className={iconBtn} aria-label="Delete contact" onClick={() => notWritable('Contacts', 'next of kin and line manager are captured in the enrolment wizard’s Extended ILR step.')}><i className="ri-delete-bin-line text-sm" /></button></td>
                </tr>
              ))}
            </Table>
            <div className="border-t border-foreground-100 mt-2"><Pagination page={contactPage} totalPages={contactPages} onChange={setContactPage} /></div>
          </SectionPanel>

          {/* 3.13 Activities */}
          <SectionPanel title="Activities" icon="ri-calendar-event-line" actions={<Actions items={[
            {
              label: 'export',
              icon: 'ri-download-line',
              onClick: () => {
                if (board.activities.length === 0) { info('Nothing to export', 'This learner has no recorded activity yet.'); return; }
                downloadCsv(
                  `activities-${board.user.name.replace(/\s+/g, '-').toLowerCase()}.csv`,
                  ['Date', 'Time and status', 'Event'],
                  board.activities.map((a) => [a.date, a.timeAndStatus, a.event]),
                );
              },
            },
            { label: 'add activity', icon: 'ri-add-line', onClick: () => notWritable('Activities', 'this is a timeline of what the learner did during onboarding.') },
          ]} />}>
            {/* Filters live, over the rows already loaded. The Day/Week/Month
                calendar controls and the fixed date range that used to sit here
                were removed rather than wired: there is no calendar view behind
                this panel, and a hardcoded range reads as a real filter. */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input
                value={activityQuery}
                onChange={(e) => setActivityQuery(e.target.value)}
                placeholder="Search activities…"
                className="px-3 py-1.5 text-[12px] bg-background-50 border border-foreground-200 rounded-lg outline-none focus:border-primary-400 w-48"
              />
              <select
                value={activityStatus}
                onChange={(e) => setActivityStatus(e.target.value)}
                className="px-3 py-1.5 text-[12px] bg-background-50 border border-foreground-200 rounded-lg outline-none focus:border-primary-400 cursor-pointer"
              >
                <option value="">All types</option>
                {activityStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {(activityQuery || activityStatus) && (
                <button className="px-3 py-1.5 text-[12px] bg-background-100 text-foreground-600 rounded-lg cursor-pointer" onClick={() => { setActivityQuery(''); setActivityStatus(''); }}>
                  Reset
                </button>
              )}
              <span className="text-[11px] text-foreground-400">
                {shownActivities.length} of {board.activities.length}
              </span>
            </div>
            {board.activities.length === 0 ? <EmptyState text="No activities" /> : shownActivities.length === 0 ? <EmptyState text="No activities match your filters" /> : <Table headers={['Date', 'Time and status', 'Event']}>{shownActivities.map((a) => <tr key={a.id} className="border-b border-foreground-100 last:border-0"><td className="py-2 px-3">{a.date}</td><td className="py-2 px-3">{a.timeAndStatus}</td><td className="py-2 px-3">{a.event}</td></tr>)}</Table>}
          </SectionPanel>

          {/* 3.14 Compliance documents */}
          <SectionPanel title="Compliance documents" icon="ri-shield-check-line">
            <ComplianceDocuments kind={isCommercial ? 'commercial' : 'apprenticeship'} learnerId={userId} programme={board.programme.name} />
          </SectionPanel>

          {/* 3.15 Review documents — the learner's started/finished enrolment
              reviews, replacing the placeholder list this panel used to render. */}
          <SectionPanel title="Review documents" icon="ri-file-list-3-line">
            <ReviewDocuments kind={isCommercial ? 'commercial' : 'apprenticeship'} learnerId={userId} programme={board.programme.name} />
          </SectionPanel>

          {/* 3.16 Documents */}
          <SectionPanel
            title="Documents"
            icon="ri-folder-line"
            actions={<ActionLink label={uploading ? 'uploading…' : 'upload'} icon={uploading ? 'ri-loader-4-line' : 'ri-upload-2-line'} onClick={() => uploadRef.current?.click()} />}
          >
            {/* The store is keyed to a doc-type registry, so the type is chosen
                before picking the file rather than guessed from its name. */}
            <div className="flex flex-wrap items-end gap-2 mb-3">
              <label className="text-[11px] uppercase tracking-wider font-medium text-foreground-500">
                File as
                <select
                  value={uploadType}
                  onChange={(e) => setUploadType(e.target.value as EnrolmentDocType)}
                  className="block mt-1 px-3 py-1.5 text-[12px] bg-background-50 border border-foreground-200 rounded-lg outline-none focus:border-primary-400 cursor-pointer normal-case tracking-normal"
                >
                  {(Object.keys(DOC_TYPE_LABELS) as EnrolmentDocType[]).map((t) => (
                    <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </label>
              <button className={btnSecondary} onClick={() => uploadRef.current?.click()} disabled={uploading}>
                {uploading ? <><i className="ri-loader-4-line animate-spin" />Uploading…</> : <><i className="ri-upload-2-line" />Choose PDF</>}
              </button>
              <input
                ref={uploadRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  void onUploadPicked(e.target.files?.[0]);
                  // Reset so re-picking the same file fires change again.
                  e.target.value = '';
                }}
              />
            </div>
            {board.documents.length === 0 ? <EmptyState text="No documents" /> : <Table headers={['Uploaded', 'Description', 'Edit', 'Delete']}>{board.documents.map((d) => <tr key={d.id} className="border-b border-foreground-100 last:border-0"><td className="py-2 px-3">{d.uploaded}</td><td className="py-2 px-3">{d.description}</td><td className="py-2 px-3" /><td className="py-2 px-3" /></tr>)}</Table>}
          </SectionPanel>

          {/* 3.17 Competencies */}
          <SectionPanel
            title="Competencies"
            icon="ri-medal-line"
            actions={<Actions items={[
              {
                label: 'export',
                icon: 'ri-download-line',
                onClick: () => {
                  if (board.competencies.length === 0) { info('Nothing to export', 'This learner has no skills-radar ratings yet.'); return; }
                  downloadCsv(
                    `competencies-${board.user.name.replace(/\s+/g, '-').toLowerCase()}.csv`,
                    ['KSB', 'Self-assessed level'],
                    board.competencies.map((c) => [c.name, c.version]),
                  );
                },
              },
              { label: 'add competency', icon: 'ri-add-line', onClick: () => notWritable('Competencies', 'these are the learner’s skills-radar self-assessment from onboarding.') },
            ]} />}
          >
            <div className="divide-y divide-foreground-100 border border-foreground-100 rounded-lg">
              {board.competencies.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  {/* The rating comes from the wizard's Skills Radar step, which
                      is where it can actually be reviewed and changed. */}
                  <button onClick={() => navigate(`/users/${userId}/wizard/skills-radar${suffix}`)} className="text-[12px] text-primary-600 hover:underline cursor-pointer text-left">
                    {c.name} [{c.version}]
                  </button>
                  <span className="flex items-center gap-2 shrink-0">
                    <ActionLink label="Skills radar" onClick={() => navigate(`/users/${userId}/wizard/skills-radar${suffix}`)} />
                  </span>
                </div>
              ))}
            </div>
          </SectionPanel>

          {/* 3.18 Subscription details */}
          <SectionPanel title="Subscription details" icon="ri-vip-crown-line" actions={<ActionLink label="cancel user" icon="ri-close-circle-line" onClick={cancelUser} />}>
            <FieldRow readonly label="Subscription start date" value={board.subscription.startDate} />
            <FieldRow readonly label="Subscription end date" value={board.subscription.endDate} />
            <FieldRow readonly label="Subscription status" value={board.subscription.status} />
          </SectionPanel>

          {/* 3.19 Audit trail */}
          <SectionPanel title="Audit trail" icon="ri-history-line" defaultOpen={false}>
            <Table headers={['Date', 'Admin', 'Action', 'Changes']}>
              {board.auditTrail.map((e) => (
                <tr key={e.id} className="border-b border-foreground-100 last:border-0 align-top">
                  <td className="py-2 px-3 text-foreground-600 whitespace-nowrap">{e.date}</td><td className="py-2 px-3 text-foreground-600">{e.admin}</td><td className="py-2 px-3 text-foreground-700">{e.action}</td>
                  <td className="py-2 px-3">
                    <div className="divide-y divide-foreground-100 border border-foreground-100 rounded-lg overflow-hidden">{e.changes.map((c, i) => <div key={i} className="grid grid-cols-2 gap-2 px-2 py-1 text-[11px]"><span className="text-foreground-500">{c.property}</span><span className="text-foreground-800">{c.value}</span></div>)}</div>
                  </td>
                </tr>
              ))}
            </Table>
          </SectionPanel>
        </div>
      </div>
    </WorkspaceShell>
  );
}
