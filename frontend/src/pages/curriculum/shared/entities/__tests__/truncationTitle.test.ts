import { describe, expect, it } from 'vitest';
import type { MouseEvent } from 'react';
import { showFullTextWhenTruncated } from '../truncationTitle';

/**
 * A clipped name has to be readable, and a name that fits must not grow a
 * tooltip that repeats what is already on screen.
 *
 * jsdom has no layout, so `scrollWidth` and `clientWidth` are both 0 on a real
 * element and every name would read as fitting. The widths are therefore set
 * directly here: they are the only two facts the helper reads, and what is being
 * tested is the decision taken from them, not the browser's measuring.
 */
function hoverOn({ text, scrollWidth, clientWidth, title = '' }: {
  text: string;
  scrollWidth: number;
  clientWidth: number;
  title?: string;
}) {
  const node = { textContent: text, scrollWidth, clientWidth, title } as unknown as HTMLElement;
  showFullTextWhenTruncated({ currentTarget: node } as unknown as MouseEvent<HTMLElement>);
  return node.title;
}

describe('showFullTextWhenTruncated', () => {
  it('names a clipped label in full', () => {
    expect(hoverOn({
      text: 'Risk identification, descriptions, ownership and the risk register',
      scrollWidth: 420,
      clientWidth: 180,
    })).toBe('Risk identification, descriptions, ownership and the risk register');
  });

  it('says nothing about a label that already fits', () => {
    expect(hoverOn({ text: 'Event Record', scrollWidth: 96, clientWidth: 180 })).toBe('');
  });

  it('tolerates a rounded pixel, so an exact fit stays quiet', () => {
    // Widths are rounded, so text filling its box can report one pixel more
    // than the box holds. That is a fit, not a truncation.
    expect(hoverOn({ text: 'Project risk foundations', scrollWidth: 181, clientWidth: 180 })).toBe('');
    expect(hoverOn({ text: 'Project risk foundations', scrollWidth: 182, clientWidth: 180 })).toBe('Project risk foundations');
  });

  it('clears a title left behind when the row now holds a shorter name', () => {
    // The same DOM node is reused as weeks are reordered and renamed, so a
    // stale title would confidently name the wrong week.
    expect(hoverOn({
      text: 'Event Record',
      scrollWidth: 96,
      clientWidth: 180,
      title: 'Risk identification, descriptions, ownership and the risk register',
    })).toBe('');
  });

  it('trims the label, because the markup around it carries whitespace', () => {
    expect(hoverOn({ text: '\n  Qualitative risk assessment  \n', scrollWidth: 420, clientWidth: 180 }))
      .toBe('Qualitative risk assessment');
  });
});
