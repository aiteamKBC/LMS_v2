import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppIcon } from '@/components/feature/AppIcon';
import { AssignmentTopicsEditor } from './AssignmentTopicsEditor';
import { assignmentTopics } from '@/lib/assignmentTopics';
import { normaliseComponentSettings } from '../module-builder/componentAuthoringModel';

// RichTextDraft receives this auto-import from Vite in the application.
beforeEach(() => vi.stubGlobal('AppIcon', AppIcon));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('keeps names, separate questions and multiple resources across topic switches and normalisation', async () => {
  let saved = '';
  const upload = vi.fn(async (file: File) => ({ fileName: file.name, url: `/curriculum_api/curriculum/uploads/${file.name}`, size: file.size, contentType: file.type }));
  function Editor() {
    const [value, setValue] = useState('');
    return <AssignmentTopicsEditor value={value} legacyQuestion="Original question" legacyInstructions="Keep these instructions" onChange={next => { saved = next; setValue(next); }} onUpload={upload} />;
  }
  render(<Editor />);
  fireEvent.click(screen.getByRole('tab', { name: 'Topic 2' }));
  fireEvent.change(screen.getByLabelText('Topic name (optional)'), { target: { value: 'Planning' } });
  fireEvent.input(screen.getByRole('group', { name: 'Assignment question' }).querySelector('[contenteditable]')!, { target: { innerHTML: '<p>Explain your plan</p>' } });
  fireEvent.change(screen.getByLabelText('Files and videos'), { target: { files: [new File(['video'], 'intro.mp4', { type: 'video/mp4' }), new File(['brief'], 'brief.pdf', { type: 'application/pdf' })] } });
  await waitFor(() => expect(screen.getByText('brief.pdf')).toBeVisible());
  fireEvent.click(screen.getByRole('tab', { name: 'Topic 1' }));
  expect(screen.getByRole('group', { name: 'Assignment question' })).toHaveTextContent('Original question');
  expect(screen.getByLabelText('Instructions')).toHaveValue('Keep these instructions');
  fireEvent.click(screen.getByRole('tab', { name: /Topic 2.*Planning/ }));
  expect(screen.getByRole('group', { name: 'Assignment question' })).toHaveTextContent('Explain your plan');
  const restored = assignmentTopics(normaliseComponentSettings('assignment', { assignmentTopics: saved }).assignmentTopics);
  expect(restored[0].question).toBe('Original question');
  expect(restored[0].instructions).toBe('Keep these instructions');
  expect(restored[1].question).toBe('<p>Explain your plan</p>');
  expect(restored[1].resources.map(file => file.fileName)).toEqual(['intro.mp4', 'brief.pdf']);
  expect(restored[2].question).toBe('');
});
