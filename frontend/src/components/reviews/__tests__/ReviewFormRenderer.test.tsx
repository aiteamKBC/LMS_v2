import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReviewFormRenderer } from '../ReviewFormRenderer';
import type { ReviewFieldDefinition, ReviewSectionDefinition } from '@/api/reviewInstances';

function field(overrides: Partial<ReviewFieldDefinition> = {}): ReviewFieldDefinition {
  return { id: 'f', title: 'Question', fieldType: 'text', required: false, displayOrder: 0, configuration: {}, ...overrides };
}

function section(overrides: Partial<ReviewSectionDefinition> = {}): ReviewSectionDefinition {
  return { id: 's', title: 'Section', estimatedMinutes: 0, displayOrder: 0, enabled: true, fields: [], ...overrides };
}

function renderForm(sections: ReviewSectionDefinition[], openSectionId: string) {
  return render(
    <ReviewFormRenderer
      sections={sections}
      answers={{}}
      onAnswerChange={vi.fn()}
      openSectionId={openSectionId}
      onOpenSectionChange={vi.fn()}
    />,
  );
}

describe('ReviewFormRenderer imported content', () => {
  it('renders the real imported content instead of the generic "Imported text" placeholder', () => {
    const importedField = field({
      id: 'aptem-text:summary',
      title: 'Imported text',
      fieldType: 'title_description',
      displayOrder: 0,
      configuration: { imported: true, description: 'Meeting Summary' },
    });
    renderForm([section({ id: 'summary', fields: [importedField] })], 'summary');

    expect(screen.getByText('Meeting Summary')).toBeInTheDocument();
    expect(screen.queryByText('Imported text')).not.toBeInTheDocument();
  });

  it('keeps showing a genuine title_description heading that is not the import placeholder', () => {
    const headingField = field({
      id: 'intro',
      title: 'Learner Information',
      fieldType: 'title_description',
      configuration: { description: 'Confirm the learner details before you begin.' },
    });
    renderForm([section({ id: 'intro', fields: [headingField] })], 'intro');

    expect(screen.getByText('Learner Information')).toBeInTheDocument();
    expect(screen.getByText('Confirm the learner details before you begin.')).toBeInTheDocument();
  });

  it('orders sections and fields by displayOrder, not array order', () => {
    const outOfOrder = [
      section({
        id: 'second', title: 'Second section', displayOrder: 2, fields: [
          field({ id: 'b2', title: 'Later question', displayOrder: 5 }),
          field({ id: 'b1', title: 'Earlier question', displayOrder: 1 }),
        ],
      }),
      section({ id: 'first', title: 'First section', displayOrder: 1, fields: [field({ id: 'a1', title: 'First question', displayOrder: 1 })] }),
    ];
    // Open the lower-priority section so both of its fields render.
    renderForm(outOfOrder, 'second');

    const first = screen.getByText('First section');
    const second = screen.getByText('Second section');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const earlier = screen.getByText('Earlier question');
    const later = screen.getByText('Later question');
    expect(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
