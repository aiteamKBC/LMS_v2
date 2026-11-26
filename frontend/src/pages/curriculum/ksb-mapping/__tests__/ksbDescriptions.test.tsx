import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CurriculumKsbCoverageItem, CurriculumProgramme } from '@/lib/curriculumApi';

/**
 * The coverage endpoint sends a KSB's code in `title` and its wording in
 * `description`. Reading `title` first left every row on this page saying "No
 * description provided" for a programme whose KSB source was correctly applied.
 */

vi.mock('@/components/feature/WorkspaceShell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const programmes = [
  { id: 'PROG-1', sourceId: 'PROG-1', name: 'MSN', level: '6', status: 'active' },
] as unknown as CurriculumProgramme[];

const items = [
  {
    ksb_id: 'KSBP-1:K1', ksbId: 'KSBP-1:K1', code: 'K1',
    // What the backend actually sends: the code as the title.
    title: 'K1', description: 'Marketing Concepts & Theories',
    ksb_type: 'knowledge', ksbType: 'knowledge', mappings: [],
  },
  {
    ksb_id: 'KSBP-1:B1', ksbId: 'KSBP-1:B1', code: 'B1',
    // A KSB with no wording of its own: the code comes back in both fields.
    title: 'B1', description: 'B1',
    ksb_type: 'behaviour', ksbType: 'behaviour', mappings: [],
  },
] as unknown as CurriculumKsbCoverageItem[];

let source: Record<string, unknown> | null = {
  type: 'framework', id: 'KSBP-1', origin: 'programme',
  required_count: 2, requiredCount: 2,
  source_name: 'Marketing Manager', sourceName: 'Marketing Manager',
};

vi.mock('@/lib/curriculumApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/curriculumApi')>()),
  fetchCurriculumProgrammes: vi.fn(async () => programmes),
  fetchCurriculumProgrammeKsbCoverage: vi.fn(async () => ({
    source,
    items,
    summary: {
      overall: { required: 2, mapped: 0, unmapped: 2, total_weight: 0 },
      knowledge: { required: 1, mapped: 0, unmapped: 1, total_weight: 0 },
      skills: { required: 0, mapped: 0, unmapped: 0, total_weight: 0 },
      behaviours: { required: 1, mapped: 0, unmapped: 1, total_weight: 0 },
    },
  })),
}));

async function renderPage() {
  const { default: Page } = await import('../page');
  return render(<MemoryRouter initialEntries={['/curriculum/ksb-mapping']}><Page /></MemoryRouter>);
}

describe('KSB Mapping', () => {
  beforeEach(() => {
    source = {
      type: 'framework', id: 'KSBP-1', origin: 'programme',
      required_count: 2, requiredCount: 2,
      source_name: 'Marketing Manager', sourceName: 'Marketing Manager',
    };
  });

  it('shows the KSB wording, and the placeholder only when there is none', async () => {
    await renderPage();

    expect(await screen.findByText('Marketing Concepts & Theories')).toBeInTheDocument();
    // B1 carries no wording, so the row says so rather than repeating its code.
    expect(screen.getByText('No description provided')).toBeInTheDocument();
  });

  it('names the source the required set came from', async () => {
    await renderPage();

    expect(await screen.findByText('Marketing Manager')).toBeInTheDocument();
  });

  it('says so when no source is set and every profile stood in', async () => {
    source = { type: '', id: '', origin: 'all-profiles', required_count: 2, requiredCount: 2 };
    await renderPage();

    expect(await screen.findByText(/No KSB source is set for this programme/)).toBeInTheDocument();
  });
});
