import { useEffect, useMemo, useState } from 'react';
import type { FeedbackForm } from '@/api/feedback';
import { externalFeedbackApi, type ExternalCampaign, type ExternalCampaignType, type RecipientPreview } from '@/api/externalFeedback';

const field = 'w-full rounded-lg border border-foreground-200 bg-white px-3 py-2 text-xs';
const labels: Record<ExternalCampaignType, string> = {
  information_session: 'Information Session', commitment_meeting: 'Commitment Meeting',
};

export function ExternalFeedbackCampaignManager({ forms }: { forms: FeedbackForm[] }) {
  const [type, setType] = useState<ExternalCampaignType>('information_session');
  const [name, setName] = useState(''); const [sessionDate, setSessionDate] = useState('');
  const [formId, setFormId] = useState(0); const [file, setFile] = useState<File | null>(null);
  const [manualRecipients, setManualRecipients] = useState('');
  const [preview, setPreview] = useState<RecipientPreview | null>(null);
  const [campaigns, setCampaigns] = useState<ExternalCampaign[]>([]); const [selected, setSelected] = useState<ExternalCampaign | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const matchingForms = useMemo(() => forms.filter(form => form.formType === type && form.status === 'published'), [forms, type]);

  async function refresh() { const result = await externalFeedbackApi.list(); setCampaigns(result.campaigns); }
  useEffect(() => { void refresh().catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load campaigns.')); }, []);
  useEffect(() => { setFormId(matchingForms[0]?.id ?? 0); setPreview(null); }, [matchingForms]);

  function campaignInput() {
    if (!name.trim() || !sessionDate || !formId) throw new Error('Complete the name, date, and published form.');
    return { campaignType: type, name: name.trim(), sessionDate, formId };
  }
  function spreadsheetInput() {
    if (!file) throw new Error('Choose a recipient file.');
    return { ...campaignInput(), file };
  }
  async function previewFile() { setBusy(true); setError(''); setNotice(''); try { setPreview((await externalFeedbackApi.preview(spreadsheetInput())).preview); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Preview failed.'); } finally { setBusy(false); } }
  async function createCampaign() { setBusy(true); setError(''); try { const result = await externalFeedbackApi.create(spreadsheetInput()); setSelected(result.campaign); setPreview(null); setNotice('Campaign created. No email has been sent. Review the recipient list, then press Send.'); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Campaign creation failed.'); } finally { setBusy(false); } }
  async function createAndSendManual() { setBusy(true); setError(''); setNotice(''); try { if (!manualRecipients.trim()) throw new Error('Enter at least one recipient as Name, Email.'); const result = await externalFeedbackApi.createManual({ ...campaignInput(), manualRecipients }); setSelected(result.campaign); setManualRecipients(''); setNotice(`${result.delivery.sent} sent; ${result.delivery.failed} failed.`); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create and send the campaign.'); } finally { setBusy(false); } }
  async function openCampaign(id: number) { setBusy(true); setError(''); try { setSelected((await externalFeedbackApi.detail(id)).campaign); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load campaign.'); } finally { setBusy(false); } }
  async function send(recipientIds?: number[]) { if (!selected) return; setBusy(true); setError(''); try { const result = await externalFeedbackApi.send(selected.id, recipientIds); setNotice(`${result.sent} sent; ${result.failed} failed; ${result.remaining} pending or failed.`); await openCampaign(selected.id); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sending failed.'); } finally { setBusy(false); } }

  return <div className="space-y-5">
    <section className="rounded-xl border border-foreground-200/60 bg-white p-5">
      <h2 className="text-sm font-bold text-foreground-900">Create external feedback campaign</h2>
      <p className="mt-1 text-xs text-foreground-500">Upload only previews the spreadsheet. Emails are sent only after the campaign is created and Send is pressed.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold">Type<select className={`${field} mt-1`} value={type} onChange={event => setType(event.target.value as ExternalCampaignType)}><option value="information_session">Information Session</option><option value="commitment_meeting">Commitment Meeting</option></select></label>
        <label className="text-xs font-semibold">Name<input className={`${field} mt-1`} value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="text-xs font-semibold">Date<input type="date" className={`${field} mt-1`} value={sessionDate} onChange={event => setSessionDate(event.target.value)} /></label>
        <label className="text-xs font-semibold">Published form<select className={`${field} mt-1`} value={formId} onChange={event => setFormId(Number(event.target.value))}><option value={0}>Choose form</option>{matchingForms.map(form => <option key={form.id} value={form.id}>{form.title} (v{form.version})</option>)}</select></label>
        <label className="text-xs font-semibold md:col-span-2">Recipients (.xlsx or .csv; Name and Email)<input aria-label="Recipient file" type="file" accept=".xlsx,.csv" className={`${field} mt-1`} onChange={event => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} /></label>
      </div>
      <button disabled={busy} onClick={() => void previewFile()} className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Preview recipients</button>
      <div className="my-5 flex items-center gap-3 text-[11px] font-semibold uppercase text-foreground-400"><span className="h-px flex-1 bg-foreground-200" /><span>or add a small audience manually</span><span className="h-px flex-1 bg-foreground-200" /></div>
      <label className="text-xs font-semibold">Manual recipients — one per line as Name, Email<textarea aria-label="Manual recipients" rows={4} value={manualRecipients} onChange={event => setManualRecipients(event.target.value)} placeholder={'Alex Morgan, alex@example.com\nSam Lee, sam@example.com'} className={`${field} mt-1 resize-y`} /></label>
      <p className="mt-2 text-[11px] text-foreground-500">Manual recipients are validated and sent immediately. Invalid, missing, or duplicate rows must be fixed first.</p>
      <button disabled={busy || !manualRecipients.trim()} onClick={() => void createAndSendManual()} className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Create campaign &amp; send now</button>
    </section>
    {preview && <section className="rounded-xl border border-foreground-200/60 bg-white p-5">
      <div className="grid gap-3 sm:grid-cols-4"><Count label="Valid" value={preview.counts.valid} tone="emerald" /><Count label="Invalid emails" value={preview.counts.invalidEmails} tone="red" /><Count label="Missing rows" value={preview.counts.missingRows} tone="amber" /><Count label="Duplicates" value={preview.counts.duplicates} tone="violet" /></div>
      <PreviewTable title="Valid recipients" rows={preview.valid} /><PreviewTable title="Invalid emails" rows={preview.invalidEmails} /><PreviewTable title="Missing required values" rows={preview.missingRows} /><PreviewTable title="Duplicate emails (case-insensitive)" rows={preview.duplicates} />
      <button disabled={busy || preview.counts.valid === 0} onClick={() => void createCampaign()} className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Create campaign with valid recipients</button>
    </section>}
    {(error || notice) && <div role={error ? 'alert' : 'status'} className={`rounded-lg border p-3 text-xs ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{error || notice}</div>}
    <section className="rounded-xl border border-foreground-200/60 bg-white p-5"><h2 className="text-sm font-bold">Campaigns</h2><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead><tr className="border-b text-foreground-500">{['Type', 'Name', 'Date', 'Form', 'Recipients', 'Submitted', 'Failed', 'Action'].map(item => <th key={item} className="px-2 py-2">{item}</th>)}</tr></thead><tbody>{campaigns.map(campaign => <tr key={campaign.id} className="border-b"><td className="px-2 py-3">{labels[campaign.campaignType]}</td><td className="px-2 py-3 font-semibold">{campaign.name}</td><td className="px-2 py-3">{campaign.sessionDate}</td><td className="px-2 py-3">{campaign.form.title} v{campaign.form.version}</td><td className="px-2 py-3">{campaign.recipientCount}</td><td className="px-2 py-3">{campaign.counts.submitted}</td><td className="px-2 py-3">{campaign.counts.failed}</td><td className="px-2 py-3"><button className="font-semibold text-primary-600" onClick={() => void openCampaign(campaign.id)}>Manage</button></td></tr>)}</tbody></table></div></section>
    {selected && <section className="rounded-xl border border-primary-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-primary-700">{labels[selected.campaignType]}</p><h2 className="text-base font-bold">{selected.name} · {selected.sessionDate}</h2></div><button disabled={busy || !(selected.counts.pending + selected.counts.failed)} onClick={() => void send()} className="rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Send pending / failed</button></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead><tr className="border-b"><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2">Status</th><th className="p-2">Error</th><th className="p-2">Action</th></tr></thead><tbody>{selected.recipients?.map(recipient => <tr key={recipient.id} className="border-b"><td className="p-2">{recipient.name}</td><td className="p-2">{recipient.email}</td><td className="p-2 font-semibold capitalize">{recipient.status}</td><td className="max-w-xs truncate p-2 text-red-600">{recipient.error}</td><td className="p-2">{(recipient.status === 'pending' || recipient.status === 'failed') && <button className="font-semibold text-primary-600" onClick={() => void send([recipient.id])}>Send</button>}</td></tr>)}</tbody></table></div></section>}
  </div>;
}

function Count({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'red' | 'amber' | 'violet' }) { const colors = { emerald: 'bg-emerald-50 text-emerald-800', red: 'bg-red-50 text-red-800', amber: 'bg-amber-50 text-amber-800', violet: 'bg-violet-50 text-violet-800' }; return <div className={`rounded-lg p-3 ${colors[tone]}`}><p className="text-[11px]">{label}</p><p className="text-xl font-bold">{value}</p></div>; }
function PreviewTable({ title, rows }: { title: string; rows: Array<{ row: number; name: string; email: string; missing?: string }> }) { if (!rows.length) return null; return <div className="mt-4"><h3 className="text-xs font-bold">{title}</h3><div className="mt-2 max-h-48 overflow-auto rounded-lg border"><table className="w-full text-left text-xs"><tbody>{rows.map(item => <tr key={`${item.row}-${item.email}`} className="border-b"><td className="p-2">Row {item.row}</td><td className="p-2">{item.name || '—'}</td><td className="p-2">{item.email || '—'}</td><td className="p-2 text-amber-700">{item.missing || ''}</td></tr>)}</tbody></table></div></div>; }
