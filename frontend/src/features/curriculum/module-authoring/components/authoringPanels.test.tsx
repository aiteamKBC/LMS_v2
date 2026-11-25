import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceActionFooter } from './SaveStatus';
import { KsbCards } from './KsbCards';
import type { KsbMapping } from '@/pages/curriculum/module-builder/moduleAuthoringData';

describe('extracted authoring panels', () => {
  it('forwards save and autosave actions once without owning the timer', () => {
    const save = vi.fn();
    const toggle = vi.fn();
    render(<WorkspaceActionFooter saving={false} saved={false} status="manual" autoSave={false} onToggleAutoSave={toggle} onEditModule={vi.fn()} onModuleSettings={vi.fn()} onDelete={vi.fn()} onSave={save} />);
    expect(screen.getByTestId('module-builder-save-state')).toHaveTextContent('Unsaved changes - press Save');
    fireEvent.click(screen.getByTestId('module-builder-save'));
    fireEvent.click(screen.getByTestId('module-builder-auto-save-toggle'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('keeps archived save and autosave controls disabled', () => {
    const save = vi.fn();
    const toggle = vi.fn();
    render(<WorkspaceActionFooter saving={false} saved={false} status="locked" locked autoSave={false} onToggleAutoSave={toggle} onEditModule={vi.fn()} onModuleSettings={vi.fn()} onDelete={vi.fn()} onSave={save} />);
    expect(screen.getByTestId('module-builder-save')).toBeDisabled();
    expect(screen.getByTestId('module-builder-auto-save-toggle')).toBeDisabled();
    fireEvent.click(screen.getByTestId('module-builder-save'));
    expect(save).not.toHaveBeenCalled();
  });

  it('preserves the KSB mapping id in the removal callback', () => {
    const remove = vi.fn();
    const mapping: KsbMapping = { id: 'mapping-one', ksbId: 'K1', code: 'K1', description: 'Synthetic knowledge', type: 'main', weight: 50, weightClass: 'hard', sourceType: 'standard', sourceId: 'standard:one' };
    render(<KsbCards title="Knowledge" mappings={[mapping]} onRemove={remove} />);
    fireEvent.click(screen.getByRole('button'));
    expect(remove).toHaveBeenCalledExactlyOnceWith('mapping-one');
  });
});
