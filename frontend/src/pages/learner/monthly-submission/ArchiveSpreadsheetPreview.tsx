import { useEffect, useState } from 'react';

type Preview = {
  files: string[]; notices: string[];
  documents: { name: string; text: string; sheets?: { name: string; rows: string[][] }[] }[];
};

export function ArchiveSpreadsheetPreview({ url }: { url: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null); setError(''); setSelected(0);
    fetch(url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Preview unavailable. Download the original file to view it.');
      const data = await response.json() as Preview;
      if (!controller.signal.aborted) setPreview(data);
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [url]);
  if (error) return <p role="alert" className="rounded-lg bg-white p-5 text-slate-900">{error}</p>;
  if (!preview) return <p role="status" className="rounded-lg bg-white p-5 text-slate-900">Loading preview…</p>;
  const name = preview.files[selected];
  const document = preview.documents.find(item => item.name === name);
  return <div className="space-y-4 rounded-lg bg-white p-5 text-slate-900">
    <label className="block text-sm font-semibold">File
      <select aria-label="Preview file" className="mt-2 block w-full rounded border p-2" value={selected} onChange={event => setSelected(Number(event.target.value))}>
        {preview.files.map((file, index) => <option key={index} value={index}>{file}</option>)}
      </select>
    </label>
    {preview.notices.map((notice, index) => <p key={index} className="text-sm text-amber-800">{notice}</p>)}
    {document?.sheets ? document.sheets.map((sheet, index) => <section key={index}>
      <h3 className="mb-2 font-semibold">{sheet.name}</h3>
      <div className="max-h-[55vh] overflow-auto rounded border">
        <table className="w-full border-collapse text-left text-sm" aria-label={sheet.name}><tbody>
          {sheet.rows.map((row, rowIndex) => <tr key={rowIndex} className="even:bg-slate-50">
            {row.map((cell, colIndex) => <td key={colIndex} className="min-w-24 whitespace-pre-wrap border p-2 align-top">{cell}</td>)}
          </tr>)}
        </tbody></table>
      </div>
      {!sheet.rows.length && <p>This sheet is empty.</p>}
    </section>) : document ? <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap font-sans text-sm leading-6">{document.text}</pre>
      : <p>Select a file to read its contents. Files without readable text remain available in the original download.</p>}
    <p className="text-xs text-slate-500">Content preview; original formatting, charts and images are available in the download.</p>
  </div>;
}
