import { describe, expect, it } from 'vitest';
import { moduleBuilderIdentifier, moduleBuilderUrl, moduleWorkspaceIdentity, moduleWorkspaceUrl } from './navigation';
import { learnerInitials, learnerTint } from './roster';
import { cohortStatus, groupStatus, matchesRecordStatus, moduleStatus, staffNameOptions } from './records';
import { clean, uniqueCleanValues } from './presentation';

describe('programme consumer identity contracts', () => {
  it('prefers a canonical candidate over a legacy alias without rewriting either', () => {
    expect(moduleBuilderIdentifier({ id: 'legacy-id', moduleCatalogueId: 'alias', moduleId: ' MOD-123 ' })).toBe('MOD-123');
    expect(moduleBuilderIdentifier({ id: 'legacy-id', moduleCatalogueId: 'alias' })).toBe('alias');
    expect(moduleBuilderIdentifier({ id: '' })).toBe('');
  });
  it('preserves workspace identity precedence even when builder chooses a canonical candidate', () => {
    const module = { id: 'MOD-123', moduleCatalogueId: 'legacy-alias', name: 'Example' };
    expect(moduleWorkspaceIdentity(module)).toBe('legacy-alias');
    expect(moduleWorkspaceUrl(module)).toContain('legacy-alias');
    expect(moduleWorkspaceUrl({ id: '', name: '' })).toBe('');
  });
  it('preserves module/programme labels and deep-link parameters', () => {
    const url = new URL(moduleBuilderUrl(
      { id: 'MOD-123', name: 'Example & title' },
      { id: 'internal', sourceId: 'PROG-A', name: 'Programme A' },
      { weekId: 'week-1', componentId: 'component-2' },
    ), 'https://local.invalid');
    expect(url.pathname).toBe('/curriculum/module-builder');
    expect(Object.fromEntries(url.searchParams)).toEqual({ module: 'MOD-123', moduleTitle: 'Example & title', programme: 'PROG-A', programmeName: 'Programme A', week: 'week-1', component: 'component-2' });
    expect(moduleBuilderUrl({ id: '', name: '' })).toBe('/curriculum/module-builder');
  });
});

describe('programme presentation contracts', () => {
  it('normalizes whitespace and deduplicates labels using the existing normalized key', () => {
    expect(clean(' \t Name\n')).toBe('Name');
    expect(uniqueCleanValues([' Name ', 'Name', 'name', '', undefined])).toEqual(['Name']);
  });
  it('preserves empty, single and multiple-name avatars and deterministic identity tint', () => {
    expect(learnerInitials('')).toBe('--');
    expect(learnerInitials(' Ada ')).toBe('A');
    expect(learnerInitials('Ada Middle Example')).toBe('AE');
    expect(learnerTint('registration-7')).toBe(learnerTint('registration-7'));
  });
  it('keeps record status aliases and default behavior', () => {
    expect(groupStatus('pending')).toBe('planned');
    expect(cohortStatus('unknown')).toBe('active');
    expect(moduleStatus('review')).toBe('in-review');
    expect(moduleStatus('unknown')).toBe('published');
    expect(matchesRecordStatus(true, 'active')).toBe(false);
    expect(matchesRecordStatus(true, 'archived')).toBe(true);
    expect(matchesRecordStatus(true, 'all')).toBe(true);
  });
  it('retains assigned coach names when the staff directory is unavailable', () => {
    expect(staffNameOptions(undefined, ['Coach B', 'Coach A', 'Coach A'])).toEqual(['Coach A', 'Coach B']);
  });
});
