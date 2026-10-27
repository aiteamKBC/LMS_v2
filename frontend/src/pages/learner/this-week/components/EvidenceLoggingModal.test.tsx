import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import { EvidenceLoggingModal } from './EvidenceLoggingModal';

(globalThis as Record<string, unknown>).AppIcon = AppIcon;
afterEach(cleanup);

it('reviews manually entered evidence minutes and allows correction before submission', async () => {
  const onSubmit = vi.fn();
  render(<EvidenceLoggingModal isOpen onClose={vi.fn()} onSubmit={onSubmit} title="Synthetic activity"
    componentType="Reading" weekNumber={1} moduleName="Example module" ksbCodes={[]} ksbLabels="" plannedOTJH={1} points={0} />);
  const tab = (name: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(name + '$') }));
  fireEvent.change(await screen.findByPlaceholderText(/Summarise what you learnt/), { target: { value: 'Learning '.repeat(110) } });
  tab('Apply');
  fireEvent.click(screen.getByLabelText('I plan to apply this learning'));
  fireEvent.change(screen.getByPlaceholderText('Describe your workplace application plan...'), { target: { value: 'Apply this learning to synthetic workplace examples.' } });
  tab('Evidence');
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['Synthetic evidence'], 'example.txt', { type: 'text/plain' })] } });
  fireEvent.click(screen.getByRole('checkbox', { name: /this evidence can be viewed by my coach/ }));
  tab('Benefit');
  fireEvent.click(screen.getByRole('button', { name: 'Improved productivity' }));
  fireEvent.change(screen.getByPlaceholderText(/Explain how this could improve/), { target: { value: 'Improve the quality of synthetic workplace examples.' } });
  tab('OTJH');
  fireEvent.change(screen.getByLabelText('Actual time spent (minutes)'), { target: { value: '2940' } });
  fireEvent.click(screen.getByRole('radio', { name: /^Yes$/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm this OTJH record is accurate.' }));
  tab('Review');
  fireEvent.click(screen.getByRole('checkbox', { name: /electronically sign it/ }));
  const submit = screen.getByRole('button', { name: 'Submit for tutor review' });
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('49 hours and 0 minutes');
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit time' }));
  await waitFor(() => expect(screen.getByLabelText('Actual time spent (minutes)')).toHaveValue(2940));
  fireEvent.change(screen.getByLabelText('Actual time spent (minutes)'), { target: { value: '294' } });
  tab('Review');
  fireEvent.click(screen.getByRole('button', { name: 'Submit for tutor review' }));
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('4 hours and 54 minutes');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm time' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ otjhActual: 294, reflection: 'Learning '.repeat(110) })));
});
