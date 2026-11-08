import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComponentEditor } from './page';
import type { ModuleComponent } from './weekTemplateData';

vi.mock('@/pages/curriculum/module-builder/LiveSessionScheduleEditor', () => ({
  LiveSessionScheduleEditor: () => <button>Change meeting schedule</button>,
}));
vi.mock('@/pages/curriculum/shared/entities/liveSessionArtifacts', () => ({
  LiveSessionArtifactsPanel: () => <div>Saved session results</div>,
  ModuleLiveSessionResults: () => <div>Saved module results</div>,
}));

const component: ModuleComponent = {
  id: 'COMP-LEGACY', weekId: 'WEEK-LEGACY', type: 'live-session', title: 'Existing live activity',
  description: 'Retained content', expectedOtjh: 1, points: 0, reflectionRequired: false,
  reflectionQuestion: '', workplaceEvidenceRequired: false, tutorValidationRequired: false,
  coachValidationRequired: false, ksbMappings: [],
  settings: { teamsLiveSessionId: 'LIVE-KEEP', teamsOccurrenceId: 'OCC-KEEP', liveSessionUrl: 'https://example.test/meeting' },
};

describe('Existing live activities in adopted free courses', () => {
  it('keeps the saved link and results while withholding meeting changes', () => {
    const onChange = vi.fn();
    render(<ComponentEditor selfStudyOnly component={component} onChange={onChange} onBack={vi.fn()}
      groupOptions={[]} weekScope={{ courseType: 'free', programmeId: '', programmeName: '', moduleName: '' }} />);
    expect(screen.getByDisplayValue('https://example.test/meeting')).toHaveAttribute('readonly');
    expect(screen.getByText('Saved session results')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change meeting schedule' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the ordinary module meeting editor available', () => {
    render(<ComponentEditor component={component} onChange={vi.fn()} onBack={vi.fn()}
      groupOptions={[]} weekScope={{ courseType: 'paid', programmeId: 'PROG-1', programmeName: 'Programme', moduleName: 'Module' }} />);
    expect(screen.getByRole('button', { name: 'Change meeting schedule' })).toBeInTheDocument();
  });
});
