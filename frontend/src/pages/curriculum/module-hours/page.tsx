import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCurriculumModules } from '@/lib/curriculumApi';
import { ModuleHoursError } from '@/api/moduleHours';
import { confirmHours, previewHours, readHoursDefaults, readHoursHistory,
  type DefaultItem, type HoursOperation, type HoursOutcome, type HoursPreview } from '@/api/moduleHoursWorkflows';

const minutes = (value: number | null | undefined) => value == null ? 'Not set' : `${value} minutes`;
const button = 'rounded-lg border border-background-300 px-3 py-2 text-sm disabled:opacity-50';

export default function ModuleHoursPage() {
  const [modules, setModules] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [operation, setOperation] = useState<HoursOperation>('set_targets');
  const [value, setValue] = useState('');
  const [clear, setClear] = useState(false);
  const [defaults, setDefaults] = useState<DefaultItem[]>([]);
  const [canMatch, setCanMatch] = useState(false);
  const [preview, setPreview] = useState<HoursPreview | null>(null);
  const [outcome, setOutcome] = useState<HoursOutcome | null>(null);
  const [history, setHistory] = useState<HoursOutcome[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const key = useRef('');
  const inFlight = useRef(false);
  const selectionKey = selected.join('\n');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetchCurriculumModules(controller.signal, { compact: true }).then(rows => {
      if (controller.signal.aborted) return;
      const canonical = rows.filter(row => !row.isFreeCourse).map(row => ({
        id: row.moduleCatalogueId || row.id, name: row.name,
      }));
      setModules([...new Map(canonical.map(row => [row.id, row])).values()]);
    }).catch(() => { if (!controller.signal.aborted) setError('Module catalogue unavailable. Retry loading.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    setDefaults([]); setCanMatch(false); setPreview(null); key.current = '';
    if (!selectionKey) return;
    const controller = new AbortController();
    void readHoursDefaults(selectionKey.split('\n'), controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setDefaults(result.items); setCanMatch(result.canMatch);
    }).catch(() => { if (!controller.signal.aborted) setError('Module defaults unavailable. Retry loading.'); });
    return () => controller.abort();
  }, [selectionKey, reload]);

  async function loadHistory(before?: string) {
    try {
      const result = await readHoursHistory(before);
      setHistory(previous => before ? [...new Map([...previous, ...result.operations].map(item => [item.operationId, item])).values()] : result.operations);
      setHistoryCursor(result.nextCursor || null); setHistoryError(false);
    }
    catch { setHistoryError(true); }
  }
  async function olderDefaults(item: DefaultItem) {
    try {
      const result = await readHoursDefaults([item.moduleId], undefined, item.nextBeforeRevision!);
      setDefaults(previous => previous.map(row => row.moduleId === item.moduleId ? {
        ...row, revisions: [...new Map([...row.revisions, ...result.items[0].revisions].map(revision => [revision.revision, revision])).values()], nextBeforeRevision: result.items[0].nextBeforeRevision,
      } : row));
    } catch { setError('Default history unavailable. Retry loading older revisions.'); }
  }
  useEffect(() => { void loadHistory(); }, []);

  function invalidate() { setPreview(null); setOutcome(null); key.current = ''; setError(''); }
  async function makePreview() {
    if (inFlight.current) return;
    const amount = clear ? null : Number(value);
    if (operation !== 'apply_defaults' && !clear && (!Number.isInteger(amount) || amount! <= 0 || amount! > 2147483647)) {
      setError('Enter positive whole-number minutes, or choose Clear.'); return;
    }
    inFlight.current = true; setBusy(true); setError(''); setOutcome(null);
    try {
      const items = defaults.map(item => ({ moduleId: item.state?.moduleId || item.moduleId,
        ...(operation !== 'save_defaults' ? { expectedRevision: item.state?.target.revision ?? 0 } : {}),
        ...(operation !== 'set_targets' ? { expectedDefaultRevision: item.state?.default?.revision ?? 0 } : {}),
        ...(operation !== 'apply_defaults' ? { targetMinutes: amount } : {}),
      }));
      setPreview(await previewHours(operation, items)); key.current = crypto.randomUUID();
    } catch (err) { setError(err instanceof Error ? err.message : 'Preview unavailable.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function apply() {
    if (!preview?.canConfirm || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await confirmHours(preview, key.current);
      setOutcome(result); setPreview(null); setReload(r => r + 1); void loadHistory();
    } catch (err) {
      if (err instanceof ModuleHoursError && (err.status === 409 || err.status === 403)) {
        setPreview(null); setReload(r => r + 1);
        setError('Selection or permissions changed. Reload the values and create a new preview.');
      } else setError('Confirmation response unavailable. Retry confirmation to recover the same operation.');
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <main className="mx-auto max-w-5xl space-y-5 p-6 text-foreground-900">
    <Link to="/curriculum/library" className="text-primary-700 underline">Curriculum library</Link>
    <h1 className="text-2xl font-bold">Module hours</h1>
    <p>Review and update module targets or saved defaults. These changes do not update learner hours or progress.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <button className={button} disabled={busy} onClick={() => { setError(''); setReload(r => r + 1); }}>Reload values</button>
    {loading ? <p role="status">Loading modules…</p> : <fieldset disabled={busy} className="rounded-xl border p-4">
      <legend className="font-semibold">Select modules (up to 100)</legend>
      <div className="max-h-64 space-y-2 overflow-auto">{modules.map(module => <label key={module.id} className="flex gap-2">
        <input type="checkbox" checked={selected.includes(module.id)} disabled={!selected.includes(module.id) && selected.length >= 100}
          onChange={event => { invalidate(); setSelected(previous => event.target.checked ? [...previous, module.id] : previous.filter(id => id !== module.id)); }} />
        {module.name}
      </label>)}</div>
      {!modules.length && <p>No modules available.</p>}
    </fieldset>}
    <fieldset disabled={busy} className="flex flex-wrap items-center gap-4 rounded-xl border p-4">
      <legend className="font-semibold">Change</legend>
      <label>Operation <select className="rounded border p-2" value={operation} onChange={event => { invalidate(); setOperation(event.target.value as HoursOperation); }}>
        <option value="set_targets">Set module targets</option><option value="save_defaults">Save defaults</option><option value="apply_defaults">Apply saved defaults</option>
      </select></label>
      {operation !== 'apply_defaults' && <>
        <label>Minutes <input className="w-32 rounded border p-2" type="number" min="1" step="1" value={value} disabled={clear}
          onChange={event => { invalidate(); setValue(event.target.value); }} /></label>
        <label><input type="checkbox" checked={clear} onChange={event => { invalidate(); setClear(event.target.checked); }} /> Clear {operation === 'save_defaults' ? 'default' : 'target'}</label>
      </>}
      <button className={button} disabled={!canMatch || !selected.length || defaults.length !== selected.length} onClick={() => void makePreview()}>Preview changes</button>
    </fieldset>
    {!!selected.length && !canMatch && <p>Loading settings, or Match Module Hours permission is unavailable.</p>}
    {!!defaults.length && <section aria-label="Current defaults" className="rounded-xl border p-4">
      <h2 className="font-semibold">Current targets and defaults</h2>
      {defaults.map(item => <details key={item.moduleId} className="py-2">
        <summary>{modules.find(m => m.id === item.moduleId)?.name || item.moduleId}: target {minutes(item.state?.target.targetMinutes)}, default {minutes(item.state?.default?.targetMinutes)}{item.reason ? ` — ${item.reason}` : ''}</summary>
        <ul>{item.revisions.map(revision => <li key={revision.revision}>Default revision {revision.revision}: {minutes(revision.before?.targetMinutes)} → {minutes(revision.after.targetMinutes)}</li>)}</ul>
        {item.nextBeforeRevision && <button className={button} onClick={() => void olderDefaults(item)}>Older default revisions</button>}
      </details>)}
    </section>}
    {preview && <section aria-label="Preview" className="space-y-3 rounded-xl border p-4">
      <h2 className="font-semibold">Review exact changes</h2>
      <ul>{preview.items.map(item => <li key={item.moduleId}>{modules.find(m => m.id === item.moduleId)?.name || item.moduleId}: {minutes(operation === 'save_defaults' ? item.state?.default?.targetMinutes : item.state?.target.targetMinutes)} → {minutes(item.targetMinutes)} — {item.reason || item.action}</li>)}</ul>
      <button className={button} disabled={!preview.canConfirm || busy} onClick={() => void apply()}>Confirm reviewed changes</button>
      {!preview.canConfirm && <p>Resolve every blocked module before confirming.</p>}
    </section>}
    {outcome && <p role="status">Operation saved: {outcome.items.length} modules reviewed.</p>}
    <section aria-label="Operation history" className="space-y-3 rounded-xl border p-4">
      <h2 className="font-semibold">Your recent operations</h2>
      <button className={button} onClick={() => void loadHistory()}>Refresh history</button>
      {historyError ? <p role="alert">History unavailable. Retry with Refresh history.</p> : !history.length ? <p>No operations yet.</p> :
        history.map(item => <details key={item.operationId}><summary>{item.operation.replaceAll('_', ' ')} — {item.appliedAt}</summary>
          <ul>{item.items.map(row => <li key={row.moduleId}>{row.moduleId}: {minutes(row.before?.targetMinutes)} → {minutes(row.after?.targetMinutes)} ({row.action})</li>)}</ul>
        </details>)}
      {!historyError && historyCursor && <button className={button} onClick={() => void loadHistory(historyCursor)}>Older operations</button>}
    </section>
  </main>;
}
