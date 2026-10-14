import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import type { KbBook } from '../api';
import { KnowledgeBookPicker, KnowledgeSourcesSummary } from '../KnowledgeBookPicker';
import { questionSourceLabel, scopeForProgramme } from '../sources';

vi.mock('../api', async importOriginal => ({ ...await importOriginal<typeof import('../api')>(), fetchBooks: vi.fn() }));

function book(id: string, title: string, scopes: string[], status = 'ready'): KbBook {
  return {
    id, title, scopes, archived: false, createdAt: '', live: status === 'ready',
    version: { id: 'v', fileName: 'f.pdf', sizeBytes: 1, pageCount: 10, edition: '' },
    build: { id: 'b', status: 'active', completeness: {} },
    processing: { status, stage: '', progress: {}, attempts: 1, lastError: '' },
  };
}

function Harness({ programme }: { programme: string }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      <KnowledgeBookPicker programme={programme} selected={selected} onChange={setSelected} />
      <output data-testid="selected">{selected.join(',')}</output>
    </>
  );
}

describe('KnowledgeBookPicker', () => {
  beforeEach(() => {
    vi.mocked(api.fetchBooks).mockResolvedValue([
      book('msp', 'Marketing Strategy & Planning', ['ME', 'MM']),
      book('pcp', 'Project Controls Handbook', ['PCP']),
      book('busy', 'Still processing', ['ME'], 'embedding'),
    ]);
  });

  it('maps programme names to scopes, with PMP inside PCP', () => {
    expect(scopeForProgramme('Marketing Executive Level 4')).toBe('ME');
    expect(scopeForProgramme('Marketing Manager Level 6')).toBe('MM');
    expect(scopeForProgramme('Project Controls Professional Level 6')).toBe('PCP');
    expect(scopeForProgramme('Project Management Professional')).toBe('PCP');
    expect(scopeForProgramme('Associate Project Manager Level 4')).toBe('APM');
    expect(scopeForProgramme('MBA')).toBeNull();
  });

  it('preselects the programme books and never offers unfinished ones', async () => {
    render(<Harness programme="Marketing Manager Level 6" />);
    await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('msp'));
    expect(screen.queryByText('Still processing')).not.toBeInTheDocument();
    expect(screen.getByText('Project Controls Handbook')).toBeInTheDocument();
  });

  it('keeps the author choice once changed', async () => {
    render(<Harness programme="Marketing Manager Level 6" />);
    await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('msp'));
    fireEvent.click(screen.getByLabelText('Project Controls Handbook'));
    fireEvent.click(screen.getByLabelText('Marketing Strategy & Planning'));
    expect(screen.getByTestId('selected').textContent).toBe('pcp');
  });

  it('selects nothing for a programme without a Knowledge Base scope', async () => {
    render(<Harness programme="MBA" />);
    await screen.findByText('Marketing Strategy & Planning');
    expect(screen.getByTestId('selected').textContent).toBe('');
  });
});

describe('KnowledgeSourcesSummary', () => {
  const meta = {
    mode: 'whole_book', books: [{ id: 'msp', title: 'MSP' }], chaptersTotal: 20, chaptersUsed: ['1 Strategy', '9 Pricing'],
    sections: [{ book: 'MSP', chapter: '1 Strategy', section: '1.1 SWOT', pages: '3' }], tokens: 1200, ceiling: 2200, warnings: ['low_content'],
    questionSources: [{ index: 0, book: 'MSP', section: '1.1 SWOT', pages: '3', confidence: 0.8 }, { index: 1, book: null, section: null, pages: null, confidence: 0.1 }],
  };

  it('declares partial coverage of the book honestly', () => {
    render(<KnowledgeSourcesSummary meta={meta} />);
    expect(screen.getByText(/covers 2 of 20 chapters/)).toBeInTheDocument();
    expect(screen.getByText(/little content on this topic/)).toBeInTheDocument();
    expect(screen.queryByText(/matched by keywords/)).not.toBeInTheDocument();
  });

  it('says when passages were matched by keywords only', () => {
    render(<KnowledgeSourcesSummary meta={{ ...meta, warnings: ['keyword_search_only'] }} />);
    expect(screen.getByText(/matched by keywords/)).toBeInTheDocument();
  });

  it('labels question sources as probable, and undetermined when unsure', () => {
    expect(questionSourceLabel(meta, 0)).toBe('Probable source: 1.1 SWOT, p. 3');
    expect(questionSourceLabel(meta, 1)).toBe('Probable source: not determined');
    expect(questionSourceLabel(null, 0)).toBeNull();
  });

  it('reports supplied images and excluded unavailable images', () => {
    render(<KnowledgeSourcesSummary meta={{ ...meta, imagesAvailable: 3, warnings: ['book_image_unavailable'] }} />);
    expect(screen.getByText('3 book image(s) supplied')).toBeVisible();
    expect(screen.getByText(/Some book images could not be loaded/)).toBeVisible();
  });
});
