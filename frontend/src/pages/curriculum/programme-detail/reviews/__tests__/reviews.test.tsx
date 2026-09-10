import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumProgramme, ReviewDetail, ReviewSummary } from '@/lib/curriculumApi';

const summary: ReviewSummary = {
  id: 'REV-20260910120000000001',
  programmeId: 'PROG-DATA',
  name: 'Progress Review',
  enabled: true,
  recurrence: { interval: 12, unit: 'weeks' },
  scheduleAnchorDate: '2026-09-10',
  applicableStatuses: ['Active'],
  fieldCount: 1,
  createdAt: '2026-09-10T00:00:00Z',
  updatedAt: '2026-09-10T00:00:00Z',
};

const detail: ReviewDetail = {
  ...summary,
  signatures: { advisor: true, employer: false, participant: true, referrer: false },
  visibleTo: { advisor: true, employer: true, participant: true, referrer: false },
  recordTimeSpent: true,
  allowEditingPriorDays: 7,
  notifications: { employer: false, participant: true },
  incompleteMarker: 'Overdue',
  createdBy: 'staff',
  updatedBy: 'staff',
  sections: [
    {
      id: 'REVS-1',
      reviewId: summary.id,
      title: 'General',
      estimatedMinutes: 0,
      displayOrder: 0,
      enabled: true,
      fields: [
        {
          id: 'REVF-1', reviewId: summary.id, sectionId: 'REVS-1', parentFieldId: null, conditionValue: null,
          title: 'Progress notes', fieldType: 'text_multiline', required: true, displayOrder: 0, configuration: {}, createdAt: '', updatedAt: '',
        },
      ],
    },
  ],
  fields: [
    {
      id: 'REVF-1', reviewId: summary.id, sectionId: 'REVS-1', parentFieldId: null, conditionValue: null,
      title: 'Progress notes', fieldType: 'text_multiline', required: true, displayOrder: 0, configuration: {}, createdAt: '', updatedAt: '',
    },
  ],
};

const programmes: CurriculumProgramme[] = [
  { id: 'PROG-DATA', sourceId: 'PROG-DATA', name: 'Data Analyst' } as CurriculumProgramme,
  { id: 'PROG-MARKETING', sourceId: 'PROG-MARKETING', name: 'Marketing Manager' } as CurriculumProgramme,
];

vi.mock('@/components/feature/CurriculumSweetAlert', () => ({
  showCurriculumAlert: vi.fn(async () => undefined),
  showCurriculumConfirm: vi.fn(async ({ onConfirm }: { onConfirm: () => void | Promise<void> }) => {
    await onConfirm();
    return true;
  }),
}));

const api = vi.hoisted(() => ({
  fetchProgrammeReviews: vi.fn(),
  fetchReviewDetail: vi.fn(),
  createReviewTemplate: vi.fn(),
  updateReviewTemplate: vi.fn(),
  archiveReviewTemplate: vi.fn(),
  cloneReviewTemplates: vi.fn(),
  fetchCurriculumProgrammes: vi.fn(),
  fetchReviewSchedule: vi.fn(),
  resolveReviewClash: vi.fn(),
}));

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  ...api,
}));

