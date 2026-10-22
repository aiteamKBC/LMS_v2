import { act, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import { RichTextDraft } from '../RichTextEditor';

// The app auto-imports AppIcon; the editor's toolbar needs it in a test too.
beforeEach(() => vi.stubGlobal('AppIcon', AppIcon));

/**
 * A focused rich-text editor used to ignore a new value arriving from a
 * colleague's save, then write its own stale content back on blur -- silently
 * undoing their edit although the author had typed nothing. The new value now
 * goes in while focused, and the author's own typing still never jumps.
 */

function Harness({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = useState('<p>Original</p>');
  (window as unknown as { setRemote: (next: string) => void }).setRemote = setValue;
  return (
    <RichTextDraft
      label="Content"
      value={value}
      onChange={next => { onChange(next); setValue(next); }}
    />
  );
}

function editorOf(container: HTMLElement) {
  return container.querySelector('[contenteditable]') as HTMLDivElement;
}

describe('RichTextDraft with a value from somebody else', () => {
  it('takes their value while focused, and blur does not undo it', () => {
    const onChange = vi.fn();
    const { container } = render(<Harness onChange={onChange} />);
    const editor = editorOf(container);
    expect(editor.innerHTML).toBe('<p>Original</p>');
    act(() => { editor.focus(); });
    expect(document.activeElement).toBe(editor);
    act(() => { (window as unknown as { setRemote: (next: string) => void }).setRemote('<p>Their saved text</p>'); });
    expect(editor.innerHTML).toBe('<p>Their saved text</p>');
    act(() => { fireEvent.blur(editor); });
    // Nothing was typed, so blur commits nothing: their text stands, and the
    // old one is never written back.
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.innerHTML).toBe('<p>Their saved text</p>');
  });

  it("does not re-set the author's own typing (the caret would jump)", () => {
    const onChange = vi.fn();
    const { container } = render(<Harness onChange={onChange} />);
    const editor = editorOf(container);
    act(() => { editor.focus(); });
    const setInnerHtml = vi.spyOn(Element.prototype, 'innerHTML', 'set');
    try {
      act(() => {
        editor.innerHTML = '<p>Original, typed</p>'; // the keystroke itself
        fireEvent.input(editor);
      });
      // The value coming back is the author's own, so the editor writes nothing
      // to the DOM: the only write is the keystroke above.
      expect(onChange).toHaveBeenLastCalledWith('<p>Original, typed</p>');
      // (Writes to other elements -- the word counter's scratch element -- do not count.)
      expect(setInnerHtml.mock.contexts.filter(context => context === editor)).toHaveLength(1);
      expect(editor.innerHTML).toBe('<p>Original, typed</p>');
    } finally {
      setInnerHtml.mockRestore();
    }
  });
});
