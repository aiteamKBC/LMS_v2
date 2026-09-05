import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadComponentResource } from '../moduleAuthoringData';
import { uploadWeekComponentResource } from '../../week-builder/weekTemplateData';
import { COMPONENT_UPLOAD_MAX_BYTES, COMPONENT_UPLOAD_MAX_LABEL } from '../../shared/componentUploadPolicy';

const input = () => ({
  moduleCatalogueId: 'MOD-1',
  componentId: 'COMP-1',
  componentType: 'powerpoint' as const,
  file: new File(['fake deck'], 'deck.pptx', {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }),
});

describe('component uploads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('turns a raw browser fetch failure into an actionable upload message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(uploadComponentResource(input())).rejects.toThrow(
      'The upload service could not be reached. Check your connection and that the backend service is running, then retry.',
    );
  });

  it('shows the backend storage message when the service returns a retryable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'The file could not be stored. Please retry the upload.',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(uploadComponentResource(input())).rejects.toThrow(
      'The file could not be stored. Please retry the upload.',
    );
  });

  it(`rejects files over ${COMPONENT_UPLOAD_MAX_LABEL} before making a network request`, async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const oversized = new File([], 'large.pptx');
    Object.defineProperty(oversized, 'size', { value: COMPONENT_UPLOAD_MAX_BYTES + 1 });

    await expect(uploadComponentResource({ ...input(), file: oversized })).rejects.toThrow(
      `File is too large. Maximum upload size is ${COMPONENT_UPLOAD_MAX_LABEL}.`,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['reading', 'guide.docx'],
    ['podcast', 'episode.mp3'],
    ['powerpoint', 'deck.pptx'],
    ['assignment', 'brief.pdf'],
  ] as const)('sends %s through the same guarded module upload request', async (componentType, filename) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      uploaded: true,
      file: { fileName: filename },
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await uploadComponentResource({
      ...input(),
      componentType,
      file: new File(['component'], filename),
    });

    const request = fetchMock.mock.calls[0][1] as { body: FormData; signal?: unknown };
    expect(request.body.get('componentType')).toBe(componentType);
    expect(request.signal).toBeTruthy();
  });

  it('uses the same actionable errors for week-template reading uploads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'The file could not be stored. Please retry the upload.',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(uploadWeekComponentResource(
      'COMP-READING',
      new File(['reading'], 'guide.docx'),
      'reading',
    )).rejects.toThrow('The file could not be stored. Please retry the upload.');
  });
});
