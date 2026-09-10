import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useLinkedLearner, rememberLearner } from '../useMyLearner';

beforeEach(() => localStorage.clear());

describe('Training Plan learner links', () => {
  it('keeps the explicit learner when another tab last selected someone else', () => {
    rememberLearner('commercial', '19');
    const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/learner/calendar?kind=commercial&learner=125&event=review-1']}>{children}</MemoryRouter>;
    const { result } = renderHook(() => ({ learner: useLinkedLearner(), navigate: useNavigate() }), { wrapper });
    expect(result.current.learner).toEqual({ kind: 'commercial', id: '125' });
    act(() => result.current.navigate('/learner/progress-reviews?kind=apprenticeship&learner=126'));
    expect(result.current.learner).toEqual({ kind: 'apprenticeship', id: '126' });
    act(() => result.current.navigate('/learner/progress-reviews'));
    expect(result.current.learner.id).toBe('126');
  });

  it('ignores malformed learner links', () => {
    rememberLearner('commercial', '125');
    const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/?kind=commercial&learner=-1']}>{children}</MemoryRouter>;
    expect(renderHook(useLinkedLearner, { wrapper }).result.current).toEqual({ kind: 'commercial', id: '125' });
  });
});
