import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';

type Material = {
  video_url: string | null; audio_url: string | null; reading_url: string | null;
  reading_html: string | null; quiz_description: string | null;
  questions: { text: string; options: string[] }[];
};
function Html({ value }: { value: string }) {
  return <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value) }} />;
}
function Media({ value, label }: { value: string; label: string }) {
  let url: URL;
  try { url = new URL(value); } catch { return <p>Material link is unavailable.</p>; }
  if (!['https:', 'http:'].includes(url.protocol)) return <p>Material link is unavailable.</p>;
  return <section className="space-y-2">
    <h4 className="font-semibold">{label}</h4>
    {/\.(mp4|webm)$/i.test(url.pathname) ? <video controls src={url.href} className="max-h-[60vh] w-full" />
      : /\.(mp3|m4a|wav|oga)$/i.test(url.pathname) ? <audio controls src={url.href} className="w-full" />
        : <iframe title={label} src={url.href} className="h-[60vh] w-full rounded-xl border" sandbox="allow-scripts allow-same-origin allow-presentation" allow="fullscreen" allowFullScreen referrerPolicy="no-referrer" />}
    <a href={url.href} target="_blank" rel="noopener noreferrer" className="text-sm text-primary-700 underline">Open original if preview is unavailable</a>
  </section>;
}
export function StudentMaterial({ kind, learnerId, groupId, activityId }: {
  kind: string; learnerId: string; groupId: number; activityId: number;
}) {
  const [data, setData] = useState<Material | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError('');
    const query = new URLSearchParams({ group_id: String(groupId), activity_id: String(activityId) });
    void fetch(`/learner_api/student-activity/${kind}/${learnerId}/?${query}`, {
      credentials: 'include', cache: 'no-store', signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load material.');
      if (!controller.signal.aborted) setData(body);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load material.');
    });
    return () => controller.abort();
  }, [kind, learnerId, groupId, activityId, retry]);
  if (error) return <div role="alert">{error} <button onClick={() => setRetry((value) => value + 1)} className="underline">Try again</button></div>;
  if (!data) return <p role="status">Loading material…</p>;
  return <div className="space-y-5 p-4">
    {!(data.video_url || data.audio_url || data.reading_url || data.reading_html || data.quiz_description || data.questions.length) && <p>No material is available for this activity yet.</p>}
    {data.video_url && <Media value={data.video_url} label="Video" />}
    {data.audio_url && <Media value={data.audio_url} label="Audio" />}
    {data.reading_html && <Html value={data.reading_html} />}
    {data.reading_url && <Media value={data.reading_url} label="Reading material" />}
    {(data.quiz_description || data.questions.length > 0) && <section className="space-y-3">
      <h4 className="font-semibold">Quiz content — preview</h4>
      {data.quiz_description && <Html value={data.quiz_description} />}
      {data.questions.map((question, index) => <div key={index} className="space-y-2 rounded-xl border p-3">
        <p className="font-semibold">Question {index + 1}</p><Html value={question.text} />
        {question.options.map((option, optionIndex) => <div key={optionIndex} className="rounded border p-2"><Html value={option} /></div>)}
      </div>)}
    </section>}
  </div>;
}