import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { ReviewsTab } from '../ReviewsTab';
import { ReviewFormModal } from '../ReviewForm';
import { CloneReviewsModal } from '../CloneReviewsModal';

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchProgrammeReviews.mockResolvedValue([]);
  api.fetchCurriculumProgrammes.mockResolvedValue(programmes);
  api.fetchReviewSchedule.mockResolvedValue({
    programmeId: 'PROG-DATA', windowStart: '2026-09-01', windowEnd: '2027-08-31', monthsPreviewed: 12, months: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReviewsTab', () => {
  it('loads and shows the programme empty state when there are no reviews', async () => {
    render(<ReviewsTab programmeId="PROG-DATA" programmeName="Data Analyst" />);
    expect(await screen.findByText('No reviews have been configured yet')).toBeInTheDocument();
    // The header action and the empty state's own call to action both say
    // "Add New Review" -- either is a valid way in.
    expect(screen.getAllByRole('button', { name: /Add New Review/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Clone Review From Another Programme/ })).toBeInTheDocument();
  });

  it('lists a review with its recurrence, statuses and field count', async () => {
    api.fetchProgrammeReviews.mockResolvedValue([summary]);
    render(<ReviewsTab programmeId="PROG-DATA" programmeName="Data Analyst" />);

    expect(await screen.findByText('Progress Review')).toBeInTheDocument();
    expect(screen.getByText('Every 12 weeks')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('1 field')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('opens the create form from Add New Review', async () => {
    render(<ReviewsTab programmeId="PROG-DATA" programmeName="Data Analyst" />);
    await screen.findByText('No reviews have been configured yet');

    await userEvent.click(screen.getAllByRole('button', { name: /Add New Review/ })[0]);
    expect(await screen.findByRole('heading', { name: 'Add New Review' })).toBeInTheDocument();
  });

  it('shows a delete confirmation before archiving, then refreshes the list', async () => {
    api.fetchProgrammeReviews.mockResolvedValueOnce([summary]).mockResolvedValueOnce([]);
    api.archiveReviewTemplate.mockResolvedValue({ deleted: true, permanent: false, archived: true, id: summary.id });
    render(<ReviewsTab programmeId="PROG-DATA" programmeName="Data Analyst" />);
    await screen.findByText('Progress Review');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(showCurriculumConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: `Delete "${summary.name}"?`,
    }));
    expect(api.archiveReviewTemplate).toHaveBeenCalledWith(summary.id);
  });

  it('opens the clone modal', async () => {
    render(<ReviewsTab programmeId="PROG-DATA" programmeName="Data Analyst" />);
    await screen.findByText('No reviews have been configured yet');

    await userEvent.click(screen.getByRole('button', { name: /Clone Review From Another Programme/ }));
    expect(await screen.findByRole('heading', { name: /Clone reviews into/ })).toBeInTheDocument();
  });
});

describe('ReviewFormModal', () => {
  it('rejects saving with a blank review name', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /Create review/ }));

    expect(await screen.findByText('Review name is required.')).toBeInTheDocument();
    expect(api.createReviewTemplate).not.toHaveBeenCalled();
  });

  it('lets the recurrence interval be entered and the repeat unit be selected', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Schedule' }));

    const intervalInput = screen.getByLabelText(/Repeat interval/);
    await userEvent.clear(intervalInput);
    await userEvent.type(intervalInput, '12');
    expect(intervalInput).toHaveValue(12);

    await userEvent.click(screen.getByRole('combobox', { name: /Repeat unit/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Months' }));
    expect(screen.getByRole('combobox', { name: /Repeat unit/ })).toHaveTextContent('Months');
  });

  it('adds a section, adds a field inside it, and blocks save on an empty field title', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/Review name/), 'Progress Review');
    await userEvent.click(screen.getByRole('tab', { name: /Form Builder/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add section/ }));
    await userEvent.type(screen.getByLabelText(/Section title/), 'Meeting & Close');
    await userEvent.click(screen.getByRole('button', { name: /Add field/ }));

    // Required defaults to unchecked; toggle it on for the new question.
    const requiredCheckboxes = screen.getAllByRole('checkbox', { name: 'Required' });
    await userEvent.click(requiredCheckboxes[requiredCheckboxes.length - 1]);

    await userEvent.click(screen.getByRole('button', { name: /Create review/ }));

    expect(await screen.findByText("Title can't be empty.")).toBeInTheDocument();
    expect(api.createReviewTemplate).not.toHaveBeenCalled();
  });

  it('removes a field and reorders remaining fields within a section with move up/down', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: /Form Builder/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add section/ }));
    await userEvent.type(screen.getByLabelText(/Section title/), 'Meeting & Close');

    await userEvent.click(screen.getByRole('button', { name: /Add field/ }));
    await userEvent.type(screen.getByPlaceholderText('Question title'), 'First question');
    await userEvent.click(screen.getByRole('button', { name: /Add field/ }));
    const titles = screen.getAllByPlaceholderText('Question title');
    await userEvent.type(titles[1], 'Second question');

    // Move the second field up; it should now be first.
    const moveUpButtons = screen.getAllByRole('button', { name: /Move field 2 up/ });
    await userEvent.click(moveUpButtons[0]);
    expect(screen.getAllByPlaceholderText('Question title')[0]).toHaveValue('Second question');

    // Delete the now-first field.
    const deleteButtons = screen.getAllByLabelText(/Delete field:/);
    await userEvent.click(deleteButtons[0]);
    expect(screen.getAllByPlaceholderText('Question title')).toHaveLength(1);
  });

  it('selecting Boolean with case block reveals IF YES / IF NO branches, each accepting its own field', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: /Form Builder/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add section/ }));
    await userEvent.type(screen.getByLabelText(/Section title/), 'Meeting & Close');
    await userEvent.click(screen.getByRole('button', { name: /Add field/ }));

    const typeCombobox = screen.getByRole('combobox', { name: /Field type/ });
    await userEvent.click(typeCombobox);
    await userEvent.click(await screen.findByRole('option', { name: 'Boolean with case block' }));

    expect(screen.getByText('IF YES')).toBeInTheDocument();
    expect(screen.getByText('IF NO')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Add field for YES/ }));
    expect(screen.getAllByPlaceholderText('Question title')).toHaveLength(2);
  });

  it('a plain Boolean field never shows conditional branches', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: /Form Builder/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add section/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add field/ }));

    const typeCombobox = screen.getByRole('combobox', { name: /Field type/ });
    await userEvent.click(typeCombobox);
    await userEvent.click(await screen.findByRole('option', { name: 'Boolean' }));

    expect(screen.queryByText('IF YES')).not.toBeInTheDocument();
  });

  it('selecting List item reveals the option editor', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: /Form Builder/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add section/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add field/ }));

    const typeCombobox = screen.getByRole('combobox', { name: /Field type/ });
    await userEvent.click(typeCombobox);
    await userEvent.click(await screen.findByRole('option', { name: 'List item' }));

    expect(screen.getByLabelText('New list option')).toBeInTheDocument();
  });

  it('deleting a section with fields asks for confirmation', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: /Form Builder/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add section/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add field/ }));

    await userEvent.click(screen.getByRole('button', { name: /Delete section:/ }));
    expect(showCurriculumConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Delete section'),
    }));
  });

  it('edit loads the existing values for name, recurrence and fields', async () => {
    api.fetchReviewDetail.mockResolvedValue(detail);
    render(<ReviewFormModal programmeId="PROG-DATA" review={summary} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(await screen.findByDisplayValue('Progress Review')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit "Progress Review"' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Schedule' }));
    expect(screen.getByDisplayValue('12')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /Form Builder/ }));
    expect(screen.getByDisplayValue('Progress notes')).toBeInTheDocument();
  });

  it('shows the API error when a save fails', async () => {
    api.createReviewTemplate.mockRejectedValue(new Error('Curriculum API returned 400 for /curriculum/programmes/PROG-DATA/reviews/'));
    const { showCurriculumAlert } = await import('@/components/feature/CurriculumSweetAlert');
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/Review name/), 'Progress Review');
    await userEvent.click(screen.getByRole('button', { name: /Create review/ }));

    expect(await vi.waitUntil(() => (showCurriculumAlert as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toBeTruthy();
  });
});

