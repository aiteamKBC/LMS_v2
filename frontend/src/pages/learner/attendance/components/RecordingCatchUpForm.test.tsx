import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import RecordingCatchUpForm from './RecordingCatchUpForm';

(globalThis as Record<string, unknown>).AppIcon = AppIcon;
afterEach(cleanup);

it('requires confirmation of entered catch-up time and preserves the form while editing', async () => {
  const { container } = render(<RecordingCatchUpForm />);
  for (const field of container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[required]')) {
    if (field.name === 'recordingDate') fireEvent.change(field, { target: { value: '2026-10-14' } });
    else if (!field.value) fireEvent.change(field, { target: { value: field.name === 'timeSpent' ? '49 hours' : 'Synthetic learning evidence' } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Submit Evidence' }));
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('You entered 49 hours');
  expect(screen.queryByText('Evidence Submitted!')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit time' }));
  expect(container.querySelector<HTMLTextAreaElement>('[name="keyLearning"]')?.value).toBe('Synthetic learning evidence');
  fireEvent.change(container.querySelector('[name="timeSpent"]')!, { target: { value: '4.9 hours' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit Evidence' }));
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('You entered 4.9 hours');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm time' }));
  expect(await screen.findByText('Evidence Submitted!')).toBeVisible();
});
