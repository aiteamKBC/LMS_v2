import { useState } from 'react';
import { coachFetch } from '@/lib/coachFetch';

export interface KsbReview {
  status: 'pending' | 'completed';
  revision: string;
  programme: string;
  sourceId: string;
  originalCodes: string[];
  items?: { code: string; description: string }[];
  reviewedBy?: string;
  reviewedAt?: string;
  correctionReason?: string;
}

export function KsbReviewPanel({ submissionId, review, onSaved }: {
  submissionId: string; review: KsbReview; onSaved: () => void;
}) {
  const [codes, setCodes] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = review.status === 'pending';
  async function save() {
    if (saving) return;
    if (!codes.length || !reason.trim()) {
      setError('Select the relevant programme KSBs and explain the correction.');
      return;
    }
    setSaving(true); setError('');
    try {
      const response = await coachFetch(`/coach_api/coach/marking-queue/${submissionId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'review_ksbs', revision: review.revision, sourceId: review.sourceId,
          ksbCodes: codes, reason: reason.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || 'The KSB correction could not be saved.');
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The KSB correction could not be saved.');
    } finally { setSaving(false); }
  }
  return <section aria-label="Programme KSB review" className="my-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
    <h3 className="font-semibold">{pending ? 'KSB review required' : 'KSB correction recorded'}</h3>
    <p className="mt-2">{pending
      ? `Review the evidence and select KSBs for ${review.programme}. The submission remains accepted; its hours and original review are retained.`
      : `Corrected by ${review.reviewedBy || 'Coach'}. ${review.correctionReason || ''}`}</p>
    <p className="mt-2"><strong>Original learner KSB claims:</strong> {review.originalCodes.join(', ')}</p>
    {pending && <>
      <fieldset disabled={saving} className="mt-4">
        <legend className="font-semibold">{review.programme} KSBs</legend>
        <div className="mt-2 max-h-80 space-y-2 overflow-y-auto rounded-lg border border-amber-200 bg-white p-3">
          {(review.items || []).map(item => <label key={item.code} className="flex items-start gap-3">
            <input type="checkbox" className="mt-1" checked={codes.includes(item.code)}
              onChange={event => setCodes(previous => event.target.checked ? [...previous, item.code] : previous.filter(code => code !== item.code))} />
            <span><strong>{item.code}</strong> — {item.description}</span>
          </label>)}
        </div>
        <label className="mt-3 block font-semibold" htmlFor="ksb-correction-reason">Reason for KSB correction</label>
        <textarea id="ksb-correction-reason" value={reason} onChange={event => setReason(event.target.value)}
          maxLength={4000} rows={3} className="mt-1 w-full rounded-lg border border-amber-200 bg-white p-2" />
      </fieldset>
      {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
      <button type="button" disabled={saving || !review.items?.length} onClick={() => void save()}
        className="mt-3 rounded-lg bg-primary-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
        {saving ? 'Saving KSB correction…' : 'Save KSB correction'}
      </button>
    </>}
  </section>;
}
