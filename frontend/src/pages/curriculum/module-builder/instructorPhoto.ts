/**
 * Client-side checks for an instructor photo chosen from the computer.
 *
 * The file stays in the browser (an object URL for the preview) until Save
 * overview; the server repeats every check on the decoded image when it is
 * uploaded, so these exist to explain a problem early, not to enforce it.
 */

/** Mirrors backend/curriculum_api/module_overview.py (MAX_PHOTO_BYTES, MIN/MAX_PHOTO_SIDE, MAX_PHOTO_PIXELS). */
export type ImageLimits = { maxBytes: number; minWidth: number; minHeight: number; maxSide: number; maxPixels: number };

export const PHOTO_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  minSide: 64,
  minWidth: 64,
  minHeight: 64,
  maxSide: 6000,
  maxPixels: 36_000_000,
} as const;

/** Mirrors backend MAX_HERO_BYTES, MIN_HERO_WIDTH/HEIGHT, MAX_HERO_SIDE, MAX_HERO_PIXELS: a wide banner. */
export const HERO_LIMITS: ImageLimits = {
  maxBytes: 8 * 1024 * 1024,
  minWidth: 640,
  minHeight: 200,
  maxSide: 8000,
  maxPixels: 40_000_000,
};

export const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

export type PhotoType = 'jpeg' | 'png' | 'webp';
export type InspectedPhoto = { type: PhotoType | null; width: number; height: number };
export type PhotoInspector = (file: File) => Promise<InspectedPhoto>;

const EXTENSIONS: Record<PhotoType, string[]> = { jpeg: ['jpg', 'jpeg'], png: ['png'], webp: ['webp'] };

/** The image type from a file's first bytes (its signature), or null. */
export function sniffImageType(bytes: Uint8Array): PhotoType | null {
  const at = (offset: number, ...values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  return null;
}

async function imageSize(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('unreadable'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Reads the signature and decodes the image for its dimensions. Never uploads. */
export const inspectPhotoFile: PhotoInspector = async file => {
  const type = sniffImageType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!type) return { type: null, width: 0, height: 0 };
  try {
    return { type, ...(await imageSize(file)) };
  } catch {
    return { type: null, width: 0, height: 0 };
  }
};

const extensionOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

/** Why a chosen file cannot be used (by default as the instructor photo), or ''. */
export async function photoFileProblem(file: File, inspect: PhotoInspector = inspectPhotoFile, limits: ImageLimits = PHOTO_LIMITS): Promise<string> {
  const extension = extensionOf(file.name);
  if (!Object.values(EXTENSIONS).some(list => list.includes(extension))) return 'Choose a JPG, PNG or WebP image.';
  if (!file.size) return 'The selected file is empty.';
  if (file.size > limits.maxBytes) return `The image is too large. The maximum size is ${limits.maxBytes / (1024 * 1024)} MB.`;
  let inspected: InspectedPhoto;
  try {
    inspected = await inspect(file);
  } catch {
    return 'The file is not a valid JPG, PNG or WebP image.';
  }
  if (!inspected.type) return 'The file is not a valid JPG, PNG or WebP image.';
  if (!EXTENSIONS[inspected.type].includes(extension)) return 'The file name does not match its image type. Choose a JPG, PNG or WebP image.';
  const { width, height } = inspected;
  if (width < limits.minWidth || height < limits.minHeight) {
    return `The image is too small. Use at least ${limits.minWidth} × ${limits.minHeight} pixels.`;
  }
  if (width > limits.maxSide || height > limits.maxSide || width * height > limits.maxPixels) {
    return `The image is too large. Use at most ${limits.maxSide} pixels on each side.`;
  }
  return '';
}

export function formatBytes(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}
