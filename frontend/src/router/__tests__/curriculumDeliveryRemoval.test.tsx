import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, type RouteObject } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import routes from '../config';

const retiredRoute = routes.flatMap<RouteObject>(route => route.children ?? [route])
  .find(route => route.path === '/curriculum/delivery');

function ProgrammesDestination() {
  return <output data-testid="destination">{useLocation().pathname}</output>;
}

describe('removed Curriculum Delivery page', () => {
  it.each(['/curriculum/delivery', '/curriculum/delivery?programme=P1'])('redirects the saved URL %s to Programmes', async path => {
    expect(retiredRoute).toBeDefined();
    render(<MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/curriculum/delivery" element={retiredRoute?.element} />
        <Route path="/curriculum/programmes" element={<ProgrammesDestination />} />
      </Routes>
    </MemoryRouter>);
    expect(await screen.findByTestId('destination')).toHaveTextContent('/curriculum/programmes');
  });
});
