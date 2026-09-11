import { describe, expect, it } from 'vitest';
import { fileProbe } from '../page';

describe('attachment type detection', () => {
  it('recognises a PDF filename on a protected extensionless URL', () => {
    expect(fileProbe('/learner_api/student-activity/apprenticeship/123/500/10/files/9/', 'Reading.pdf')).toBe('Reading.pdf');
  });

  it('uses the filename for other protected documents too', () => {
    expect(fileProbe('/file/123/?token=example', 'Worksheet.xlsx')).toBe('Worksheet.xlsx');
  });

  it('retains URL-based detection without a usable filename', () => {
    expect(fileProbe('/uploads/reading.pdf?download=1', 'Reading')).toBe('/uploads/reading.pdf');
    expect(fileProbe('/uploads/reading.pdf#page=2')).toBe('/uploads/reading.pdf');
  });
});
