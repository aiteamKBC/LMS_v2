export const COMPONENT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const COMPONENT_UPLOAD_MAX_LABEL = '5 MB';
export const COMPONENT_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export function assertComponentUploadAllowed(file: File) {
  if (file.size > COMPONENT_UPLOAD_MAX_BYTES) {
    throw new Error(`File is too large. Maximum upload size is ${COMPONENT_UPLOAD_MAX_LABEL}.`);
  }
}

/**
 * One guarded request path for every curriculum component upload. Module and
 * week-template components use different endpoints, but their timeout and
 * error behaviour must stay identical for reading, podcast, PowerPoint and
 * assignment files.
 */
export async function uploadComponentFile<T>(url: string, body: FormData): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), COMPONENT_UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `Curriculum API returned ${response.status} for upload`;
      try {
        const payload = await response.json();
        const detail = typeof payload?.detail === 'string' ? payload.detail : '';
        if (payload?.error) message = detail ? `${payload.error} ${detail}` : payload.error;
      } catch {
        // Preserve the status message when a proxy returns a non-JSON body.
      }
      throw new Error(message);
    }
    return response.json();
  } catch (error) {
    if ((error instanceof DOMException && error.name === 'AbortError') || (error instanceof Error && error.name === 'AbortError')) {
      throw new Error('The file upload is taking too long. It was stopped so you can retry.');
    }
    if (error instanceof TypeError) {
      throw new Error('The upload service could not be reached. Check your connection and that the backend service is running, then retry.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
