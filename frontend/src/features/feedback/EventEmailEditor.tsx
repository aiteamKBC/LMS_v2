import { useEffect, useState } from 'react';
import { eventFeedbackApi, type EventEmailCopy, type EventEmailPurpose, type EventEmailTemplate } from '@/api/eventFeedback';

const empty: EventEmailCopy = { templateId: null, subject: '', body: '', buttonText: '' };

export function EventEmailEditor({ eventId, purpose, onSaved }: { eventId: string; purpose: EventEmailPurpose; onSaved?: () => void }) {
  const [templates, setTemplates] = useState<EventEmailTemplate[]>([]);
  const [copy, setCopy] = useState<EventEmailCopy>(empty);
  const [templateName, setTemplateName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([eventFeedbackApi.emailTemplates(purpose), eventFeedbackApi.emailSetting(eventId, purpose)])
      .then(([templateResult, settingResult]) => { setTemplates(templateResult.templates); setCopy(settingResult.setting); })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Could not load email settings.'));
  }, [eventId, purpose]);

  function applyTemplate(id: string) {
    if (!id) { setCopy(current => ({ ...current, templateId: null })); return; }
    const template = templates.find(item => item.id === Number(id));
    if (template) setCopy({ templateId: template.id, subject: template.subject, body: template.body, buttonText: template.buttonText });
  }

  async function saveEventCopy() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await eventFeedbackApi.saveEmailSetting(eventId, purpose, copy);
      setCopy(result.setting); setNotice('Email copy saved for this event.'); onSaved?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save email copy.'); }
    finally { setBusy(false); }
  }

  async function saveTemplate() {
    if (!templateName.trim()) { setError('Enter a reusable template name.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await eventFeedbackApi.createEmailTemplate({ ...copy, name: templateName.trim(), purpose });
      const setting = await eventFeedbackApi.saveEmailSetting(eventId, purpose, { ...copy, templateId: result.template.id });
      setTemplates(current => [...current, result.template].sort((a, b) => a.name.localeCompare(b.name)));
      setCopy(setting.setting);
      setTemplateName(''); setNotice('Reusable template saved and applied to this event.'); onSaved?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save template.'); }
    finally { setBusy(false); }
  }

  const field = 'mt-1 w-full rounded-lg border border-foreground-200 bg-white px-3 py-2 text-xs text-foreground-800 focus:outline-none focus:ring-2 focus:ring-primary-300';
  return <section className="rounded-xl border border-foreground-200 p-4">
    <h3 className="text-sm font-semibold text-foreground-800">Email copy</h3>
    <p className="mt-1 text-xs text-foreground-500">Use a reusable template, then customise this event without changing the original. Variables: {'{{recipient_name}}'}, {'{{event_title}}'}, {'{{event_date}}'}, {'{{event_time}}'}, {'{{event_location}}'}.</p>
    <label className="mt-3 block text-xs font-semibold text-foreground-700">Reusable template
      <select className={field} value={copy.templateId ?? ''} onChange={event => applyTemplate(event.target.value)}><option value="">Default / custom</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    </label>
    <label className="mt-3 block text-xs font-semibold text-foreground-700">Subject<input className={field} value={copy.subject} maxLength={255} onChange={event => setCopy(current => ({ ...current, subject: event.target.value }))} /></label>
    <label className="mt-3 block text-xs font-semibold text-foreground-700">Message<textarea className={`${field} min-h-32 resize-y`} value={copy.body} maxLength={10000} onChange={event => setCopy(current => ({ ...current, body: event.target.value }))} /></label>
    <label className="mt-3 block text-xs font-semibold text-foreground-700">Button text<input className={field} value={copy.buttonText} maxLength={120} onChange={event => setCopy(current => ({ ...current, buttonText: event.target.value }))} /></label>
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <button type="button" disabled={busy} onClick={() => void saveEventCopy()} className="rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Save for this event</button>
      <label className="min-w-48 flex-1 text-xs font-semibold text-foreground-700">Save current copy as template<input className={field} value={templateName} placeholder="Template name" maxLength={255} onChange={event => setTemplateName(event.target.value)} /></label>
      <button type="button" disabled={busy} onClick={() => void saveTemplate()} className="rounded-lg border border-foreground-300 px-4 py-2 text-xs font-semibold text-foreground-700 disabled:opacity-50">Save template</button>
    </div>
    {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 text-xs text-emerald-700">{notice}</p>}
  </section>;
}
