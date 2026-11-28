import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { ArchivePreview } from './ArchivePreview';
import { openDocumentHtml, zipDocumentKind, readArchiveResponse } from './archiveDocument';
import { HtmlPreview } from './ContentPreview';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('lets the learner select and review original archive files inside the report', async () => {
  const zip = new JSZip().file('notes.txt', 'Original reflection <script>unsafe()</script>').file('folder/report.pdf', '%PDF-original');
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:archive-pdf');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const { unmount } = render(<ArchivePreview buffer={await zip.generateAsync({ type: 'arraybuffer' })} title="Evidence.zip" />);
  const text = await screen.findByTitle('notes.txt');
  expect(text.getAttribute('srcdoc')).toContain('Original reflection');
  expect(text.getAttribute('srcdoc')).not.toContain('<script>');
  fireEvent.change(screen.getByLabelText('Archive file'), { target: { value: 'folder/report.pdf' } });
  expect(await screen.findByTitle('folder/report.pdf')).toHaveAttribute('src', 'blob:archive-pdf');
  unmount(); expect(revoke).toHaveBeenCalledWith('blob:archive-pdf');
});

it('preserves OpenDocument paragraphs, tables and images in a script-free iframe', async () => {
  const zip = new JSZip().file('content.xml', `<office:document-content xmlns:office="urn:office" xmlns:text="urn:text" xmlns:table="urn:table" xmlns:draw="urn:draw" xmlns:xlink="urn:xlink"><office:body><office:text><text:h>Reflection</text:h><text:p>Original explanation</text:p><table:table><table:table-row><table:table-cell><text:p>Evidence</text:p></table:table-cell></table:table-row></table:table><draw:image xlink:href="Pictures/image.png"/></office:text></office:body></office:document-content>`).file('Pictures/image.png', new Uint8Array([137, 80, 78, 71]));
  const html = await openDocumentHtml(await zip.generateAsync({ type: 'arraybuffer' }));
  render(<HtmlPreview html={html} title="Evidence.odt" />);
  const frame = screen.getByTitle('Evidence.odt');
  expect(frame).toHaveAttribute('sandbox', '');
  expect(frame.getAttribute('srcdoc')).toContain('Original explanation');
  expect(frame.getAttribute('srcdoc')).toContain('<table>');
  expect(frame.getAttribute('srcdoc')).toContain('data:image/png;base64,');
});

it('reports an unreadable or empty archive without showing a successful preview', async () => {
  render(<ArchivePreview buffer={await new JSZip().generateAsync({ type: 'arraybuffer' })} title="Empty.zip" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('contains no files');
  expect(document.querySelector('iframe')).toBeNull();
});

it('recognizes a Word document even when the source omitted its filename extension and MIME type', async () => {
  const buffer = await new JSZip().file('word/document.xml', '<document/>').generateAsync({ type: 'arraybuffer' });
  expect(await zipDocumentKind(buffer)).toBe('docx');
});

it('stops an oversized archive before buffering its contents', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ cancel });
  const response = new Response(body, { headers: { 'content-length': String(60 * 1024 * 1024) } });
  await expect(readArchiveResponse(response)).rejects.toThrow('too large');
  expect(cancel).toHaveBeenCalledOnce();
});
