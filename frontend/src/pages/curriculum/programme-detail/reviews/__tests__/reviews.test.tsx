import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumProgramme, ReviewDetail, ReviewSummary, ReviewType } from '@/lib/curriculumApi';

const reviewTypes: ReviewType[] = [
  { id: 'REVT-MCM', name: 'Monthly Coaching Meeting', code: 'mcm', isSystem: true, isActive: true },
  { id: 'REVT-PROGRESS_REVIEW', name: 'Progress Review', code: 'progress_review', isSystem: true, isActive: true },
];

const summary: ReviewSummary = {
  id: 'REV-20260910120000000001',
  programmeId: 'PROG-DATA',
  name: 'Progress Review',
  enabled: true,
  recurrence: { interval: 12, unit: 'weeks' },
  scheduleAnchorDate: '2026-09-10',
  occurrenceCount: null,
  reviewTypeId: 'REVT-PROGRESS_REVIEW',
  reviewTypeCode: 'progress_review',
  reviewTypeName: 'Progress Review',
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
  expectedOtjh: 0,
  countsTowardsOtjh: false,
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
  fetchReviewTypes: vi.fn(),
  createReviewType: vi.fn(),
  fetchReviewDetail: vi.fn(),
  createReviewTemplate: vi.fn(),
  updateReviewTemplate: vi.fn(),
  archiveReviewTemplate: vi.fn(),
  cloneReviewTemplates: vi.fn(),
  fetchCurriculumProgrammes: vi.fn(),
  fetchCurriculumProgrammeDetail: vi.fn(),
  fetchReviewSchedule: vi.fn(),
  resolveReviewClash: vi.fn(),
}));

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  ...api,
}));

