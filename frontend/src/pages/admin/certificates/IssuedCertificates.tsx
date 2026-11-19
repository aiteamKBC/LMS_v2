import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CertificateDocument } from '@/components/feature/CertificateDocument';
import {
  listIssuedCertificates, readIssuedCertificate, updateIssuedCertificate,
  type AdminIssuedCertificate, type CertificateCorrections, type IssuedCertificateDetail,
  type IssuedCertificateRow, type Paged,
} from '@/api/platformAdmin';

const button = 'min-h-10 rounded-xl border border-primary-200 px-4 py-2 text-sm font-semibold text-primary-800 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50';
const input = 'w-full rounded-xl border border-foreground-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-300';
const fields: Array<{ key: keyof CertificateCorrections; label: string; max: number; required?: boolean }> = [
  { key: 'learnerName', label: 'Student name', max: 255, required: true },
  { key: 'courseTitle', label: 'Course name', max: 255, required: true },
  { key: 'title', label: 'Certificate title', max: 200, required: true },
  { key: 'bodyText', label: 'Certificate text', max: 2000, required: true },
  { key: 'instructorName', label: 'Signatory name', max: 255 },
  { key: 'instructorLabel', label: 'Signatory label', max: 100 },
];
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', year: 'numeric' }) : 'Not recorded';
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not load certificates.';
const statusName = (status: IssuedCertificateRow['status']) => ({ issued: 'Active', revoked: 'Revoked', superseded: 'Superseded' })[status];

function Preview({ certificate, values, pending = false }: { certificate: AdminIssuedCertificate; values: CertificateCorrections; pending?: boolean }) {
  const url = `${window.location.origin}${certificate.verificationUrl}`;
  return <div className="min-w-0 rounded-2xl border border-primary-100 bg-primary-50/50 p-3">
    <p className="mb-3 text-sm font-semibold">{pending ? 'Preview of your correction' : `Certificate copy · revision ${certificate.revision}`}</p>
    <CertificateDocument title={values.title} bodyText={values.bodyText} learnerName={values.learnerName}
      programmeName={values.courseTitle} progressLabel={`${certificate.progressPercent}%`}
      certificateNumber={certificate.certificateNumber} awardedOn={date(certificate.issuedAt)} verificationUrl={url}
      revisionLabel={pending ? 'Correction preview — not saved' : certificate.revision > 1 ? `Corrected copy · Revision ${certificate.revision} · ${date(certificate.correctedAt)}` : undefined}
      layoutConfig={{ ...certificate.layoutConfig, instructorName: values.instructorName, instructorLabel: values.instructorLabel }} />
    <p className="mt-3 text-xs text-foreground-600">Progress shown here was recorded at issue. The verification page shows the latest available course progress.</p>
  </div>;
}

