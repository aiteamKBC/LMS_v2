import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HtmlPreview, ProtectedFilePreview, QuizPreview, SourcePreview } from './ContentPreview';
import { contentUrl } from './report';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('rejects executable URLs and embeds Google content in its preview form', () => {
  expect(contentUrl('javascript:alert(1)')).toBeNull();
  expect(contentUrl('data:text/html,test')).toBeNull();
  expect(contentUrl('https://user:secret@example.org')).toBeNull();
  render(<SourcePreview url="https://drive.google.com/file/d/abc/view" html={null} title="Reading" />);
  expect(screen.getByTitle('Reading')).toHaveAttribute('src', 'https://drive.google.com/file/d/abc/preview');
});

it('renders an extensionless PDF without the Office wrapper or plugin-blocking sandbox', () => {
  render(<SourcePreview url="https://kentbusinesscollege.org/material/99/view?token=test" html={null} contentType="application/pdf" title="PDF material" />);
  const frame = screen.getByTitle('PDF material');
  expect(frame).toHaveAttribute('src', 'https://kentbusinesscollege.org/material/99/view?token=test');
  expect(frame).not.toHaveAttribute('sandbox');
});

it('allows Office to submit its viewer bootstrap without enabling forms on other sources', () => {
  const { rerender } = render(<SourcePreview url="https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fexample.org%2Fslides.pptx" html={null} title="Office" />);
  expect(screen.getByTitle('Office').getAttribute('sandbox')).toContain('allow-forms');
  rerender(<SourcePreview url="https://example.org/player" html={null} title="Player" />);
  expect(screen.getByTitle('Player').getAttribute('sandbox')).not.toContain('allow-forms');
});

it('renders authored HTML inside a script-free sandbox', () => {
  render(<HtmlPreview title="Reading" html='<p>Lesson</p><script>alert(1)</script><img src="x" onerror="alert(1)"><iframe src="https://example.org"></iframe>' />);
  const frame = screen.getByTitle('Reading');
  expect(frame).toHaveAttribute('sandbox', '');
  const html = frame.getAttribute('srcdoc')!;
  expect(html).toContain('<p>Lesson</p>');
  expect(html).not.toMatch(/<script|onerror|<iframe/);
});

it('shows the saved quiz questions and the learner answers in a read-only iframe', () => {
  render(<QuizPreview title="Part3" quiz={{ state: 'attempted', attempt: {
    title: 'Part3', status: 'passed', score: 100, maximum_score: 100, attempt_number: 1,
    quiz_body: { description: null, questions: [{ question_id: 1, question_order: 1, question_text: '<p>What is the project goal?</p><script>alert(1)</script>',
      question_type: 'single_choice', is_correct: true, correct_answers: ['Deliver value'], learner_selected_answers: ['Deliver value'], answer_options: [] }] },
  } }} />);
  const frame = screen.getByTitle('Saved quiz attempt: Part3');
  expect(frame).toHaveAttribute('sandbox', '');
  expect(frame.getAttribute('srcdoc')).toContain('What is the project goal?');
  expect(frame.getAttribute('srcdoc')).toContain('Deliver value');
  expect(frame.getAttribute('srcdoc')).not.toContain('<script>');
  expect(screen.queryByText('No embedded content is available for this activity.')).not.toBeInTheDocument();
});

it('does not present a score without questions as a reviewable quiz', () => {
  render(<QuizPreview title="Quiz" quiz={{ state: 'attempted', attempt: { title: 'Quiz', status: 'passed', score: 100,
    maximum_score: 100, attempt_number: 1, quiz_body: { description: null, questions: [] } } }} />);
  expect(screen.getByRole('alert')).toHaveTextContent('questions and answers are unavailable');
  expect(document.querySelector('iframe')).toBeNull();
});

it('previews source quiz questions separately when the learner attempt is missing', () => {
  render(<QuizPreview title="Original quiz" quiz={{ state: 'not_attempted', attempt: null, answers_available: false,
    definition: { description: '<p>Review these questions</p>', questions: [{ question_id: 1, question_order: 1,
      question_text: '<p>Which diagram applies?</p><img src="https://example.org/diagram.png" onerror="alert(1)">',
      answer_options: [{ option_text: 'Option one' }] }] } }} />);
  const frame = screen.getByTitle('Original quiz questions: Original quiz');
  expect(frame.getAttribute('srcdoc')).toContain('Which diagram applies?');
  expect(frame.getAttribute('srcdoc')).toContain('diagram.png');
  expect(frame.getAttribute('srcdoc')).toContain('Option one');
  expect(frame.getAttribute('srcdoc')).not.toMatch(/onerror|Your answer|Correct answer|passed/);
  expect(screen.getByRole('alert')).toHaveTextContent('do not replace the missing attempt');
});

it('previews private PDFs using an authenticated fetch and releases the local URL', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(new Blob(['pdf']), { headers: { 'Content-Type': 'application/pdf' } }));
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private-preview');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const { unmount } = render(<ProtectedFilePreview file={{ id: 3, display_name: 'Evidence.pdf', content_type: 'application/pdf', url: '/audit_api/old-otjh/documents/3/?aptem_id=42' }} />);
  expect(await screen.findByTitle('Evidence.pdf')).toHaveAttribute('src', 'blob:private-preview');
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/audit_api/old-otjh/documents/3/?aptem_id=42'), expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
  unmount(); expect(revoke).toHaveBeenCalledWith('blob:private-preview');
});

it('does not forward authenticated file fetches to an external URL', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  render(<ProtectedFilePreview file={{ id: 3, display_name: 'Evidence.pdf', content_type: 'application/pdf', url: 'https://external.example/Evidence.pdf' }} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('This document link is unavailable.');
  expect(fetch).not.toHaveBeenCalled();
});

it('uses the authorized Office preview for a private presentation', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: 'https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fexample.org%2Ftest.pptx' }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  render(<ProtectedFilePreview file={{ id: 3, display_name: 'Slides.pptx', content_type: null, url: '/audit_api/old-otjh/documents/3/?aptem_id=42' }} />);
  expect(await screen.findByTitle('Slides.pptx')).toHaveAttribute('src', expect.stringContaining('https://view.officeapps.live.com/op/embed.aspx'));
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('preview=office'), expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
});

it('renders a restored source reflection inside an iframe without executing its text', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Reflection <script>alert(1)</script>', { headers: { 'Content-Type': 'text/plain' } })));
  render(<ProtectedFilePreview file={{ id: -5, display_name: 'Reflection.txt', content_type: 'text/plain', url: '/audit_api/old-otjh/source-documents/3/88/note/?aptem_id=42' }} />);
  const frame = await screen.findByTitle('Reflection.txt');
  expect(frame).toHaveAttribute('sandbox', '');
  expect(frame.getAttribute('srcdoc')).toContain('Reflection');
  expect(frame.getAttribute('srcdoc')).not.toContain('<script>');
});

it('renders an authorized saved material file inside the report', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(new Blob(['%PDF-original']), { headers: { 'Content-Type': 'application/pdf' } }));
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:original-material');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  render(<ProtectedFilePreview file={{ id: 99, display_name: 'Original reading.pdf', content_type: 'application/pdf', url: '/audit_api/old-otjh/material-documents/3/99/?month=2026-07&aptem_id=42' }} />);
  expect(await screen.findByTitle('Original reading.pdf')).toHaveAttribute('src', 'blob:original-material');
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/material-documents/3/99/'), expect.objectContaining({ credentials: 'include' }));
});
