import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LocalAiTextCheck } from './LocalAiTextCheck';
import { AssignmentAiCheckContext } from './AssignmentAiCheckContext';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const view = (text: string, enabled = true) => <AssignmentAiCheckContext.Provider value={{ learnerId: 'learner-1', learnerKind: 'apprenticeship', enabled }}><LocalAiTextCheck text={text} disabled={false} /></AssignmentAiCheckContext.Provider>;
const reply = (data: unknown, ok = true) => ({ ok, json: async () => data });

it('highlights flagged passages and invalidates the result after edits', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply({ csrfToken: 'csrf' })).mockResolvedValueOnce(reply({ advisoryOnly: true, status: 'review_suggested', message: 'Tutor review required.', segments: [{ start: 0, end: 5, flagged: true }] }));
  vi.stubGlobal('fetch', fetch);
  const { container, rerender } = render(view('First Other'));
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText('Tutor review required.');
  expect(container.querySelector('mark')?.textContent).toBe('First');
  expect(fetch.mock.calls[1][1]).toMatchObject({ credentials: 'same-origin', headers: { 'X-CSRFToken': 'csrf' }, body: JSON.stringify({ learnerId: 'learner-1', learnerKind: 'apprenticeship', text: 'First Other' }) });
  rerender(view('Edited answer'));
  expect(container.querySelector('mark')).toBeNull();
});

it('shows only the heading when no signal is found', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply({ csrfToken: 'csrf' })).mockResolvedValueOnce(reply({ advisoryOnly: true, status: 'no_signal', message: 'Advisory explanation.', segments: [{ start: 0, end: 6, flagged: false }] })));
  render(view('Answer'));
  fireEvent.click(screen.getByRole('button'));
  expect((await screen.findByRole('status')).textContent).toBe('No AI-writing signal found');
  expect(screen.queryByText('Advisory explanation.')).toBeNull();
});

it('reports unavailable service without a clean result', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply({ csrfToken: 'csrf' })).mockResolvedValueOnce(reply({ error: 'Model is not installed.' }, false)));
  render(view('Answer'));
  fireEvent.click(screen.getByRole('button'));
  expect((await screen.findByRole('alert')).textContent).toContain('Model is not installed.');
  expect(screen.queryByRole('status')).toBeNull();
});

it('does not offer checking on historical assignments', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  render(view('Answer', false));
  expect(screen.queryByRole('button')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
