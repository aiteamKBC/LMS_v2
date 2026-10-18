import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuizQuestionImageField } from '../QuizQuestionImageField';

function Field() {
  const [imageUrl, setImageUrl] = useState('');
  return <QuizQuestionImageField imageUrl={imageUrl} onChange={setImageUrl} onBusyChange={() => {}} />;
}

describe('optional question diagram', () => {
  it('uploads, previews, replaces and removes an image', async () => {
    render(<Field />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const input = screen.getByLabelText('Question image');
    fireEvent.change(input, { target: { files: [new File(['diagram'], 'diagram.png', { type: 'image/png' })] } });
    const first = await screen.findByAltText('Question diagram');
    expect(first).toHaveAttribute('src', 'data:image/png;base64,ZGlhZ3JhbQ==');
    expect(first).toHaveClass('object-contain');
    fireEvent.change(input, { target: { files: [new File(['replacement'], 'replacement.png', { type: 'image/png' })] } });
    await waitFor(() => expect(screen.getByAltText('Question diagram')).toHaveAttribute('src', 'data:image/png;base64,cmVwbGFjZW1lbnQ='));
    fireEvent.click(screen.getByRole('button', { name: 'Remove question image' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload question image' })).toBeEnabled();
  });

  it('rejects non-images and oversized files without replacing the saved diagram', async () => {
    const change = vi.fn();
    render(<QuizQuestionImageField imageUrl="data:image/png;base64,c2F2ZWQ=" onChange={change} onBusyChange={() => {}} />);
    const input = screen.getByLabelText('Question image');
    fireEvent.change(input, { target: { files: [new File(['text'], 'text.txt', { type: 'text/plain' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('PNG, JPG, GIF or WEBP');
    const large = new File(['image'], 'large.png', { type: 'image/png' });
    Object.defineProperty(large, 'size', { value: 5 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [large] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('5 MB'));
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByAltText('Question diagram')).toHaveAttribute('src', 'data:image/png;base64,c2F2ZWQ=');
  });
});
