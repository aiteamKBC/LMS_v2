import { useEffect, useRef, type ClipboardEvent } from 'react';
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

  useEffect(() => {
    const next = normalizeFeedbackHtml(value);
    if (next === lastValue.current) return;
    lastValue.current = next;
    if (editorRef.current && editorRef.current.innerHTML !== next) editorRef.current.innerHTML = next;
  }, [value]);

  const emit = () => {
    const html = sanitizeFeedbackHtml(editorRef.current?.innerHTML || '');
    lastValue.current = html;
    onChange(html);
  };

  const command = (name: string, argument?: string) => {
    if (disabled) return;
    editorRef.current?.focus();
    if (typeof document.execCommand === 'function') document.execCommand(name, false, argument);
    emit();
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (typeof document.execCommand === 'function') document.execCommand('insertText', false, text);
    emit();
  };

  return <div className={styles.editorShell}>
    <div className={styles.toolbar} role="toolbar" aria-label="Feedback formatting">
      <button type="button" title="Bold" aria-label="Bold" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command('bold')}><strong>B</strong></button>
      <button type="button" title="Small text" aria-label="Small text" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command('fontSize', '2')}>A−</button>
      <button type="button" title="Normal text" aria-label="Normal text" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command('fontSize', '3')}>A</button>
      <button type="button" title="Large text" aria-label="Large text" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command('fontSize', '5')}>A+</button>
      <span className={styles.divider} aria-hidden="true" />
      <button type="button" title="Heading 2" aria-label="Heading 2" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command('formatBlock', 'h2')}>H2</button>
      <button type="button" title="Heading 3" aria-label="Heading 3" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command('formatBlock', 'h3')}>H3</button>
      <button type="button" title="Bulleted list" aria-label="Bulleted list" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command('insertUnorderedList')}>• List</button>
      <button type="button" title="Numbered list" aria-label="Numbered list" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command('insertOrderedList')}>1. List</button>
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
    />
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
  </div>;
}
