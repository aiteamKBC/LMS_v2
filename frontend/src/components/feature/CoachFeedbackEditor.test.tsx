import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachFeedbackEditor } from './CoachFeedbackEditor';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('coach feedback editor controls', () => {
  it.each([
    ['Bulleted list', 'insertUnorderedList', '<ul><li>First point</li></ul>'],
    ['Numbered list', 'insertOrderedList', '<ol><li>First point</li></ol>'],
  ])('keeps the %s command connected to the editor selection', (label, command, formattedHtml) => {
    let editor: HTMLElement;
    const onChange = vi.fn();
    const execCommand = vi.fn((name: string) => {
      if (name === command) editor.innerHTML = formattedHtml;
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    render(<CoachFeedbackEditor value="<p>First point</p>" onChange={onChange} />);
    editor = screen.getByRole('textbox', { name: 'Review feedback editor' });
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.mouseDown(screen.getByRole('button', { name: label }));
    fireEvent.click(screen.getByRole('button', { name: label }));

    expect(execCommand).toHaveBeenCalledWith(command, false, undefined);
    expect(onChange).toHaveBeenLastCalledWith(formattedHtml);
  });
});
