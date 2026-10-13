import { useEffect, useState, type FormEvent } from 'react';
import {
  advancedAdminAssignmentUploads, advancedAdminAssignmentUploadUrl,
  advancedAdminUploadAssignment, type AdvancedAdminAssignmentUpload,
} from '@/api/advancedAdmin';

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Could not load Advanced Admin assignments.';
}

function monthLabel(month: string) {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function currentUkMonth() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}`;
}

export default function AdvancedAdminAssignmentUploads({ learnerId, readOnly }: {
  learnerId: number; readOnly: boolean;
}) {
  const [items, setItems] = useState<AdvancedAdminAssignmentUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [month, setMonth] = useState('');
  const [hours, setHours] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setItems([]); setError('');
    advancedAdminAssignmentUploads(learnerId, controller.signal)
      .then(result => { if (!controller.signal.aborted) setItems(result.items); })
      .catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [learnerId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || saving) return;
    setSaving(true); setError('');
    try {
      await advancedAdminUploadAssignment(learnerId, month, hours, file);
      const result = await advancedAdminAssignmentUploads(learnerId);
      setItems(result.items);
      setMonth(''); setHours(''); setFile(null);
      setFileInputKey(value => value + 1);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }

  const total = items.reduce((sum, item) => sum + item.actualHours, 0);
  return <section className="rounded-2xl border border-[#dce5f7] bg-white p-5 text-[#101451] shadow-sm" aria-label="Advanced Admin assignment records">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="text-lg font-bold">Advanced Admin assignment records</h2>
        <p className="text-sm text-[#52619a]">Private to Advanced Admin. Recorded by month; exact activity dates are not supplied.</p></div>
      <strong className="text-lg">{Number(total.toFixed(2))}h recorded</strong>
    </div>
    {loading && <p role="status" className="mt-4">Loading assignment records…</p>}
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    {!loading && items.length === 0 && <p className="mt-4 text-sm text-[#52619a]">No Advanced Admin assignments recorded.</p>}
    {items.length > 0 && <ul className="mt-4 space-y-2">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e1e8f5] p-3">
      <div><strong>{monthLabel(item.month)} · {Number(item.actualHours.toFixed(2))}h</strong>
        <p className="break-all text-sm">{item.filename}</p></div>
      <a href={advancedAdminAssignmentUploadUrl(learnerId, item.id)} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#4c20d5] underline">Open assignment</a>
    </li>)}</ul>}
    {!readOnly && <form className="mt-5 grid gap-3 border-t border-[#e1e8f5] pt-4 sm:grid-cols-4" onSubmit={event => { void submit(event); }}>
      <label className="text-sm font-medium">Assignment month
        <input type="month" required value={month} max={currentUkMonth()} onChange={event => setMonth(event.target.value)} className="mt-1 block w-full rounded-lg border p-2" />
      </label>
      <label className="text-sm font-medium">Confirmed OTJ hours
        <input type="number" required min="0.01" max="1000" step="0.01" value={hours} onChange={event => setHours(event.target.value)} className="mt-1 block w-full rounded-lg border p-2" />
      </label>
      <label className="text-sm font-medium sm:col-span-2">Assignment file
        <input key={fileInputKey} type="file" required accept=".pdf,.doc,.docx,.pptx" onChange={event => setFile(event.target.files?.[0] || null)} className="mt-1 block w-full rounded-lg border p-2" />
      </label>
      <button type="submit" disabled={saving || !file} className="rounded-lg bg-[#6426ed] px-4 py-2 font-semibold text-white disabled:opacity-50 sm:col-span-4 sm:justify-self-start">{saving ? 'Recording…' : 'Record assignment'}</button>
    </form>}
  </section>;
}