import { CurriculumApiError } from '@/lib/curriculumApi';
import { showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { ReviewsTab } from '../ReviewsTab';
import { ReviewFormModal } from '../ReviewForm';
import { CloneReviewsModal } from '../CloneReviewsModal';

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchProgrammeReviews.mockResolvedValue([]);
  api.fetchReviewTypes.mockResolvedValue(reviewTypes);
  api.fetchCurriculumProgrammes.mockResolvedValue(programmes);
  api.fetchCurriculumProgrammeDetail.mockResolvedValue({ flat: {
    cohorts: [{ id: 'C-1', name: 'September cohort' }],
    groups: [{ id: 'G-1', name: 'Group A', cohort: 'September cohort' }],
  } });
  api.fetchReviewSchedule.mockResolvedValue({
    programmeId: 'PROG-DATA', windowStart: '2026-09-01', windowEnd: '2027-08-31', monthsPreviewed: 12, months: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A brand-new review starts locked to the General step; Form Builder only
 * unlocks after General/Schedule/Eligibility/Participants & Permissions each
 * validate. Their non-General defaults are already valid, so satisfying
 * General (name + review type) and stepping through with Next reaches it.
 */
async function fillGeneralAndReachFormBuilder(reviewTypeName = 'Progress Review') {
  await vi.waitFor(() => expect(api.fetchReviewTypes).toHaveBeenCalled());
  await userEvent.type(screen.getByLabelText(/Review name/), 'Progress Review');
  await userEvent.click(screen.getByRole('combobox', { name: /Review type/ }));
  await userEvent.click(await screen.findByRole('option', { name: reviewTypeName }));
  for (let step = 0; step < 4; step += 1) {
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
  }
}

describe('ReviewsTab', () => {
  it('saves group applicability by stable ID', async () => {
    api.fetchReviewDetail.mockResolvedValue(detail);
    api.updateReviewTemplate.mockResolvedValue(detail);
    render(<ReviewFormModal programmeId="PROG-DATA" review={summary} onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByDisplayValue('Progress Review');
    await userEvent.click(screen.getByRole('tab', { name: 'Eligibility' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Applies to' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Selected groups' }));
    await userEvent.click(await screen.findByRole('button', { name: 'September cohort / Group A' }));
    await userEvent.click(screen.getByRole('tab', { name: /Form Builder/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(api.updateReviewTemplate).toHaveBeenCalledWith(summary.id, expect.objectContaining({
      applicability: { scope: 'group', ids: ['G-1'] },
    }));
  });

  it('blocks a restricted review with no selected placement', async () => {
    api.fetchReviewDetail.mockResolvedValue(detail);
    render(<ReviewFormModal programmeId="PROG-DATA" review={summary} onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByDisplayValue('Progress Review');
    await userEvent.click(screen.getByRole('tab', { name: 'Eligibility' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Applies to' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Selected cohorts' }));
    await userEvent.click(screen.getByRole('tab', { name: /Form Builder/ }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(api.updateReviewTemplate).not.toHaveBeenCalled();
  });

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
  it('rejects advancing past General with a blank review name', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await vi.waitFor(() => expect(api.fetchReviewTypes).toHaveBeenCalled());

    // A review type alone is not enough -- name is validated together with it
    // on General, and the "Create review" button does not exist until the
    // Form Builder step, so a blank name is caught by the Next gate instead.
    await userEvent.click(screen.getByRole('combobox', { name: /Review type/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Progress Review' }));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));

    expect(await screen.findByText('Review name is required.')).toBeInTheDocument();
    expect(api.createReviewTemplate).not.toHaveBeenCalled();
    // Still on General -- Schedule never unlocked.
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  });

  it('lets the recurrence interval be entered and the repeat unit be selected', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await vi.waitFor(() => expect(api.fetchReviewTypes).toHaveBeenCalled());
    await userEvent.type(screen.getByLabelText(/Review name/), 'Progress Review');
    await userEvent.click(screen.getByRole('combobox', { name: /Review type/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Progress Review' }));
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));

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
    await fillGeneralAndReachFormBuilder();
    await userEvent.click(screen.getByRole('button', { name: /Add section/ }));
    await userEvent.type(screen.getByLabelText(/Section title/), 'Meeting & Close');
    await userEvent.click(screen.getByRole('button', { name: /Add field/ }));

    // Required defaults to unchecked; toggle it on for the new question.
    const requiredCheckboxes = screen.getAllByRole('checkbox', { name: 'Required' });
    await userEvent.click(requiredCheckboxes[requiredCheckboxes.length - 1]);

    // The field's title is still blank -- the save button disables itself
    // rather than being clickable and then rejected (see the same pattern on
    // "blocks a restricted review with no selected placement" above).
    const createButton = screen.getByRole('button', { name: /Create review/ });
    expect(createButton).toBeDisabled();
    await userEvent.click(createButton);
    expect(api.createReviewTemplate).not.toHaveBeenCalled();

    await userEvent.type(screen.getByPlaceholderText('Question title'), 'Confirmed next session booked');
    expect(screen.getByRole('button', { name: /Create review/ })).toBeEnabled();
  });

  it('removes a field and reorders remaining fields within a section with move up/down', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await fillGeneralAndReachFormBuilder();
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
    await fillGeneralAndReachFormBuilder();
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
    await fillGeneralAndReachFormBuilder();
    await userEvent.click(screen.getByRole('button', { name: /Add section/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add field/ }));

    const typeCombobox = screen.getByRole('combobox', { name: /Field type/ });
    await userEvent.click(typeCombobox);
    await userEvent.click(await screen.findByRole('option', { name: 'Boolean' }));

    expect(screen.queryByText('IF YES')).not.toBeInTheDocument();
  });

  it('selecting List item reveals the option editor', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await fillGeneralAndReachFormBuilder();
    await userEvent.click(screen.getByRole('button', { name: /Add section/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add field/ }));

    const typeCombobox = screen.getByRole('combobox', { name: /Field type/ });
    await userEvent.click(typeCombobox);
    await userEvent.click(await screen.findByRole('option', { name: 'List item' }));

    expect(screen.getByLabelText('New list option')).toBeInTheDocument();
  });

  it('a list item can be marked as the RAG status question, and only a list item offers it', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await fillGeneralAndReachFormBuilder();
    await userEvent.click(screen.getByRole('button', { name: /Add section/ }));
    await userEvent.click(screen.getByRole('button', { name: /Add field/ }));

    const ragLabel = /This is the RAG status question/;
    expect(screen.queryByLabelText(ragLabel)).not.toBeInTheDocument();

    const typeCombobox = screen.getByRole('combobox', { name: /Field type/ });
    await userEvent.click(typeCombobox);
    await userEvent.click(await screen.findByRole('option', { name: 'List item' }));

    const ragCheckbox = screen.getByLabelText(ragLabel);
    expect(ragCheckbox).not.toBeChecked();
    await userEvent.click(ragCheckbox);
    expect(screen.getByLabelText(ragLabel)).toBeChecked();

    // Changing the field type clears the marker along with the rest of the
    // field's configuration, so a non-list question can never carry it.
    await userEvent.click(screen.getByRole('combobox', { name: /Field type/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Text' }));
    expect(screen.queryByLabelText(ragLabel)).not.toBeInTheDocument();
  });

  it('stores the canonical Meeting Summary semantic marker only when explicitly selected on an MCM text field', async () => {
    api.createReviewTemplate.mockResolvedValue({});
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await fillGeneralAndReachFormBuilder('Monthly Coaching Meeting');
    await userEvent.click(screen.getByRole('button', { name: /Add section/ }));
    await userEvent.type(screen.getByLabelText(/Section title/), 'Meeting Summary');
    await userEvent.click(screen.getByRole('button', { name: /Add field/ }));
    await userEvent.type(screen.getByPlaceholderText('Question title'), 'Coach wording');

    const marker = screen.getByLabelText('This is the canonical Meeting Summary');
    expect(marker).not.toBeChecked();
    await userEvent.click(marker);
    await userEvent.click(screen.getByRole('button', { name: /Create review/ }));

    await vi.waitFor(() => expect(api.createReviewTemplate).toHaveBeenCalledWith(
      'PROG-DATA',
      expect.objectContaining({
        reviewTypeId: 'REVT-MCM',
        sections: expect.arrayContaining([
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({ configuration: expect.objectContaining({ semanticKey: 'meeting_summary' }) }),
            ]),
          }),
        ]),
      }),
    ));
  });

  it('offers the canonical Meeting Summary marker on a Progress Review text field', async () => {
    api.createReviewTemplate.mockResolvedValue({});
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await fillGeneralAndReachFormBuilder('Progress Review');
    await userEvent.click(screen.getByRole('button', { name: /Add section/ }));
    await userEvent.type(screen.getByLabelText(/Section title/), 'Meeting Summary');
    await userEvent.click(screen.getByRole('button', { name: /Add field/ }));
    await userEvent.type(screen.getByPlaceholderText('Question title'), 'Progress recap');

    const marker = screen.getByLabelText('This is the canonical Meeting Summary');
    expect(marker).not.toBeChecked();
    await userEvent.click(marker);
    await userEvent.click(screen.getByRole('button', { name: /Create review/ }));

    await vi.waitFor(() => expect(api.createReviewTemplate).toHaveBeenCalledWith(
      'PROG-DATA',
      expect.objectContaining({
        reviewTypeId: 'REVT-PROGRESS_REVIEW',
        sections: expect.arrayContaining([
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({ configuration: expect.objectContaining({ semanticKey: 'meeting_summary' }) }),
            ]),
          }),
        ]),
      }),
    ));
  });

  it('deleting a section with fields asks for confirmation', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await fillGeneralAndReachFormBuilder();
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

  it('disables only the Referrer required-signature control', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await vi.waitFor(() => expect(api.fetchReviewTypes).toHaveBeenCalled());
    await userEvent.type(screen.getByLabelText(/Review name/), 'Progress Review');
    await userEvent.click(screen.getByRole('combobox', { name: /Review type/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Progress Review' }));
    for (let step = 0; step < 3; step += 1) {
      await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    }

    const signatures = screen.getByRole('group', { name: 'Signatures required from' });
    const referrer = within(signatures).getByRole('checkbox', { name: /Referrer/ });
    expect(referrer).toBeDisabled();
    expect(referrer).not.toBeChecked();
    expect(within(signatures).getByText('Coming soon')).toBeInTheDocument();
    await userEvent.click(referrer);
    expect(referrer).not.toBeChecked();
    for (const role of ['Advisor', 'Employer', 'Participant']) {
      expect(within(signatures).getByRole('checkbox', { name: role })).toBeEnabled();
    }
    await userEvent.click(within(signatures).getByRole('checkbox', { name: 'Employer' }));
    expect(within(signatures).getByRole('checkbox', { name: 'Employer' })).toBeChecked();

    const visibleTo = screen.getByRole('group', { name: 'Visible to' });
    expect(within(visibleTo).getByRole('checkbox', { name: 'Referrer' })).toBeEnabled();
  });

  it('keeps a legacy Referrer signature requirement unchanged when saving an unrelated edit', async () => {
    const legacy: ReviewDetail = { ...detail, signatures: { ...detail.signatures, referrer: true } };
    api.fetchReviewDetail.mockResolvedValue(legacy);
    api.updateReviewTemplate.mockResolvedValue(legacy);
    render(<ReviewFormModal programmeId="PROG-DATA" review={summary} onClose={vi.fn()} onSaved={vi.fn()} />);
    const name = await screen.findByDisplayValue('Progress Review');
    await userEvent.type(name, ' renamed');

    await userEvent.click(screen.getByRole('tab', { name: 'Participants & Permissions' }));
    const referrer = within(screen.getByRole('group', { name: 'Signatures required from' })).getByRole('checkbox', { name: /Referrer/ });
    expect(referrer).toBeDisabled();
    expect(referrer).toBeChecked();

    await userEvent.click(screen.getByRole('tab', { name: /Form Builder/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(api.updateReviewTemplate).toHaveBeenCalledWith(summary.id, expect.objectContaining({
      name: 'Progress Review renamed',
      signatures: { advisor: true, employer: false, participant: true, referrer: true },
    }));
  });

  it('shows the API error when a save fails', async () => {
    api.createReviewTemplate.mockRejectedValue(new Error('Curriculum API returned 400 for /curriculum/programmes/PROG-DATA/reviews/'));
    const { showCurriculumAlert } = await import('@/components/feature/CurriculumSweetAlert');
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await fillGeneralAndReachFormBuilder();
    await userEvent.click(screen.getByRole('button', { name: /Create review/ }));

    expect(await vi.waitUntil(() => (showCurriculumAlert as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toBeTruthy();
  });
});

describe('ReviewFormModal review type', () => {
  it('loads the active review types into the General tab dropdown', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    await vi.waitFor(() => expect(api.fetchReviewTypes).toHaveBeenCalled());
    await userEvent.click(await screen.findByRole('combobox', { name: /Review type/ }));

    expect(await screen.findByRole('option', { name: 'Monthly Coaching Meeting' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Progress Review' })).toBeInTheDocument();
  });

  it('blocks moving past General until a review type is chosen', async () => {
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await vi.waitFor(() => expect(api.fetchReviewTypes).toHaveBeenCalled());

    await userEvent.type(screen.getByLabelText(/Review name/), 'Monthly Learner Catch-up');
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));

    expect(await screen.findByText('Review type is required.')).toBeInTheDocument();
    // Still on General -- the Schedule step never unlocked.
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  });

  it('adds a new type from the name alone and selects it automatically', async () => {
    api.createReviewType.mockResolvedValue({
      id: 'REVT-20260913120000000001', name: 'Career Review', code: 'career_review', isSystem: false, isActive: true,
    });
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await vi.waitFor(() => expect(api.fetchReviewTypes).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: /Add new type/ }));
    const dialog = await screen.findByRole('dialog', { name: /Add Review Type/ });
    await userEvent.type(within(dialog).getByLabelText(/Type name/), 'Career Review');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    // The name is the only thing sent: id/code/is_system/is_active are the
    // backend's to generate.
    await vi.waitFor(() => expect(api.createReviewType).toHaveBeenCalledWith('Career Review'));
    expect(await screen.findByRole('combobox', { name: /Review type/ })).toHaveTextContent('Career Review');
  });

  it('shows the duplicate-name error against the Add Review Type field', async () => {
    api.createReviewType.mockRejectedValue(
      new CurriculumApiError('Please fix the highlighted fields.', 400, '/curriculum/review-types/', { fields: { name: 'A review type with this name already exists.' } }),
    );
    render(<ReviewFormModal programmeId="PROG-DATA" review={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await vi.waitFor(() => expect(api.fetchReviewTypes).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: /Add new type/ }));
    const dialog = await screen.findByRole('dialog', { name: /Add Review Type/ });
    await userEvent.type(within(dialog).getByLabelText(/Type name/), 'Progress Review');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('A review type with this name already exists.')).toBeInTheDocument();
  });

  it('edit preselects the review stored type, and a renamed review keeps it', async () => {
    api.fetchReviewDetail.mockResolvedValue({ ...detail, name: 'Monthly Learner Catch-up', reviewTypeId: 'REVT-MCM', reviewTypeCode: 'mcm', reviewTypeName: 'Monthly Coaching Meeting' });
    render(<ReviewFormModal programmeId="PROG-DATA" review={{ ...summary, name: 'Monthly Learner Catch-up' }} onClose={vi.fn()} onSaved={vi.fn()} />);

    // Name and type are independent: the review is called something else
    // entirely and is still typed as a Monthly Coaching Meeting.
    expect(await screen.findByDisplayValue('Monthly Learner Catch-up')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Review type/ })).toHaveTextContent('Monthly Coaching Meeting');
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
