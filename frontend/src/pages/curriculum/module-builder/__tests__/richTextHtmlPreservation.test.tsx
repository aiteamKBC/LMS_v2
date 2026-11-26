import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import { RichTextDraft } from '../RichTextEditor';

// The app auto-imports AppIcon; the editor's toolbar needs it in a test too.
beforeEach(() => vi.stubGlobal('AppIcon', AppIcon));

/**
 * The stored HTML is what was saved. Opening a component, clicking into its
 * content and out again, or switching Design/HTML must not re-save the
 * browser's re-serialisation of it -- only a real edit commits.
 */

// Deliberately not in the browser's own serialisation: self-closing <br/>,
// single quotes, an entity, a plain-text line break and inline styles.
const STORED = "<h2 class='title'>Week 1</h2><p>Line one<br/>line two &amp; more</p>\n"
  + "<ol><li>First</li></ol><p><a href='/curriculum_api/curriculum/uploads/notes.pdf' target='_blank'>Notes (PDF)</a></p>"
  + '<table><tr><td style="color:red">Cell</td></tr></table>';

function Harness({ initial, onChange, htmlOnly = false }: { initial: string; onChange: (value: string) => void; htmlOnly?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <RichTextDraft label="Component content" value={value} htmlOnly={htmlOnly}
        onChange={next => { onChange(next); setValue(next); }} />
      <output data-testid="stored">{value}</output>
    </>
  );
}

const editorOf = (container: HTMLElement) => container.querySelector('[contenteditable]') as HTMLDivElement;

describe('RichTextDraft keeps stored HTML exactly as saved', () => {
  it('opening, focusing and leaving the editor commits nothing', () => {
    const onChange = vi.fn();
    const { container } = render(<Harness initial={STORED} onChange={onChange} />);
    const editor = editorOf(container);
    // Shown formatted, not as raw tags.
    expect(editor.querySelector('h2')?.textContent).toBe('Week 1');
    expect(editor.querySelector('ol li')?.textContent).toBe('First');
    expect(editor.querySelector('a')?.getAttribute('href')).toBe('/curriculum_api/curriculum/uploads/notes.pdf');
    act(() => { editor.focus(); });
    act(() => { fireEvent.blur(editor); });
    act(() => { editor.focus(); fireEvent.input(editor); fireEvent.blur(editor); });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('stored').textContent).toBe(STORED);
  });

  it('commits a real edit, and an undo back to the start restores the stored bytes', () => {
    const onChange = vi.fn();
    const { container } = render(<Harness initial={STORED} onChange={onChange} />);
    const editor = editorOf(container);
    const original = editor.innerHTML;
    act(() => { editor.focus(); });
    act(() => {
      editor.querySelector('ol')!.insertAdjacentHTML('beforeend', '<li>Second</li>');
      fireEvent.input(editor);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain('<li>Second</li>');
    expect(onChange.mock.calls[0][0]).toContain('href="/curriculum_api/curriculum/uploads/notes.pdf"');
    act(() => {
      editor.innerHTML = original; // what the browser's undo puts back
      fireEvent.input(editor);
    });
    expect(onChange).toHaveBeenLastCalledWith(STORED);
    expect(screen.getByTestId('stored').textContent).toBe(STORED);
  });

  it('switching Design -> HTML -> Design shows the stored source and changes nothing', () => {
    const onChange = vi.fn();
    const { container } = render(<Harness initial={STORED} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'HTML' }));
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe(STORED);
    fireEvent.click(screen.getByRole('button', { name: 'Design' }));
    const editor = editorOf(container);
    expect(editor.querySelector('h2')?.textContent).toBe('Week 1');
    act(() => { editor.focus(); fireEvent.blur(editor); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the HTML source view saves exactly what was typed', () => {
    const onChange = vi.fn();
    const { container } = render(<Harness initial="" onChange={onChange} htmlOnly />);
    const typed = "<h2>Intro</h2><p>See <a href='/curriculum_api/curriculum/uploads/a.docx'>the brief</a>.</p>";
    fireEvent.change(container.querySelector('textarea')!, { target: { value: typed } });
    expect(onChange).toHaveBeenLastCalledWith(typed);
    expect(screen.getByTestId('stored').textContent).toBe(typed);
  });

  it('plain-text content is not rewritten as HTML by opening it', () => {
    const onChange = vi.fn();
    const plain = 'Read chapter 2 & 3.\nThen answer < 5 questions.';
    const { container } = render(<Harness initial={plain} onChange={onChange} />);
    const editor = editorOf(container);
    act(() => { editor.focus(); fireEvent.blur(editor); });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('stored').textContent).toBe(plain);
  });
});

describe('RichTextDraft never runs stored HTML in the author session', () => {
  it('drops handlers and scripts from the design surface, without touching the stored value', () => {
    const fired = vi.fn();
    (window as unknown as { __fired: () => void }).__fired = fired;
    const hostile = '<p>Safe text</p><img src="x" onerror="window.__fired()"><script>window.__fired()</script>'
      + '<a href="javascript:window.__fired()">bad</a><iframe srcdoc="<b>x</b>"></iframe>';
    const onChange = vi.fn();
    const { container } = render(<Harness initial={hostile} onChange={onChange} />);
    const editor = editorOf(container);
    expect(editor.textContent).toContain('Safe text');
    expect(editor.querySelector('script')).toBeNull();
    expect(editor.querySelector('[onerror]')).toBeNull();
    expect(editor.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(editor.querySelector('[srcdoc]')).toBeNull();
    act(() => { editor.focus(); fireEvent.blur(editor); });
    expect(fired).not.toHaveBeenCalled();
    // Not edited, so nothing is saved -- the stored value is the author's to fix.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('sanitises pasted HTML before it is inserted', () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    const { container } = render(<Harness initial="<p>x</p>" onChange={vi.fn()} />);
    const editor = editorOf(container);
    act(() => { editor.focus(); });
    fireEvent.paste(editor, { clipboardData: { getData: (type: string) => (type === 'text/html' ? '<p onclick="x()">Pasted <strong>bold</strong></p><script>x()</script>' : '') } });
    expect(execCommand).toHaveBeenCalledWith('insertHTML', false, '<p>Pasted <strong>bold</strong></p>');
  });
});
