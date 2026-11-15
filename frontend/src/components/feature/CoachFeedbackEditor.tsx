import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Bold, Italic, List, ListOrdered, Maximize2, Minimize2, Redo2, RemoveFormatting, Underline, Undo2 } from 'lucide-react';
import { feedbackHtmlToPlainText, normalizeFeedbackHtml, sanitizeFeedbackHtml } from '@/lib/feedbackHtml';
import styles from './CoachFeedbackEditor.module.css';

interface CoachFeedbackEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/** A small, dependency-free rich editor for coach feedback. */
export function CoachFeedbackEditor({ value, onChange, disabled = false, placeholder = 'Write clear, actionable feedback for the learner…' }: CoachFeedbackEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValue = useRef('');
  const savedSelection = useRef<Range | null>(null);
  const [active, setActive] = useState({ bold: false, italic: false, underline: false, unordered: false, ordered: false });
  const [expanded, setExpanded] = useState(false);

  const refreshToolbar = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) return;
    const state = (command: string) => typeof document.queryCommandState === 'function' && document.queryCommandState(command);
    setActive({
      bold: state('bold'),
      italic: state('italic'),
      underline: state('underline'),
      unordered: state('insertUnorderedList'),
      ordered: state('insertOrderedList'),
    });
  }, []);

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editorRef.current?.contains(selection.anchorNode)) savedSelection.current = selection.getRangeAt(0).cloneRange();
  };

  const restoreSelection = () => {
    const selection = window.getSelection();
    if (!selection || !savedSelection.current) return;
    selection.removeAllRanges();
    selection.addRange(savedSelection.current);
  };

  useEffect(() => {
    const next = normalizeFeedbackHtml(value);
    if (next === lastValue.current) return;
    lastValue.current = next;
    if (editorRef.current && editorRef.current.innerHTML !== next) editorRef.current.innerHTML = next;
  }, [value]);

  useEffect(() => {
    document.addEventListener('selectionchange', refreshToolbar);
    return () => document.removeEventListener('selectionchange', refreshToolbar);
  }, [refreshToolbar]);

  useEffect(() => {
    if (!expanded) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [expanded]);

  const emit = () => {
    const html = sanitizeFeedbackHtml(editorRef.current?.innerHTML || '');
    lastValue.current = html;
    onChange(html);
    refreshToolbar();
  };

  const command = (name: string, argument?: string) => {
    if (disabled) return;
    editorRef.current?.focus();
    restoreSelection();
    if (typeof document.execCommand === 'function') document.execCommand(name, false, argument);
    emit();
    rememberSelection();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'b' || key === 'i' || key === 'u') {
      event.preventDefault();
      command(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
    } else if (key === 'z') {
      event.preventDefault();
      command(event.shiftKey ? 'redo' : 'undo');
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (typeof document.execCommand === 'function') document.execCommand('insertText', false, text);
    emit();
  };

  return <>
    {expanded && <button type="button" className={styles.backdrop} aria-label="Close expanded feedback editor" onClick={() => setExpanded(false)} />}
    <div className={`${styles.editorShell} ${expanded ? styles.editorShellExpanded : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? 'Expanded coach feedback editor' : undefined}>
    <div className={styles.toolbar} role="toolbar" aria-label="Feedback formatting">
      <div className={styles.toolbarGroup} aria-label="History">
        <button type="button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={disabled} onMouseDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => command('undo')}><Undo2 size={15} aria-hidden="true" /></button>
        <button type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={disabled} onMouseDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => command('redo')}><Redo2 size={15} aria-hidden="true" /></button>
      </div>
      <span className={styles.divider} aria-hidden="true" />
      <label className={styles.selectControl}>
        <span className="sr-only">Text style</span>
        <select aria-label="Text style" defaultValue="" disabled={disabled} onFocus={rememberSelection} onChange={event => { command('formatBlock', event.target.value); event.currentTarget.value = ''; }}>
          <option value="" disabled>Style</option><option value="p">Paragraph</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option>
        </select>
      </label>
      <label className={styles.selectControl}>
        <span className="sr-only">Font size</span>
        <select aria-label="Font size" defaultValue="" disabled={disabled} onFocus={rememberSelection} onChange={event => { command('fontSize', event.target.value); event.currentTarget.value = ''; }}>
          <option value="" disabled>Size</option><option value="2">Small</option><option value="3">Normal</option><option value="5">Large</option>
        </select>
      </label>
      <span className={styles.divider} aria-hidden="true" />
      <div className={styles.toolbarGroup} aria-label="Text formatting">
        <button type="button" title="Bold (Ctrl+B)" aria-label="Bold" aria-pressed={active.bold} disabled={disabled} onMouseDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => command('bold')}><Bold size={15} aria-hidden="true" /></button>
        <button type="button" title="Italic (Ctrl+I)" aria-label="Italic" aria-pressed={active.italic} disabled={disabled} onMouseDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => command('italic')}><Italic size={15} aria-hidden="true" /></button>
        <button type="button" title="Underline (Ctrl+U)" aria-label="Underline" aria-pressed={active.underline} disabled={disabled} onMouseDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => command('underline')}><Underline size={15} aria-hidden="true" /></button>
      </div>
      <span className={styles.divider} aria-hidden="true" />
      <div className={styles.toolbarGroup} aria-label="Lists and cleanup">
        <button type="button" title="Bulleted list" aria-label="Bulleted list" aria-pressed={active.unordered} disabled={disabled} onMouseDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => command('insertUnorderedList')}><List size={15} aria-hidden="true" /></button>
        <button type="button" title="Numbered list" aria-label="Numbered list" aria-pressed={active.ordered} disabled={disabled} onMouseDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => command('insertOrderedList')}><ListOrdered size={15} aria-hidden="true" /></button>
        <button type="button" title="Clear formatting" aria-label="Clear formatting" disabled={disabled} onMouseDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => command('removeFormat')}><RemoveFormatting size={15} aria-hidden="true" /></button>
      </div>
      <span className={styles.toolbarSpacer} aria-hidden="true" />
      <button type="button" className={styles.expandButton} title={expanded ? 'Collapse editor (Esc)' : 'Expand editor'} aria-label={expanded ? 'Collapse editor' : 'Expand editor'} aria-expanded={expanded} disabled={disabled} onClick={() => setExpanded(value => !value)}>
        {expanded ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
        <span>{expanded ? 'Collapse' : 'Expand'}</span>
      </button>
    </div>
    <div
      ref={editorRef}
      className={styles.editor}
      role="textbox"
      aria-label="Review feedback editor"
      aria-multiline="true"
      contentEditable={!disabled}
      data-placeholder={placeholder}
      suppressContentEditableWarning
      onInput={emit}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
      onSelect={refreshToolbar}
      onFocus={refreshToolbar}
    />
    <div className={styles.editorFooter}><span>{feedbackHtmlToPlainText(value).split(/\s+/).filter(Boolean).length.toLocaleString()} words</span><span>Formatting is applied to the learner feedback</span></div>
    {/* Kept in the DOM as a plain-text compatibility surface for older form
        automation and screen-reader fallback. The rich editor above is the
        interactive control; this value is never submitted separately. */}
    <textarea
      className={styles.compatibilityValue}
      aria-label="Review feedback"
      aria-hidden="true"
      placeholder={placeholder}
      value={feedbackHtmlToPlainText(value)}
      onChange={event => onChange(event.target.value)}
      disabled={disabled}
      tabIndex={-1}
    />
    </div>
  </>;
}
