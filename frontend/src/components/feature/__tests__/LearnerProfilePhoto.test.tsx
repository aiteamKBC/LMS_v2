import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnerProfilePhoto } from '../LearnerProfilePhoto';
import { clearAllCachedResources } from '@/api/cachedRequest';

const props = { kind: 'commercial' as const, learnerId: '125', name: 'Mohamed Elmasry' };
const photoResponse = () => new Response('saved-jpeg', { headers: { 'Content-Type': 'image/jpeg' } });
const choose = (file = new File(['png'], 'photo.png', { type: 'image/png' })) => fireEvent.change(screen.getByLabelText('Choose profile photo'), { target: { files: [file] } });
let nextUrl = 0;
beforeEach(() => {
  clearAllCachedResources();
  nextUrl = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:photo-${++nextUrl}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { cleanup(); clearAllCachedResources(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('learner profile photo', () => {
  it('uploads with CSRF, displays the saved image and loads it on a later visit', async () => {
    let saved = false;
    const fetch = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      if (String(url).includes('/csrf')) return new Response(JSON.stringify({ csrfToken: 'csrf-token' }));
      if (options?.method === 'POST') { saved = true; return photoResponse(); }
      return saved ? photoResponse() : new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetch);
    const first = render(<LearnerProfilePhoto {...props} />);
    expect(screen.getByRole('button', { name: 'Upload profile photo' })).toBeVisible();
    choose();
    expect(await screen.findByRole('img', { name: "Mohamed Elmasry's profile photo" })).toHaveAttribute('src', 'blob:photo-1');
    const post = fetch.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(post[0]).toBe('/learner_api/profile-photo/commercial/125/');
    expect(new Headers(post[1]?.headers).get('X-CSRFToken')).toBe('csrf-token');
    expect((post[1]?.body as FormData).get('photo')).toBeInstanceOf(File);
    first.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo-1');
    render(<LearnerProfilePhoto {...props} />);
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:photo-2');
  });

  it('rejects unsuitable files before sending an upload', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    render(<LearnerProfilePhoto {...props} />);
    choose(new File(['svg'], 'photo.svg', { type: 'image/svg+xml' }));
    expect(screen.getByRole('alert')).toHaveTextContent('JPG, PNG or WebP');
    const large = new File(['png'], 'big.png', { type: 'image/png' });
    Object.defineProperty(large, 'size', { value: 5 * 1024 * 1024 + 1 });
    choose(large);
    expect(screen.getByRole('alert')).toHaveTextContent('5 MB');
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing photo when a replacement fails and allows retrying the same file', async () => {
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      if (String(url).includes('/csrf')) return new Response(JSON.stringify({ csrfToken: 'csrf-token' }));
      if (options?.method === 'POST' && fail) return new Response(JSON.stringify({ error: 'Storage unavailable. Try again.' }), { status: 503 });
      return photoResponse();
    }));
    render(<LearnerProfilePhoto {...props} />);
    const existing = await screen.findByRole('img');
    expect(existing).toHaveAttribute('src', 'blob:photo-1');
    const file = new File(['png'], 'photo.png', { type: 'image/png' });
    choose(file);
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
    expect(existing).toHaveAttribute('src', 'blob:photo-1');
    expect(screen.getByRole('button', { name: 'Change profile photo' })).toBeEnabled();
    fail = false;
    choose(file);
    await waitFor(() => expect(existing).toHaveAttribute('src', 'blob:photo-2'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores an older photo read that finishes after a successful upload', async () => {
    let finishRead!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      if (String(url).includes('/csrf')) return new Response(JSON.stringify({ csrfToken: 'csrf-token' }));
      if (options?.method === 'POST') return photoResponse();
      return new Promise<Response>(resolve => { finishRead = resolve; });
    }));
    render(<LearnerProfilePhoto {...props} />);
    choose();
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:photo-1');
    await act(async () => { finishRead(new Response(null, { status: 204 })); });
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:photo-1');
  });

  it('never shows the previous learner photo when the learner identity changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => String(url).includes('/125/') ? photoResponse() : new Response(null, { status: 204 })));
    const view = render(<LearnerProfilePhoto {...props} />);
    await screen.findByRole('img');
    view.rerender(<LearnerProfilePhoto {...props} learnerId="126" name="Other Learner" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Upload profile photo' })).toHaveTextContent('OL');
  });
});
