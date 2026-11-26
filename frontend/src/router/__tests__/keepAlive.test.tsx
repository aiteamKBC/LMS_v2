import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useEffect, useState } from 'react';
import { Link, MemoryRouter, useLocation, useNavigate, useRoutes, useSearchParams } from 'react-router-dom';
import { KeepAliveSlot, LEARNER_PREVIEW_FROM, useKeptLocation } from '../keepAlive';

let mounts = 0;
let searchEffects = 0;

function Builder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [draft, setDraft] = useState('');
  useEffect(() => { mounts += 1; }, []);
  // Stands in for the builder's URL-driven effects: none may re-run.
  useEffect(() => { searchEffects += 1; }, [searchParams]);
  return <main>
    <div data-testid="rail" style={{ overflow: 'auto', height: 50 }}><div style={{ height: 500 }} /></div>
    <input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} />
    <button onClick={() => navigate('/learner/my-learning/commercial/pl.7.preview.MOD-A', { state: { [LEARNER_PREVIEW_FROM]: '/curriculum/module-builder?module=MOD-A' } })}>Preview</button>
    <Link to="/learner/my-learning/commercial/pl.7.preview.MOD-A">Plain link</Link>
  </main>;
}

function Learner() {
  const navigate = useNavigate();
  return <section>
    <p>Learner page {useLocation().pathname}</p>
    <Link to="/learner/video/1">Open activity</Link>
    <button onClick={() => navigate('/curriculum/module-builder?module=MOD-A')}>Return</button>
    <button onClick={() => navigate('/elsewhere')}>Elsewhere</button>
  </section>;
}

const routes = [
  { path: '/curriculum/module-builder', element: <Builder /> },
  { path: '/learner/*', element: <Learner /> },
  { path: '/elsewhere', element: <p>Elsewhere page</p> },
];

// The same composition as AppRoutes, without its providers.
function Host() {
  const location = useLocation();
  const kept = useKeptLocation(location);
  const element = useRoutes(routes, kept ?? location);
  const preview = useRoutes(routes, location);
  return <>{createElement(KeepAliveSlot, { hidden: !!kept }, element)}{kept ? preview : null}</>;
}

const start = () => render(<MemoryRouter initialEntries={['/curriculum/module-builder?module=MOD-A']}><Host /></MemoryRouter>);

afterEach(() => { cleanup(); mounts = 0; searchEffects = 0; });

describe('learner preview keeps the builder mounted', () => {
  it('returns to the same builder instance with its state, scroll and focus', () => {
    start();
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'unsaved edit' } });
    const rail = screen.getByTestId('rail');
    rail.scrollTop = 120;
    screen.getByRole('button', { name: 'Preview' }).focus();
    for (let round = 0; round < 3; round += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
      expect(screen.getByText(/Learner page/)).toBeInTheDocument();
      expect(screen.getByLabelText('Draft')).not.toBeVisible();
      // Moving between learner pages keeps the builder alive too.
      fireEvent.click(screen.getByRole('link', { name: 'Open activity' }));
      expect(screen.getByText('Learner page /learner/video/1')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Return' }));
      expect(screen.getByLabelText('Draft')).toHaveValue('unsaved edit');
      expect(screen.getByTestId('rail').scrollTop).toBe(120);
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Preview' }));
    }
    expect(mounts).toBe(1);
    expect(searchEffects).toBe(1);
  });

  it('keeps nothing for a link that did not come from the open builder', () => {
    start();
    fireEvent.click(screen.getByRole('link', { name: 'Plain link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Return' }));
    expect(mounts).toBe(2);
  });

  it('releases the builder when the preview goes anywhere else', () => {
    start();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.getByText('Elsewhere page')).toBeInTheDocument();
    expect(screen.queryByLabelText('Draft', { selector: 'input' })).toBeNull();
    expect(document.querySelectorAll('input')).toHaveLength(0);
  });
});
