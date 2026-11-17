import { cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import FilterBar from './FilterBar';
import type { DashboardFilters } from '@/types/qms';

afterEach(cleanup);

const filters: DashboardFilters = {
  period: 'Last 12 months',
  department: 'All departments',
  programme: 'All programmes',
  category: 'All form categories',
  formType: 'All form types',
  feedbackType: 'All feedback types',
  respondentType: 'All feedback types',
  coach: 'All coaches',
  tutor: 'All tutors',
  rag: 'All statuses',
  query: '',
};

it('keeps the existing periods and changes only the selected period', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const { rerender } = render(<FilterBar filters={filters} onChange={onChange} onReset={vi.fn()} resultCount={7} />);
  const trigger = screen.getByRole('combobox', { name: 'Reporting period' });
  expect(trigger).toHaveTextContent('Last 12 months');
  await user.click(trigger);
  expect(screen.getAllByRole('option').filter(option => option.closest('[role="listbox"]')).map(option => option.textContent)).toEqual([
    'Last 30 days', 'Last 90 days', 'Academic year 2026/27', 'Last 12 months', 'All records',
  ]);
  expect(screen.getByRole('option', { name: 'Last 12 months' })).toHaveAttribute('aria-selected', 'true');
  await user.click(screen.getByRole('option', { name: 'Last 30 days' }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ period: 'Last 30 days' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  rerender(<FilterBar filters={{ ...filters, period: 'Last 30 days' }} onChange={onChange} onReset={vi.fn()} resultCount={3} />);
  expect(trigger).toHaveTextContent('Last 30 days');
  expect(screen.getByText(/1 filter applied/)).toBeInTheDocument();
});

it('supports keyboard selection and dismisses without changing the filter', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<FilterBar filters={filters} onChange={onChange} onReset={vi.fn()} resultCount={7} />);
  const trigger = screen.getByRole('combobox', { name: 'Reporting period' });
  await user.tab();
  expect(trigger).toHaveFocus();
  await user.keyboard('{ArrowDown}{Home}{Enter}');
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ period: 'Last 30 days' });
  onChange.mockClear();
  await user.keyboard('{ArrowDown}{ArrowUp}{Escape}');
  expect(onChange).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it.each([
  { field: 'department', id: 'filter-department', option: 'Engineering', patch: { department: 'Engineering', programme: 'All programmes' } },
  { field: 'programme', id: 'filter-programme', option: 'Data Skills', patch: { programme: 'Data Skills' } },
  { field: 'category', id: 'filter-category', option: 'Quality Audit', patch: { category: 'Quality Audit' } },
  { field: 'formType', id: 'filter-form-type', option: 'Observation', patch: { formType: 'form-1' } },
  { field: 'respondentType', id: 'filter-respondent-type', option: 'Learner', patch: { respondentType: 'Learner' } },
  { field: 'feedbackType', id: 'filter-feedback-type', option: 'Course feedback', patch: { feedbackType: 'feedback-1' } },
  { field: 'coach', id: 'filter-coach', option: 'Example Coach', patch: { coach: 'Example Coach' } },
  { field: 'tutor', id: 'filter-tutor', option: 'Example Tutor', patch: { tutor: 'Example Tutor' } },
  { field: 'rag', id: 'filter-rag', option: 'Green — Meets standard', patch: { rag: 'Green' } },
] as const)('preserves the $field options and update contract', async ({ field, id, option, patch }) => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<FilterBar filters={{ ...filters, programme: 'Existing programme' }} fields={[field]} onChange={onChange}
    onReset={vi.fn()} resultCount={7} departments={['Engineering']} programmes={['Data Skills']}
    categories={['Quality Audit']} formTypes={[{ id: 'form-1', name: 'Observation' }]}
    respondentTypes={['Learner']} feedbackTypes={[{ id: 'feedback-1', name: 'Course feedback' }]}
    coaches={['Example Coach']} tutors={['Example Tutor']} />);
  const trigger = screen.getByRole('combobox');
  expect(trigger).toHaveAttribute('id', id);
  await user.click(trigger);
  await user.click(screen.getByRole('option', { name: option }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith(patch);
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it('searches a long programme list and restores default selections on reset', async () => {
  const user = userEvent.setup();
  const programmes = Array.from({ length: 10 }, (_, index) => `Programme ${index + 1}`);
  function Harness() {
    const [value, setValue] = useState(filters);
    return <FilterBar filters={value} fields={['department', 'programme', 'query']} departments={['Engineering']}
      programmes={programmes} onChange={patch => setValue(current => ({ ...current, ...patch }))}
      onReset={() => setValue(filters)} resultCount={7} />;
  }
  render(<Harness />);
  const programme = screen.getByRole('combobox', { name: 'Programme' });
  await user.click(programme);
  await user.type(screen.getByRole('textbox', { name: 'Type to filter...' }), 'Programme 7');
  expect(screen.getAllByRole('option')).toHaveLength(1);
  await user.keyboard('{Enter}');
  expect(programme).toHaveTextContent('Programme 7');
  await user.click(screen.getByRole('combobox', { name: 'Department' }));
  await user.click(screen.getByRole('option', { name: 'Engineering' }));
  expect(programme).toHaveTextContent('All programmes');
  await user.type(screen.getByRole('searchbox'), 'reference');
  await user.click(screen.getByRole('button', { name: 'Reset filters' }));
  expect(screen.getByRole('combobox', { name: 'Department' })).toHaveTextContent('All departments');
  expect(programme).toHaveTextContent('All programmes');
  expect(screen.getByRole('searchbox')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Reset filters' })).toBeDisabled();
});
