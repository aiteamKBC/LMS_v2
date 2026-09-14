import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReviewPdfDownload } from '../ReviewPdfDownload';

describe('Signed MCM PDF download', () => {
  it('stays disabled until the server confirms every signature is saved', () => {
    const download = vi.fn();
    render(<ReviewPdfDownload availability={{ available: false, reason: 'The learner still needs to sign.' }} onDownload={download}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Download signed PDF' }));
    expect(download).not.toHaveBeenCalled();
    expect(screen.getByText('The learner still needs to sign.')).toBeVisible();
  });

  it('enables the download after the refreshed definition confirms the signature', async () => {
    const download = vi.fn().mockResolvedValue(undefined);
    const view = render(<ReviewPdfDownload availability={{ available: false, reason: 'Awaiting learner.' }} onDownload={download}/>);
    view.rerender(<ReviewPdfDownload availability={{ available: true, reason: '' }} onDownload={download}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Download signed PDF' }));
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
  });

  it('shows a server refusal and allows a retry instead of producing an unsigned download', async () => {
    const download = vi.fn().mockRejectedValue(new Error('A saved signature is missing.'));
    render(<ReviewPdfDownload availability={{ available: true, reason: '' }} onDownload={download}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Download signed PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A saved signature is missing.');
    expect(screen.getByRole('button', { name: 'Download signed PDF' })).toBeEnabled();
  });

  it('does not offer MCM export for other review types', () => {
    render(<ReviewPdfDownload availability={null} onDownload={vi.fn()}/>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
