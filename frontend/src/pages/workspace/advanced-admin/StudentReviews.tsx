import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Check, Clock3, FileText } from 'lucide-react';
import { advancedAdminReviewPdfSignatures, type AdvancedAdminCoachingSession, type AdvancedAdminLearner, type AdvancedAdminReview } from '@/api/advancedAdmin';
import { matchCoachingSessions } from './coachingMatch';
import ReviewDetailModal from './ReviewDetailModal';

type Family = 'pr' | 'mcm';
type Reviews = Record<Family, AdvancedAdminReview[]>;

function reviewDate(value: string | null) {
  if (!value) return 'Date not recorded';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'Date not recorded' : new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

type PdfSignatures = {
  status: 'loading' | 'ready' | 'error';
  signatures?: Record<'coach' | 'student' | 'manager', boolean | null>;
};

function ProgressSignatureCells({ result, reviewType }: { result: PdfSignatures; reviewType: string }) {
  return <>{(['coach', 'student', 'manager'] as const).map(role => {
    const signed = result.signatures?.[role];
    return <td key={role} className="border-t border-foreground-100 px-3 py-3">
      {result.status === 'loading' ? <span className="text-foreground-500">Checking PDF…</span>
        : result.status === 'error' ? <span className="text-foreground-500">PDF unavailable</span>
          : signed === true ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><Check size={15} /> Signed</span>
            : signed === false ? <span className="inline-flex items-center gap-1 font-semibold text-amber-700"><Clock3 size={15} /> No signature</span>
              : <span className="text-foreground-500">{reviewType === 'Personal Support Plan'
                ? 'No signature field' : 'Unclear in PDF'}</span>}
    </td>;
  })}</>;
}

export default function StudentReviews({ learnerId, learner, reviews, coaching, matches, reviewsError, coachingError, pdfError, loading }: {
  learnerId: number;
  learner?: AdvancedAdminLearner;
  reviews: Reviews;
  coaching: AdvancedAdminCoachingSession[];
  matches: ReturnType<typeof matchCoachingSessions>;
  reviewsError?: string;
  coachingError?: string;
  pdfError?: string;
  loading: boolean;
}) {
  const [filter, setFilter] = useState<'all' | Family>('all');
  const [selected, setSelected] = useState<{ family: Family; review: AdvancedAdminReview } | null>(null);
  const closeSelected = useCallback(() => setSelected(null), []);
  const [pdfSignatures, setPdfSignatures] = useState<Record<string, PdfSignatures>>({});
  const visible: Reviews = {
    mcm: reviews.mcm.filter(review => review.status === 'completed'),
    pr: reviews.pr.filter(review => review.status === 'completed' || review.status === 'awaiting-signature'),
  };
  const all = [...visible.mcm, ...visible.pr];
  const sourceLearner = [...all].sort((a, b) =>
    (b.completedDate || b.plannedDate || '').localeCompare(a.completedDate || a.plannedDate || ''))[0];
  const pdfIds = visible.pr.map(review => review.aptemReviewId).filter(Boolean).join('|');
  useEffect(() => {
    const controller = new AbortController();
    const ids = pdfIds ? pdfIds.split('|') : [];
    setPdfSignatures(Object.fromEntries(ids.map(id => [id, { status: 'loading' as const }])));
    ids.forEach(id => {
      advancedAdminReviewPdfSignatures(learnerId, id, controller.signal)
        .then(({ signatures }) => setPdfSignatures(previous => ({ ...previous, [id]: { status: 'ready', signatures } })))
        .catch(() => { if (!controller.signal.aborted) setPdfSignatures(previous => ({ ...previous, [id]: { status: 'error' } })); });
    });
    return () => controller.abort();
  }, [learnerId, pdfIds]);
  const completed = all.filter(review => review.status === 'completed').length;
  const pending = visible.pr.filter(review => {
    const result = pdfSignatures[review.aptemReviewId];
    return result?.status === 'ready' && Object.values(result.signatures || {}).some(signed => signed === false);
  }).length;
  const signaturesLoading = visible.pr.some(review => review.aptemReviewId &&
    (!pdfSignatures[review.aptemReviewId] || pdfSignatures[review.aptemReviewId].status === 'loading'));
  const signaturesUnavailable = visible.pr.some(review => !review.aptemReviewId ||
    pdfSignatures[review.aptemReviewId]?.status === 'error');
  const percent = all.length ? Math.round(completed / all.length * 100) : 0;
  const families = (['mcm', 'pr'] as const).filter(family => filter === 'all' || filter === family);
  const sessionMatches = matchCoachingSessions(visible, coaching, false);
  const selectedSession = selected && (sessionMatches.matched.get(`${selected.family}:${selected.review.id}`)
    || matches.matched.get(`${selected.family}:${selected.review.id}`));

  return <section aria-label="Student reviews" className="space-y-4">
    <div>
      <h2 id="advanced-student-reviews-heading" tabIndex={-1} className="text-2xl font-bold text-primary-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600">Student Reviews</h2>
      <p className="mt-1 text-sm text-foreground-600">Completed MCM and Progress Reviews, Aptem PDF signatures and meeting reports.</p>
    </div>
    {learner && <div className="rounded-2xl border border-foreground-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h3 className="text-lg font-bold text-primary-950">{sourceLearner?.learnerName || learner.name}</h3>
          {(sourceLearner?.learnerEmail || learner.email) && <p className="text-sm text-foreground-600">{sourceLearner?.learnerEmail || learner.email}</p>}</div>
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div><dt className="text-foreground-500">Programme</dt><dd className="font-semibold text-primary-950">{sourceLearner?.programme || learner.programme}</dd></div>
          {learner.cohort && <div><dt className="text-foreground-500">Cohort</dt><dd className="font-semibold text-primary-950">{learner.cohort}</dd></div>}
          {(sourceLearner?.group || learner.group) && <div><dt className="text-foreground-500">Group</dt><dd className="font-semibold text-primary-950">{sourceLearner?.group || learner.group}</dd></div>}
        </dl>
      </div>
    </div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        ['Total reviews', String(all.length), `${visible.mcm.length} MCM · ${visible.pr.length} Progress`, <FileText size={22} />],
        ['Completed reviews', String(completed), 'Recorded as completed', <Check size={22} />],
        ['Pending signatures', signaturesLoading ? '…' : String(pending),
          signaturesLoading ? 'Checking Aptem PDFs' : signaturesUnavailable
            ? 'Confirmed missing; some PDFs unavailable' : 'Progress Reviews with a missing PDF signature', <Clock3 size={22} />],
        ['Review completion', `${percent}%`, `${completed} / ${all.length} completed`, <BarChart3 size={22} />],
      ].map(([label, value, caption, icon]) => <div key={String(label)} className="flex items-center gap-3 rounded-2xl border border-foreground-200 bg-white p-4 shadow-sm">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700">{icon}</span>
        <div><p className="text-sm text-foreground-600">{label}</p><strong className="text-2xl text-primary-950">{value}</strong><p className="text-xs text-foreground-500">{caption}</p></div>
      </div>)}
    </div>
    <div role="group" aria-label="Review type" className="flex flex-wrap gap-1 rounded-xl border border-foreground-200 bg-white p-1">
      {([['all', `All reviews (${all.length})`], ['mcm', `MCM reviews (${visible.mcm.length})`], ['pr', `Progress reviews (${visible.pr.length})`]] as const).map(([value, label]) =>
        <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
          className={`rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 ${filter === value ? 'bg-primary-700 text-white' : 'text-primary-700 hover:bg-primary-50'}`}>{label}</button>)}
    </div>
    {reviewsError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Reviews: {reviewsError}</p>}
    {coachingError && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Meeting reports: {coachingError}</p>}
    {pdfError && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">PDF reports: {pdfError}</p>}
    {loading && !all.length && !reviewsError && <p role="status" className="rounded-xl border bg-white p-4 text-sm">Loading reviews…</p>}
    {families.map(family => <div key={family} className="overflow-hidden rounded-2xl border border-foreground-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-foreground-200 px-4 py-3">
        <h3 className="font-bold text-primary-950">{family === 'mcm' ? 'MCM Reviews' : 'Progress Reviews'}</h3>
        <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">{visible[family].length} reviews</span>
      </div>
      {visible[family].length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm">
        <thead className="bg-primary-50 text-xs text-primary-950"><tr>
          {(family === 'pr' ? ['#', 'Review', 'Review date', 'Coach', 'Student', 'Manager', 'Status', 'Actions']
            : ['#', 'Review', 'Review date', 'Status', 'Actions']).map(label => <th key={label} scope="col" className="px-3 py-3 font-semibold">{label}</th>)}
        </tr></thead>
        <tbody>{visible[family].map((review, index) => <tr key={`${family}:${review.id}`}>
          <td className="border-t border-foreground-100 px-3 py-3">{index + 1}</td>
          <td className="border-t border-foreground-100 px-3 py-3"><strong className="text-primary-950">{review.name}</strong><p className="text-xs text-foreground-500">{review.type}</p></td>
          <td className="border-t border-foreground-100 px-3 py-3"><time dateTime={review.completedDate || review.plannedDate || undefined}>{reviewDate(review.completedDate || review.plannedDate)}</time></td>
          {family === 'pr' && <ProgressSignatureCells reviewType={review.type} result={pdfSignatures[review.aptemReviewId] || { status: review.aptemReviewId ? 'loading' : 'error' }} />}
          <td className="border-t border-foreground-100 px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${review.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{review.status === 'completed' ? <Check size={14} /> : <Clock3 size={14} />}{review.status === 'completed' ? 'Completed' : 'Pending signature'}</span></td>
          <td className="border-t border-foreground-100 px-3 py-3"><button type="button" onClick={() => setSelected({ family, review })}
            className="rounded-lg border border-primary-200 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600">View</button></td>
        </tr>)}</tbody>
      </table></div> : !loading && !reviewsError && <p className="p-4 text-sm text-foreground-500">No completed {family === 'mcm' ? 'MCM' : 'Progress Review'} records for this learner.</p>}
    </div>)}
    {selected && <ReviewDetailModal key={`${selected.family}:${selected.review.id}`} learnerId={learnerId} learner={learner}
      family={selected.family} review={selected.review} session={selectedSession || undefined}
      coachingError={coachingError} meetingListLoading={loading}
      pdfStatus={selected.family === 'pr' ? pdfSignatures[selected.review.aptemReviewId]?.status ||
        (selected.review.aptemReviewId ? 'loading' : 'error') : undefined}
      onClose={closeSelected} />}
  </section>;
}
