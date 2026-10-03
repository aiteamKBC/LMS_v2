import { useRef, useState } from 'react';
import styles from './AssignmentTopicsEditor.module.css';
import { RichTextDraft } from '../module-builder/RichTextEditor';
import { assignmentTopics, ASSIGNMENT_RESOURCE_ACCEPT, topicLabel, type AssignmentTopic, type AssignmentTopicResource } from '@/lib/assignmentTopics';

export function AssignmentTopicsEditor({ value, legacyQuestion = '', legacyInstructions = '', legacyResources = [], onChange, onUpload }: {
  value: unknown;
  legacyQuestion?: string;
  legacyInstructions?: string;
  legacyResources?: AssignmentTopicResource[];
  onChange: (value: string) => void;
  onUpload: (file: File) => Promise<AssignmentTopicResource>;
}) {
  const configured = assignmentTopics(value);
  const topics = configured.length ? configured : assignmentTopics([{ id: '1', question: legacyQuestion, instructions: legacyInstructions, resources: legacyResources }]);
  const [selected, setSelected] = useState('1');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(topics);
  latest.current = topics;
  const topic = topics.find(item => item.id === selected)!;
  const update = (id: string, patch: Partial<AssignmentTopic>) => {
    const next = latest.current.map(item => item.id === id ? { ...item, ...patch } : item);
    latest.current = next;
    onChange(JSON.stringify(next));
  };
  const upload = async (files: File[]) => {
    const id = selected;
    setUploading(true); setError('');
    try {
      for (const file of files) {
        const resource = await onUpload(file);
        update(id, { resources: [...latest.current.find(item => item.id === id)!.resources, resource] });
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not upload the resource. Please retry.'); }
    finally { setUploading(false); }
  };
  return <section className="space-y-4 rounded-xl border border-background-200 bg-white p-4">
    <div><h3 className="text-sm font-bold">Assignment topics</h3><p className="mt-1 text-xs text-foreground-500">Learners submit one topic at a time. One submitted topic completes the assignment. Planned hours apply once to the whole component.</p></div>
    <div className={`${styles.topicTabs} flex flex-wrap gap-2`} role="tablist" aria-label="Assignment topics">
      {topics.map(item => <button key={item.id} type="button" role="tab" aria-selected={selected === item.id} disabled={uploading} onClick={() => setSelected(item.id)} className={`${styles.topicTab} rounded-lg border px-3 py-2 text-sm ${selected === item.id ? 'border-primary-600 bg-primary-600 text-white' : 'border-background-200'}`}>{topicLabel(item)}</button>)}
    </div>
    <div role="tabpanel" aria-label={`Topic ${selected}`} className="space-y-3">
      <label className="block text-sm">Topic name (optional)<input value={topic.name} onChange={e => update(selected, { name: e.target.value })} className="mt-1 block w-full rounded-lg border p-2" /></label>
      <div role="group" aria-label="Assignment question"><RichTextDraft key={selected} label="Assignment question" compact value={topic.question} onChange={question => update(selected, { question })} /></div>
      <label className="block text-sm">Instructions<textarea rows={4} value={topic.instructions} onChange={e => update(selected, { instructions: e.target.value })} className="mt-1 block w-full rounded-lg border p-2" /></label>
      <label className="block text-sm">Files and videos<input type="file" multiple accept={ASSIGNMENT_RESOURCE_ACCEPT} disabled={uploading} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; void upload(files); }} className="mt-1 block w-full text-sm" /></label>
      {uploading && <p role="status" className="text-sm">Uploading…</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <ul className="space-y-2">{topic.resources.map((resource, index) => <li key={`${resource.url}:${index}`} className="flex items-center justify-between gap-3 rounded-lg border p-2 text-sm"><a href={resource.url} target="_blank" rel="noreferrer">{resource.fileName}</a><button type="button" disabled={uploading} onClick={() => update(selected, { resources: topic.resources.filter((_, i) => i !== index) })} aria-label={`Remove ${resource.fileName}`} className="text-red-700">Remove</button></li>)}</ul>
    </div>
  </section>;
}
