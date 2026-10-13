import { fireEvent, render, screen } from '@testing-library/react';
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

  it.each(['commercial', 'apprenticeship'])('plays a protected %s Azure video without an iframe', (role) => {
    const url = `/learner_api/student-activity/${role}/123/500/10/source-file/`;
    const onEnded = vi.fn();
    const { container } = render(<Media value={url} kind="video" title="Stored video" onEnded={onEnded} />);
    const video = container.querySelector('video')!;
    expect(video).toHaveAttribute('src', new URL(url, window.location.origin).href);
    expect(container.querySelector('iframe')).toBeNull();
    expect(onEnded).not.toHaveBeenCalled();
    fireEvent.ended(video);
    expect(onEnded).toHaveBeenCalledOnce();
  });

  it('uses the native player for an admin source file as well', () => {
    const url = '/login_api/advanced-admin/learners/123/learning/material/500/10/source-file/';
    const { container } = render(<Media value={url} kind="video" title="Stored video" />);
    expect(container.querySelector('video')).toHaveAttribute('src', new URL(url, window.location.origin).href);
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('passes the real filename to the protected document preview', async () => {
    const url = '/learner_api/student-activity/commercial/123/500/10/source-file/';
    render(<Media value={url} kind="document" title="Reading" fileName="reading.docx" />);
    expect(await screen.findByTestId('pdf-preview')).toHaveTextContent('reading.docx');
    expect(screen.getByTestId('pdf-preview')).toHaveAttribute('data-source', new URL(url, window.location.origin).href);
  });

  it('requests the existing Azure Office preview for a protected presentation', () => {
    const url = '/learner_api/student-activity/commercial/123/500/10/source-file/';
    render(<Media value={url} kind="document" title="Slides" fileName="lesson.pptx" />);
    expect(screen.getByTitle('Slides')).toHaveAttribute('src', new URL(`${url}?preview=1`, window.location.origin).href);
    expect(screen.getByRole('link')).toHaveAttribute('href', new URL(url, window.location.origin).href);
  });

  it('preserves the explicit open-in-new-tab restriction for stored media', () => {
    const { container } = render(<Media value="/learner_api/student-activity/commercial/123/500/10/source-file/"
      kind="video" title="Restricted video" canEmbed={false} />);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('link')).toBeVisible();
  });
});
