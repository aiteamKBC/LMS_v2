/** Programme display name -> Knowledge Base scope. PMP is a module inside PCP. */
export function scopeForProgramme(programme: string): string | null {
  const name = programme.toLowerCase();
  if (name.includes('marketing executive')) return 'ME';
  if (name.includes('marketing manager')) return 'MM';
  if (name.includes('associate project manager')) return 'APM';
  if (name.includes('project control') || name.includes('project management professional')) return 'PCP';
  return null;
}

export interface KnowledgeSourcesMeta {
  mode: 'topic' | 'whole_book' | string;
  books: { id: string; title: string }[];
  chaptersTotal: number;
  chaptersUsed: string[];
  sections: { book: string; chapter: string; section: string; pages: string }[];
  tokens: number;
  ceiling: number;
  warnings: string[];
  imagesAvailable?: number;
  questionImages?: { index: number; assetId: number; occurrenceId: number; book: string; section: string; page: number }[];
  questionSources?: { index: number; book: string | null; section: string | null; pages: string | null; confidence: number }[];
}

export function questionSourceLabel(meta: KnowledgeSourcesMeta | null, index: number) {
  const source = meta?.questionSources?.find(s => s.index === index);
  if (!source) return null;
  if (!source.section) return 'Probable source: not determined';
  return `Probable source: ${source.section}, p. ${source.pages}`;
}
