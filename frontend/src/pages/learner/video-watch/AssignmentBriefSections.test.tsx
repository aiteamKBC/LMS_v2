import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AssignmentBriefPanel } from './AssignmentBriefSections';

afterEach(cleanup);
const imported = '<p><strong>Additional materials</strong></p><ul><li><a href="https://old.example.test/guide.pdf" target="_blank" rel="noreferrer">Guide &amp; template</a></li></ul>';
const file = (name: string) => ({ fileName: name, url: `/curriculum_api/curriculum/uploads/${name}`, size: 1, contentType: 'application/pdf' });

it('shows an ordinary assignment its question, instructions and resources without repeating the primary file', () => {
  render(<AssignmentBriefPanel component={{ resourceUrl: file('brief.pdf').url, assignmentTopics: [
    { id: '1', name: '', question: '<p>Summarise the <strong>lecture</strong>.</p><script>alert(1)</script>',
      instructions: `<p>Bring it to your next session.</p>${imported}`, resources: [file('brief.pdf'), file('template.pdf')] }] }} />);
  const brief = screen.getByRole('region', { name: 'Assignment brief' });
  expect(within(brief).getByText('lecture')).toHaveProperty('tagName', 'STRONG');
  expect(brief.querySelector('script')).toBeNull();
  expect(within(brief).getByRole('region', { name: 'Instructions' })).toHaveTextContent('Bring it to your next session.');
  expect(within(within(brief).getByRole('region', { name: 'Resources' })).getAllByRole('link').map(link => link.textContent))
    .toEqual(['template.pdf', 'Guide & template']);
  expect(within(brief).queryByText(/Choose one of these options/)).toBeNull();
});

it('lists each option when there is a choice and falls back to the plain brief without topics', () => {
  const { rerender } = render(<AssignmentBriefPanel component={{ assignmentTopics: [
    { id: '1', name: 'Research', question: 'Question one', instructions: '', resources: [] },
    { id: '3', name: '', question: 'Question three', instructions: 'Use the template', resources: [] }] }} />);
  expect(screen.getByText('Choose one of these options.')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Topic 1 — Research' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Topic 3' })).toBeVisible();
  rerender(<AssignmentBriefPanel component={{ assignmentBrief: 'Line one\nLine two' }} />);
  expect(screen.getByText(/Line one/)).toHaveClass('whitespace-pre-line');
  expect(screen.queryByRole('heading')).toBeNull();
  rerender(<AssignmentBriefPanel component={{ assignmentTopics: [{ id: '1', name: '', question: '', instructions: '', resources: [] }] }} />);
  expect(screen.queryByRole('region', { name: 'Assignment brief' })).toBeNull();
});