describe('CloneReviewsModal', () => {
  it('loads programmes, lets a source be picked, and shows its reviews', async () => {
    api.fetchProgrammeReviews.mockResolvedValue([summary]);
    render(
      <CloneReviewsModal destinationProgrammeId="PROG-MARKETING" destinationProgrammeName="Marketing Manager" onClose={vi.fn()} onCloned={vi.fn()} />,
    );

    const combobox = await screen.findByRole('combobox', { name: /Source programme/ });
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByRole('option', { name: 'Data Analyst' }));

    expect(await screen.findByText('Progress Review')).toBeInTheDocument();
  });

  it('does not offer the destination programme as its own clone source', async () => {
    render(
      <CloneReviewsModal destinationProgrammeId="PROG-DATA" destinationProgrammeName="Data Analyst" onClose={vi.fn()} onCloned={vi.fn()} />,
    );
    const combobox = await screen.findByRole('combobox', { name: /Source programme/ });
    await userEvent.click(combobox);
    expect(screen.queryByRole('option', { name: 'Data Analyst' })).not.toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Marketing Manager' })).toBeInTheDocument();
  });

  it('shows a validation message when Copy is pressed with nothing selected', async () => {
    api.fetchProgrammeReviews.mockResolvedValue([summary]);
    render(
      <CloneReviewsModal destinationProgrammeId="PROG-MARKETING" destinationProgrammeName="Marketing Manager" onClose={vi.fn()} onCloned={vi.fn()} />,
    );
    const combobox = await screen.findByRole('combobox', { name: /Source programme/ });
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByRole('option', { name: 'Data Analyst' }));
    await screen.findByText('Progress Review');

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Please choose one or more types.')).toBeInTheDocument();
    expect(api.cloneReviewTemplates).not.toHaveBeenCalled();
  });

  it('clones the selected reviews and refreshes on success', async () => {
    api.fetchProgrammeReviews.mockResolvedValue([summary]);
    api.cloneReviewTemplates.mockResolvedValue({
      cloned: true, sourceProgrammeId: 'PROG-DATA', programmeId: 'PROG-MARKETING',
      reviewIds: ['REV-NEW'], reviews: [],
    });
    const onCloned = vi.fn();
    render(
      <CloneReviewsModal destinationProgrammeId="PROG-MARKETING" destinationProgrammeName="Marketing Manager" onClose={vi.fn()} onCloned={onCloned} />,
    );
    const combobox = await screen.findByRole('combobox', { name: /Source programme/ });
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByRole('option', { name: 'Data Analyst' }));
    await userEvent.click(await screen.findByRole('checkbox'));

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await vi.waitUntil(() => onCloned.mock.calls.length > 0)).toBeTruthy();
    expect(api.cloneReviewTemplates).toHaveBeenCalledWith('PROG-MARKETING', {
      sourceProgrammeId: 'PROG-DATA', reviewIds: [summary.id],
    });
  });
});
