// Shared rich-text authoring surface for "component content" fields — a
// contentEditable design view backed by execCommand, plus a raw-HTML view.
// Extracted out of the Module Builder so other authoring surfaces (e.g. the
// Week Builder) can render the exact same editor.
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';

type RichTextMode = 'design' | 'html';

export function RichTextDraft({ label, value, onChange, rows = 9, compact = false }: { label: string; value: string; onChange: (value: string) => void; rows?: number; compact?: boolean }) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<RichTextMode>('design');
  const [fullscreen, setFullscreen] = useState(false);
  const lastHtmlRef = useRef(value || '');
  const placeholder = compact
    ? 'Briefly introduce what the learner will read.'
    : 'Use headings, short paragraphs, bold key terms, and bullet lists. You can paste prepared HTML here.';
  const plainText = htmlToPlainText(value);
  const wordCount = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;
  const minHeight = compact ? 'min-h-[220px]' : 'min-h-[360px]';

  useEffect(() => {
    if (mode !== 'design') return;
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    const next = value || '';
    // Compare against the DOM's actual content, not the last-committed ref —
    // on mount the div starts empty (no dangerouslySetInnerHTML — see below),
    // so this is what populates it the first time. Skipping that first sync
    // caused every keystroke to re-set innerHTML from scratch and reset the
    // caret to position 0, which typed each new character before the last —
    // the "reversed while typing" bug.
    if (editor.innerHTML === next) return;
    editor.innerHTML = next;
    lastHtmlRef.current = next;
  }, [mode, value]);

  const commitHtml = useCallback((html: string) => {
    lastHtmlRef.current = html;
    onChange(html);
  }, [onChange]);

  const syncFromEditor = useCallback(() => {
    const html = editorRef.current?.innerHTML || '';
    commitHtml(html);
  }, [commitHtml]);

  const focusEditor = () => {
    if (mode !== 'design') return;
    editorRef.current?.focus();
  };

  const runCommand = (command: string, commandValue?: string) => {
    if (mode !== 'design') return;
    focusEditor();
    document.execCommand(command, false, commandValue);
    syncFromEditor();
  };

  const insertHtml = (html: string) => {
    if (mode !== 'design') return;
    focusEditor();
    document.execCommand('insertHTML', false, html);
    syncFromEditor();
  };

  const addLink = () => {
    const url = window.prompt('Enter link URL');
    if (!url) return;
    runCommand('createLink', url);
  };

  const addImage = () => {
    const url = window.prompt('Enter image URL');
    if (!url) return;
    insertHtml(`<img src="${escapeAttribute(url)}" alt="" style="max-width:100%;height:auto;" />`);
  };

  const addVideo = () => {
    const url = window.prompt('Enter video URL');
    if (!url) return;
    insertHtml(`<video controls src="${escapeAttribute(url)}" style="max-width:100%;height:auto;"></video>`);
  };

  const pasteAsHtml = (event: ClipboardEvent<HTMLDivElement>) => {
    const html = event.clipboardData.getData('text/html');
    if (!html) return;
    event.preventDefault();
    insertHtml(html);
  };

  const shellClass = fullscreen
    ? 'fixed inset-4 z-[80] flex flex-col rounded-xl border border-foreground-200 bg-background-50 shadow-2xl'
    : 'mt-1 overflow-hidden rounded-lg border border-foreground-200/60 bg-background-50';

  return (
    <div className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase text-foreground-400">{label}</span>
        <div className="flex items-center gap-1 rounded-lg bg-background-100 p-0.5">
          <button type="button" onClick={() => setMode('design')} className={`rounded-md px-2 py-1 text-[10px] font-bold ${mode === 'design' ? 'bg-background-50 text-primary-700 shadow-sm' : 'text-foreground-500 hover:text-foreground-900'}`}>Design</button>
          <button type="button" onClick={() => setMode('html')} className={`rounded-md px-2 py-1 text-[10px] font-bold ${mode === 'html' ? 'bg-background-50 text-primary-700 shadow-sm' : 'text-foreground-500 hover:text-foreground-900'}`}>HTML</button>
        </div>
      </div>
      <div className={shellClass}>
        <div className="flex flex-wrap items-center gap-1 border-b border-background-200 bg-background-100/70 px-2 py-2 text-[11px] text-foreground-600">
          <RichSelect title="Block style" disabled={mode !== 'design'} defaultValue="P" onChange={tag => runCommand('formatBlock', tag)}>
            <option value="P">Paragraph</option>
            <option value="H1">Heading 1</option>
            <option value="H2">Heading 2</option>
            <option value="H3">Heading 3</option>
            <option value="BLOCKQUOTE">Quote</option>
          </RichSelect>
          <RichSelect title="Font" disabled={mode !== 'design'} defaultValue="" onChange={font => font && runCommand('fontName', font)}>
            <option value="">System Font</option>
            <option value="Arial">Arial</option>
            <option value="Georgia">Georgia</option>
            <option value="Times New Roman">Times</option>
            <option value="Courier New">Courier</option>
          </RichSelect>
          <RichSelect title="Size" disabled={mode !== 'design'} defaultValue="3" onChange={size => runCommand('fontSize', size)}>
            <option value="2">13px</option>
            <option value="3">16px</option>
            <option value="4">18px</option>
            <option value="5">24px</option>
            <option value="6">32px</option>
          </RichSelect>
          <RichToolbarDivider />
          <RichTool icon="ri-arrow-go-back-line" label="Undo" disabled={mode !== 'design'} onClick={() => runCommand('undo')} />
          <RichTool icon="ri-arrow-go-forward-line" label="Redo" disabled={mode !== 'design'} onClick={() => runCommand('redo')} />
          <RichToolbarDivider />
          <RichTool icon="ri-bold" label="Bold" disabled={mode !== 'design'} onClick={() => runCommand('bold')} />
          <RichTool icon="ri-italic" label="Italic" disabled={mode !== 'design'} onClick={() => runCommand('italic')} />
          <RichTool icon="ri-underline" label="Underline" disabled={mode !== 'design'} onClick={() => runCommand('underline')} />
          <RichTool icon="ri-strikethrough" label="Strikethrough" disabled={mode !== 'design'} onClick={() => runCommand('strikeThrough')} />
          <label title="Text color" className={`flex h-8 w-8 items-center justify-center rounded-md ${mode === 'design' ? 'cursor-pointer text-foreground-700 hover:bg-background-200' : 'pointer-events-none opacity-40'}`}>
            <i className="ri-font-color text-base"></i>
            <input type="color" className="sr-only" onChange={event => runCommand('foreColor', event.target.value)} />
          </label>
          <label title="Highlight" className={`flex h-8 w-8 items-center justify-center rounded-md ${mode === 'design' ? 'cursor-pointer text-foreground-700 hover:bg-background-200' : 'pointer-events-none opacity-40'}`}>
            <i className="ri-mark-pen-line text-base"></i>
            <input type="color" className="sr-only" onChange={event => runCommand('hiliteColor', event.target.value)} />
          </label>
          <RichToolbarDivider />
          <RichTool icon="ri-link" label="Link" disabled={mode !== 'design'} onClick={addLink} />
          <RichTool icon="ri-image-line" label="Image" disabled={mode !== 'design'} onClick={addImage} />
          <RichTool icon="ri-video-line" label="Video" disabled={mode !== 'design'} onClick={addVideo} />
          <RichTool icon="ri-separator" label="Divider" disabled={mode !== 'design'} onClick={() => insertHtml('<hr />')} />
          <RichToolbarDivider />
          <RichTool icon="ri-align-left" label="Align left" disabled={mode !== 'design'} onClick={() => runCommand('justifyLeft')} />
          <RichTool icon="ri-align-center" label="Align center" disabled={mode !== 'design'} onClick={() => runCommand('justifyCenter')} />
          <RichTool icon="ri-align-right" label="Align right" disabled={mode !== 'design'} onClick={() => runCommand('justifyRight')} />
          <RichTool icon="ri-list-unordered" label="Bullet list" disabled={mode !== 'design'} onClick={() => runCommand('insertUnorderedList')} />
          <RichTool icon="ri-list-ordered" label="Numbered list" disabled={mode !== 'design'} onClick={() => runCommand('insertOrderedList')} />
          <RichTool icon="ri-indent-increase" label="Indent" disabled={mode !== 'design'} onClick={() => runCommand('indent')} />
          <RichTool icon="ri-indent-decrease" label="Outdent" disabled={mode !== 'design'} onClick={() => runCommand('outdent')} />
          <RichTool icon="ri-format-clear" label="Clear formatting" disabled={mode !== 'design'} onClick={() => runCommand('removeFormat')} />
          <RichTool icon={fullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'} label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => setFullscreen(open => !open)} />
          <span className="ml-auto rounded-full bg-background-200 px-2 py-0.5 text-[10px] font-bold text-foreground-500">{wordCount} words</span>
        </div>
        {mode === 'design' ? (
          <div className="relative">
            {!plainText && (
              <span className="pointer-events-none absolute left-4 top-4 text-[13px] text-foreground-300">{placeholder}</span>
            )}
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={syncFromEditor}
              onBlur={syncFromEditor}
              onPaste={pasteAsHtml}
              className={`rich-text-surface ${minHeight} max-h-[70vh] overflow-y-auto bg-background-50 px-4 py-4 text-[14px] leading-relaxed text-foreground-900 outline-none`}
            />
          </div>
        ) : (
          <textarea
            value={value}
            onChange={event => commitHtml(event.target.value)}
            rows={rows}
            className={`${minHeight} max-h-[70vh] w-full resize-y bg-[#0f172a] px-4 py-3 font-mono text-[12px] leading-relaxed text-[#e2e8f0] outline-none`}
            placeholder="<h2>Section heading</h2><p>Paste prepared HTML here...</p>"
          />
        )}
        <div className="border-t border-background-200 bg-background-100/70 px-3 py-1.5 text-[10px] font-semibold text-foreground-400">
          {mode === 'design' ? 'p' : 'HTML source'}
        </div>
      </div>
    </div>
  );
}

function RichTool({ icon, label, onClick, disabled = false }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-700 transition-smooth hover:bg-background-200 hover:text-foreground-950 disabled:pointer-events-none disabled:opacity-35"
    >
      <i className={`${icon} text-base`}></i>
    </button>
  );
}

function RichSelect({ title, defaultValue, onChange, disabled, children }: { title: string; defaultValue: string; onChange: (value: string) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <select
      title={title}
      defaultValue={defaultValue}
      disabled={disabled}
      onMouseDown={event => event.stopPropagation()}
      onChange={event => onChange(event.target.value)}
      className="h-8 rounded-md border border-transparent bg-background-50 px-2 text-[12px] font-semibold text-foreground-700 outline-none hover:border-background-200 disabled:opacity-40"
    >
      {children}
    </select>
  );
}

function RichToolbarDivider() {
  return <span className="mx-1 h-6 w-px bg-background-200" />;
}

function htmlToPlainText(html: string) {
  if (!html) return '';
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const element = document.createElement('div');
  element.innerHTML = html;
  return (element.textContent || element.innerText || '').trim();
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
