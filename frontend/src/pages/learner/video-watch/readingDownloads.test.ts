import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadReadingPdf, readingFiles, readingText } from './readingDownloads';

const pdf = vi.hoisted(() => ({ setProperties: vi.fn(), addPage: vi.fn(), addImage: vi.fn(), save: vi.fn() }));
vi.mock('jspdf', () => ({ jsPDF: class { constructor() { return pdf; } } }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('reading original files', () => {
  it('finds linked PDF files without a direct attachment and keeps signed query parameters', () => {
    expect(readingFiles(null, null, '<p><a href="/files/reading.pdf?token=synthetic">Reading PDF</a></p>'))
      .toEqual([{ url: '/files/reading.pdf?token=synthetic', fileName: undefined, label: 'Reading PDF' }]);
  });
  it('deduplicates the attached file and keeps distinct linked files', () => {
    const files = readingFiles('/reading.pdf', 'Reading.pdf', '<a href="/reading.pdf">Copy</a><a href="/other.docx">Supporting notes</a>');
    expect(files).toHaveLength(2);
    expect(files[0].fileName).toBe('Reading.pdf');
    expect(files[1].url).toBe('/other.docx');
  });
  it('ignores navigation, scripts and fragment links', () => {
    expect(readingFiles(null, null, '<a href="/about">About</a><a href="javascript:alert(1)">PDF</a><a href="#section">PDF</a>')).toEqual([]);
  });
  it('handles escaped legacy HTML and protected download links', () => {
    expect(readingFiles(null, null, '&lt;a href="/materials/123"&gt;Reading (PDF)&lt;/a&gt;')[0].url).toBe('/materials/123');
  });
});

it('extracts readable text with paragraph boundaries, lists and no hidden content or markup', () => {
  expect(readingText('<h2>Topic</h2><p>First <mark>point</mark><br>Next</p><ul><li>Action</li></ul><p hidden>Hidden</p><script>bad()</script>'))
    .toBe('Topic\n\nFirst point\nNext\n\n• Action');
});

it('exports long reading text across pages without truncating long words or changing Unicode text', async () => {
  const drawn: string[] = [];
  const context = {
    fillRect: vi.fn(),
    fillText: vi.fn((value: string) => drawn.push(value)),
    measureText: (value: string) => ({ width: value.length * 12 }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,synthetic');
  const longWord = 'Z'.repeat(300);
  const text = '<p>قراءة عربية</p>' + '<p>Long reading paragraph</p>'.repeat(80) + '<p>' + longWord + '</p>';
  await downloadReadingPdf('Reading: topic', text);
  expect(pdf.addPage).toHaveBeenCalled();
  expect(drawn).toContain('قراءة عربية');
  expect(drawn.filter(line => /^Z+$/.test(line)).join('')).toBe(longWord);
  expect(pdf.save).toHaveBeenCalledWith('Reading- topic.pdf');
});

it('reports empty content rather than saving a blank PDF', async () => {
  await expect(downloadReadingPdf('Empty', '<p></p>')).rejects.toThrow('There is no reading text');
  expect(pdf.save).not.toHaveBeenCalled();
});
