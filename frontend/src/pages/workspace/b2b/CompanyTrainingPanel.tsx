import { useCallback, useEffect, useState } from 'react';
import { getCompanyTraining, saveCompanyTrainingRule, listBreatheConnections, type CompanyTraining } from '@/api/breatheIntegration';
import { Modal } from '@/pages/users/components/Modal';

export function CompanyTrainingPanel({ hr }: { hr: boolean }) {
  const [data, setData] = useState<CompanyTraining | null>(null);
  const [connectionId, setConnectionId] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [department, setDepartment] = useState('');
  const [modules, setModules] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      const connections = await listBreatheConnections();
      if (connections.results.length !== 1) throw new Error('Select a single company Breathe connection before managing training.');
      const id = connections.results[0].id;
      setConnectionId(id);
      setData(await getCompanyTraining(id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load training.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const close = () => { if (!saving) { setOpen(false); setReview(false); } };
  const save = async () => {
    setSaving(true); setError('');
    try { await saveCompanyTrainingRule(connectionId, department, modules); await load(); setOpen(false); setReview(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save rule.'); }
    finally { setSaving(false); }
  };
  const matches = data?.employees.filter(p => (p.departmentId || '__unassigned__') === department) ?? [];
  return <section className="space-y-5 rounded-2xl border border-foreground-100 bg-white p-6">
    <div className="flex items-center justify-between gap-4"><div><h2 className="text-lg font-bold">Department training rules</h2><p className="mt-1 text-sm">Associate Project Manager ? Demo modules. Training data below is synthetic and stays inside LMS.</p></div>
      {hr && <button className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white" disabled={!data} onClick={() => { setOpen(true); setReview(false); setError(''); }}>Create training rule</button>}</div>
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    {!data && !error && <p role="status">Loading company training?</p>}
    {data && <>
      <h3 className="font-semibold">Saved rules ({data.rules.length})</h3>
      {data.rules.map(rule => <div className="rounded-lg border p-3" key={rule.id}><strong>{data.departments.find(d => d.id === rule.departmentId)?.name}</strong><p className="text-sm">{rule.moduleIds.map(id => data.modules.find(m => m.id === id)?.name).join(' ? ')}</p></div>)}
      <h3 className="font-semibold">Employee training ? Demo</h3>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Employee / department', 'Module', 'Progress', 'Hours', 'KSBs', 'Submitted assignments', 'Activities', 'Average grade', 'Last activity'].map(t => <th className="p-3" key={t}>{t}</th>)}</tr></thead><tbody>
        {data.employees.flatMap(p => p.allocations.map(a => { const m = data.modules.find(m => m.id === a.moduleId); return <tr className="border-t" key={`${p.id}-${a.moduleId}`}><td className="p-3">{p.name}<small className="block">{p.department}</small></td><td className="p-3">{m?.name}<small className="block text-amber-700">Demo</small></td><td className="p-3">{a.metrics.progress ?? 0}%</td><td className="p-3">{a.metrics.hours ?? 0} / {m?.plannedHours}</td><td className="p-3">{a.metrics.ksbs ?? 0} / {m?.ksbs}</td><td className="p-3">{a.metrics.assignments ?? 0}</td><td className="p-3">{a.metrics.activities ?? 0}%</td><td className="p-3">{a.metrics.grade == null ? 'Not graded' : `${a.metrics.grade}%`}</td><td className="p-3">{a.metrics.lastActivity ?? 'Not started'}</td></tr>; }))}
      </tbody></table></div>
      {!data.employees.some(p => p.allocations.length) && <p>No training assigned yet.</p>}
    </>}
    {open && data && <Modal title={review ? 'Confirm training rule' : 'Create training rule'} onClose={close} dismissible={!saving}>
      <div className="space-y-4 p-4">
        {!review ? <><label className="block">Department<select aria-label="Department" className="mt-2 block w-full rounded border p-2" value={department} onChange={e => { setDepartment(e.target.value); const rule = data.rules.find(r => r.departmentId === e.target.value); setModules(rule?.moduleIds ?? []); }}><option value="">Select department</option>{data.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <fieldset><legend>Demo modules</legend>{data.modules.map(m => <label className="mt-3 flex gap-2" key={m.id}><input type="checkbox" checked={modules.includes(m.id)} onChange={e => setModules(ids => e.target.checked ? [...ids, m.id] : ids.filter(id => id !== m.id))} />{m.name}</label>)}</fieldset>
          <button className="rounded bg-primary-700 p-3 text-white disabled:opacity-40" disabled={!department || !modules.length} onClick={() => setReview(true)}>Review allocation</button></> : <>
          <p>{modules.length} demo modules will be assigned to {matches.length} employees in {data.departments.find(d => d.id === department)?.name}. Future imported employees in this department receive this rule. Existing progress is retained.</p>
          <ul>{matches.map(p => <li key={p.id}>{p.name}</li>)}</ul>
          <button disabled={saving} onClick={() => setReview(false)} className="mr-3 rounded border p-3">Back</button><button disabled={saving} onClick={() => void save()} className="rounded bg-primary-700 p-3 text-white">{saving ? 'Saving?' : 'Confirm and apply'}</button>
        </>}
        {error && <p role="alert" className="text-rose-700">{error}</p>}
      </div>
    </Modal>}
  </section>;
}
