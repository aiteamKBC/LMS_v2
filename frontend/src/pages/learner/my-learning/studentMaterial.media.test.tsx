import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Media } from './StudentMaterial';

vi.mock('../video-watch/page', () => ({
  InlineAttachmentPreview: ({ url, fileName }: { url: string; fileName: string }) =>
    <div data-testid="pdf-preview" data-source={url}>{fileName}</div>,
}));

describe('subject PDF previews', () => {
  it('uses the local renderer for a protected PDF endpoint without a filename extension', async () => {
    const url = '/learner_api/student-activity/apprenticeship/123/500/10/files/9/';
    const { container } = render(<Media value={url} kind="pdf" title="Reading" fileName="Reading.pdf" />);
    expect(await screen.findByTestId('pdf-preview')).toHaveAttribute('data-source', new URL(url, window.location.origin).href);
    expect(screen.getByTestId('pdf-preview')).toHaveTextContent('Reading.pdf');
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('link')).toHaveAttribute('href', new URL(url, window.location.origin).href);
  });

  it('preserves ordinary embeds', () => {
    render(<Media value="https://example.org/lesson" kind="embed" title="Lesson" />);
    expect(screen.getByTitle('Lesson')).toHaveAttribute('src', 'https://example.org/lesson');
  });
});
