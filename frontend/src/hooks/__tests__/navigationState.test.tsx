import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BackButton } from '@/components/navigation/BackButton';
import { hasUsableAppHistory } from '@/hooks/useSmartBack';
import { useListQueryState } from '@/hooks/useListQueryState';

const defaults = { search: '', status: 'all', page: 1, sort: 'name', direction: 'asc', tab: 'all', month: '' };

function ListHarness() {
  const { state, setValues } = useListQueryState(defaults);
  const navigate = useNavigate();
  return <>
    <output>{JSON.stringify(state)}</output>
    <button onClick={() => setValues({ search: 'Abbie', status: 'active' }, { resetPage: true })}>Filter</button>
    <button onClick={() => setValues({ page: 4 }, { replace: false })}>Page 4</button>
    <button onClick={() => setValues({ sort: 'lastActivity', direction: 'desc', tab: 'reviews', month: '2026-09' })}>More state</button>
    <button onClick={() => navigate('/detail')}>Open detail</button>
  </>;
}

function DetailHarness() {
  return <BackButton fallback="/list">Back</BackButton>;
}

function RoleListHarness() {
  const navigate = useNavigate();
  return <><ListHarness /><button onClick={() => navigate('/admin/list')}>Admin list</button></>;
}

describe('project navigation state', () => {
  it('rehydrates typed search, filters, pagination, sort, tab and month from the URL', () => {
    render(<MemoryRouter initialEntries={['/list?search=Abbie&status=active&page=3&sort=lastActivity&direction=desc&tab=reviews&month=2026-09']}><Routes><Route path="/list" element={<ListHarness />} /></Routes></MemoryRouter>);
    expect(screen.getByText(/"search":"Abbie"/)).toHaveTextContent('"page":3');
    expect(screen.getByText(/"search":"Abbie"/)).toHaveTextContent('"sort":"lastActivity"');
    expect(screen.getByText(/"search":"Abbie"/)).toHaveTextContent('"tab":"reviews"');
    expect(screen.getByText(/"search":"Abbie"/)).toHaveTextContent('"month":"2026-09"');
  });

  it('updates from URL history and preserves the exact list state after detail Back', () => {
    render(<MemoryRouter initialEntries={['/list?page=2']}><Routes><Route path="/list" element={<ListHarness />} /><Route path="/detail" element={<DetailHarness />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(screen.getByText(/"search":"Abbie"/)).toHaveTextContent('"page":1');
    fireEvent.click(screen.getByRole('button', { name: 'Page 4' }));
    fireEvent.click(screen.getByRole('button', { name: 'More state' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open detail' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/"search":"Abbie"/)).toHaveTextContent('"page":4');
    expect(screen.getByText(/"search":"Abbie"/)).toHaveTextContent('"direction":"desc"');
  });

  it('recognises only an in-app history index as safe for history Back', () => {
    expect(hasUsableAppHistory({ idx: 2 })).toBe(true);
    expect(hasUsableAppHistory({ idx: 0 })).toBe(false);
    expect(hasUsableAppHistory(null)).toBe(false);
  });

  it('uses the explicit fallback for a directly opened detail route', () => {
    render(<MemoryRouter initialEntries={['/detail']}><Routes><Route path="/detail" element={<DetailHarness />} /><Route path="/list" element={<div>Fallback list</div>} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Fallback list')).toBeInTheDocument();
  });

  it('keeps query state isolated to each role route', () => {
    render(<MemoryRouter initialEntries={['/coach/list?search=CoachOnly']}><Routes><Route path="/coach/list" element={<RoleListHarness />} /><Route path="/admin/list" element={<ListHarness />} /></Routes></MemoryRouter>);
    expect(screen.getByText(/CoachOnly/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Admin list' }));
    expect(screen.getByText(/"search":""/)).not.toHaveTextContent('CoachOnly');
  });
});