export default function IssuedCertificates({ active }: { active: boolean }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [list, setList] = useState<Paged<IssuedCertificateRow> | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [detail, setDetail] = useState<IssuedCertificateDetail | null>(null);
  const [draft, setDraft] = useState<CertificateCorrections | null>(null);
  const [mode, setMode] = useState<'view' | 'correct' | 'revoke'>('view');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [archived, setArchived] = useState<AdminIssuedCertificate | null>(null);
  const requestId = useRef(0);
  const changes = detail && draft ? Object.fromEntries(fields.filter(({ key }) => draft[key] !== detail.certificate.editable[key]).map(({ key }) => [key, draft[key]])) as Partial<CertificateCorrections> : {};
  const dirty = !!reason || Object.keys(changes).length > 0;

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    setLoading(true); setListError('');
    listIssuedCertificates({ q: query, status, page }).then(result => {
      if (!disposed) setList(result);
    }).catch(err => { if (!disposed) { setList(null); setListError(message(err)); } })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [active, query, status, page, refresh]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  useEffect(() => () => { requestId.current += 1; }, []);

  const canLeave = () => !dirty || window.confirm('Discard the unsaved certificate changes?');
  const open = async (id: number, nextMode: typeof mode = 'view') => {
    if (!canLeave()) return;
    const ticket = ++requestId.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await readIssuedCertificate(id);
      if (ticket !== requestId.current) return;
      setDetail(result); setDraft(result.certificate.editable); setReason(''); setArchived(null);
      setMode(result.certificate.status === 'issued' ? nextMode : 'view');
    } catch (err) { if (ticket === requestId.current) setError(message(err)); }
    finally { if (ticket === requestId.current) setBusy(false); }
  };
  const changeMode = (next: typeof mode) => {
    if (!canLeave() || !detail) return;
    setDraft(detail.certificate.editable); setReason(''); setError(''); setArchived(null); setMode(next);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail || busy || mode === 'view') return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await updateIssuedCertificate(detail.certificate.id, {
        action: mode, revision: detail.certificate.revision, reason,
        ...(mode === 'correct' ? { changes } : {}),
      });
      setDetail(result); setDraft(result.certificate.editable); setMode('view'); setReason(''); setArchived(null);
      setNotice(mode === 'correct' ? 'Corrected copy saved. The same verification link now opens this copy. Download a new PDF to share it.' : 'Certificate revoked. Its verification link no longer shows a valid certificate.');
      setRefresh(value => value + 1);
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };

  if (detail && draft) {
    const cert = detail.certificate;
    return <section className="space-y-5" aria-label="Issued certificate details">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} className={button} onClick={() => {
          if (!canLeave()) return;
          setDetail(null); setDraft(null); setReason(''); setError(''); setNotice('');
        }}>Back to certificates</button>
        <h2 className="text-lg font-bold">{cert.certificateNumber}</h2>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm">{statusName(cert.status)} · Revision {cert.revision}</span>
        {cert.status === 'issued' && <a href={cert.verificationUrl} target="_blank" rel="noopener noreferrer" className={button}>Open verification page</a>}
      </div>
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}
      {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error} <button type="button" disabled={busy} className="ml-2 underline" onClick={() => void open(cert.id)}>Reload certificate</button></div>}
      <div className="flex flex-wrap gap-3 text-sm text-foreground-600">
        <span>Originally issued: {date(cert.issuedAt)}</span>
        {cert.correctedAt && <span>Last corrected: {date(cert.correctedAt)}</span>}
        {cert.revokedAt && <span>Revoked: {date(cert.revokedAt)} · {cert.revokeReason}</span>}
      </div>
      {cert.status === 'issued' && <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy || mode === 'correct'} onClick={() => changeMode('correct')}>Correct certificate</button>
        <button type="button" className={`${button} text-red-700`} disabled={busy || mode === 'revoke'} onClick={() => changeMode('revoke')}>Revoke certificate</button>
        {mode !== 'view' && <button type="button" className={button} disabled={busy} onClick={() => changeMode('view')}>Cancel</button>}
      </div>}
      <div className={mode === 'correct' ? 'grid min-w-0 items-start gap-5 xl:grid-cols-[320px_minmax(0,1fr)]' : 'space-y-5'}>
        {mode !== 'view' && <form onSubmit={save} aria-label={mode === 'correct' ? 'Certificate correction' : 'Certificate revocation'} className="space-y-4 rounded-2xl border bg-white p-5">
          <p className="text-sm text-foreground-600">{mode === 'correct' ? 'Correct the details on this certificate. The student profile, course records and template stay unchanged.' : 'Revoking this certificate makes its verification link invalid. The record and its history are retained.'}</p>
          {mode === 'correct' && fields.map(field => <label key={field.key} className="block space-y-1 text-sm font-semibold">
            <span>{field.label}</span>
            {field.key === 'bodyText' ? <textarea className={input} rows={4} required maxLength={field.max} disabled={busy} value={draft[field.key]} onChange={e => setDraft({ ...draft, [field.key]: e.target.value })} />
              : <input className={input} required={field.required} maxLength={field.max} disabled={busy} value={draft[field.key]} onChange={e => setDraft({ ...draft, [field.key]: e.target.value })} />}
          </label>)}
          {mode === 'correct' && <p className="text-xs text-foreground-600">Progress is calculated from completed activities and cannot be edited here. The original award date and certificate number are retained.</p>}
          <label className="block space-y-1 text-sm font-semibold"><span>{mode === 'correct' ? 'Reason for correction' : 'Reason for revocation'}</span>
            <textarea className={input} required maxLength={1000} rows={3} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} />
          </label>
          <button type="submit" disabled={busy || !reason.trim() || (mode === 'correct' && !Object.keys(changes).length)} className={`${button} ${mode === 'revoke' ? 'border-red-300 text-red-700' : 'bg-primary-50'}`}>
            {busy ? 'Saving…' : mode === 'correct' ? 'Save corrected copy' : 'Confirm revocation'}
          </button>
        </form>}
        <Preview certificate={cert} values={mode === 'correct' ? draft : cert.editable} pending={mode === 'correct' && Object.keys(changes).length > 0} />
      </div>
      <section aria-label="Certificate history" className="space-y-3 rounded-2xl border bg-white p-5">
        <h3 className="font-bold">Change history</h3>
        <p className="text-sm text-foreground-600">Original award: {date(cert.issuedAt)}. Earlier copies are retained for review.</p>
        {detail.history.length === 0 && <p className="text-sm">No recorded changes.</p>}
        {detail.history.map(entry => <article key={entry.id} className="space-y-2 border-t pt-3 text-sm">
          <p><strong>{entry.action === 'certificate-corrected' ? 'Corrected' : entry.action === 'certificate-revoked' ? 'Revoked' : 'Issued'}</strong> · {date(entry.at)} · {entry.actor}</p>
          {entry.details.reason && <p>{entry.details.reason}</p>}
          {entry.details.changedFields?.length ? <dl className="space-y-1">{entry.details.changedFields.map(key => {
            const field = fields.find(f => f.key === key);
            if (!field) return null;
            return <div key={key}><dt className="font-semibold">{field.label}</dt><dd className="break-words whitespace-pre-wrap">{entry.details.before?.editable[field.key] || '(empty)'} → {entry.details.after?.editable[field.key] || '(empty)'}</dd></div>;
          })}</dl> : null}
          {entry.details.before && <button type="button" className={button} onClick={() => setArchived(entry.details.before!)}>View copy before this change (revision {entry.details.before.revision})</button>}
        </article>)}
        {archived && <div className="space-y-3 border-t pt-4"><p role="status" className="font-semibold text-amber-800">Archived copy · for review only</p>
          <button type="button" className={button} onClick={() => setArchived(null)}>Close archived copy</button>
          <Preview certificate={archived} values={archived.editable} />
        </div>}
      </section>
    </section>;
  }

  return <section className="space-y-4" aria-label="Manage certificates">
    <p className="text-sm text-foreground-600">Find a learner certificate to view, correct or revoke. Each change is recorded against that certificate.</p>
    <form aria-label="Search certificates" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(1); setRefresh(value => value + 1); }} className="flex flex-wrap items-end gap-3">
      <label className="min-w-60 flex-1 space-y-1 text-sm font-semibold"><span>Student, certificate number or course</span><input type="search" maxLength={255} className={input} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label className="space-y-1 text-sm font-semibold"><span>Status</span><select className={input} value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
        <option value="">All statuses</option><option value="issued">Active</option><option value="revoked">Revoked</option><option value="superseded">Superseded</option>
      </select></label>
      <button type="submit" className={button} disabled={loading}>Search</button>
    </form>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
    {listError && <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{listError} <button type="button" className="underline" onClick={() => setRefresh(value => value + 1)}>Retry</button></div>}
    {loading ? <p role="status">Loading issued certificates…</p> : list && <>
      <div className="overflow-x-auto rounded-2xl border bg-white">
        {/* Keep horizontal scrolling on the wrapper under the mobile workspace styles. */}
        <table className="!table w-full text-left text-sm"><caption className="sr-only">Issued learner certificates</caption>
          <thead className="bg-primary-50 text-xs uppercase text-primary-900"><tr>{['Student', 'Course', 'Progress at issue', 'Issued', 'Status', 'Actions'].map(label => <th key={label} className={label === 'Actions' ? 'w-px whitespace-nowrap p-4' : 'p-4'}>{label}</th>)}</tr></thead>
          <tbody>{list.results.map(cert => <tr key={cert.id} className="border-t">
            <td className="p-4"><strong>{cert.learnerName || 'Name not recorded'}</strong><p className="mt-1 text-xs text-foreground-500">{cert.certificateNumber}</p></td>
            <td className="p-4">{cert.courseTitle || 'Course not recorded'}</td><td className="p-4">{cert.progressPercent}%</td><td className="whitespace-nowrap p-4">{date(cert.issuedAt)}</td>
            <td className="p-4">{statusName(cert.status)}{cert.revision > 1 && <p className="text-xs text-foreground-500">Revision {cert.revision}</p>}</td>
            <td className="w-px whitespace-nowrap p-4"><div className="flex items-center justify-center gap-2"><button type="button" aria-label={`View & history ${cert.certificateNumber}`} className={button} disabled={busy} onClick={() => void open(cert.id)}>View & history</button>
              {cert.status === 'issued' && <button type="button" aria-label={`Correct ${cert.certificateNumber}`} className={button} disabled={busy} onClick={() => void open(cert.id, 'correct')}>Correct</button>}
            </div></td>
          </tr>)}</tbody>
        </table>
        {!list.results.length && <p className="p-8 text-center text-foreground-600">No certificates match your search.</p>}
      </div>
      <div className="flex items-center justify-between gap-3 text-sm"><span>{list.count} certificates · Page {page}</span><div className="flex gap-2">
        <button type="button" className={button} disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button>
        <button type="button" className={button} disabled={page * list.pageSize >= list.count} onClick={() => setPage(value => value + 1)}>Next</button>
      </div></div>
    </>}
    {busy && <p role="status">Opening certificate…</p>}
  </section>;
}
