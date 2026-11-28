import { StrictMode, useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ComponentEditor } from './page';
import { createEmptyComponent } from '../module-builder/moduleAuthoringData';

vi.mock('../module-builder/RichTextEditor', () => ({ RichTextDraft: () => <div>Question editor</div> }));
vi.mock('@/pages/curriculum/quiz-xml/edit/QuizEditorPanel', () => ({
  QuizEditorPanel: ({ quizId, onSaved }: { quizId: string; onSaved: () => void }) => (
    <button onClick={onSaved}>Save quiz {quizId}</button>
  ),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('loads quizzes only inside the quiz editor, then preserves importing, editing and refreshing', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ results: [{
    id: 7, title: 'Imported quiz', programmeId: 'P1', programme: 'Programme', module: 'Module',
    weekId: 'W1', questions: 12, duration: 30, passingGrade: 80, assessmentType: 'quiz', status: 'published',
  }] })));
  vi.stubGlobal('fetch', fetch);
  const changes = vi.fn();
  function Harness() {
    const [component, setComponent] = useState(() => createEmptyComponent('W1', 'assignment', 1));
    return <>
      <button onClick={() => setComponent(createEmptyComponent('W1', 'quiz', 1))}>Open quiz component</button>
      <ComponentEditor component={component} groupOptions={[]} onBack={vi.fn()}
        weekScope={{ courseType: 'paid', programmeId: 'P1', programmeName: 'Programme', moduleName: 'Module' }}
        onChange={patch => { changes(patch); setComponent(current => ({ ...current, ...patch })); }} />
    </>;
  }
  render(<StrictMode><Harness /></StrictMode>);
  expect(fetch).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Open quiz component' }));
  const option = await screen.findByRole('option', { name: 'Imported quiz · 12 q' });
  expect(fetch).toHaveBeenCalledTimes(1);
  await user.selectOptions(option.closest('select')!, '7');
  expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ settings: expect.objectContaining({
    linkedQuizId: '7', linkedActivity: 'Imported quiz', numberOfQuestions: 12,
    quizDuration: 30, passMarkPercentage: 80, quizWeekId: 'W1', quizStatus: 'published',
  }) }));
  await user.click(screen.getByRole('button', { name: 'Edit questions' }));
  await user.click(await screen.findByRole('button', { name: 'Save quiz 7' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});
