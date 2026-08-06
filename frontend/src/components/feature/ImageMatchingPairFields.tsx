import { ChangeEvent, useId, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { useToast } from '@/hooks/useToast';
import { parseQuizPairAnswer, readImageFileAsDataUrl, serializeQuizPairAnswer } from '@/lib/quizPairAnswers';

export function ImageMatchingPairFields({
  value,
  onChange,
  matchPlaceholder = 'Match',
  labelPlaceholder = 'Optional image label',
}: {
  value: string;
  onChange: (nextValue: string) => void;
  matchPlaceholder?: string;
  labelPlaceholder?: string;
}) {
  const inputId = useId();
  const { error: toastError } = useToast();
  const [uploading, setUploading] = useState(false);
  const pair = parseQuizPairAnswer(value, 'image_matching');

  const updatePair = (patch: Partial<typeof pair>) => {
    onChange(serializeQuizPairAnswer('image_matching', { ...pair, ...patch }));
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    try {
      const imageUrl = await readImageFileAsDataUrl(file);
      updatePair({ imageUrl });
    } catch (err) {
      toastError('Image upload failed', err instanceof Error ? err.message : 'Could not load this image.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid flex-1 min-w-0 grid-cols-1 sm:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)] gap-2">
      <div className="rounded-xl border border-[#d8dde6] bg-white p-3 space-y-3">
        {pair.imageUrl ? (
          <img
            src={pair.imageUrl}
            alt={pair.left || 'Matching prompt image'}
            className="h-28 w-full rounded-lg border border-[#e2e8f0] object-cover bg-[#f8fafc]"
          />
        ) : (
          <div className="flex h-28 w-full flex-col items-center justify-center rounded-lg border border-dashed border-[#d8dde6] bg-[#f8fafc] px-3 text-center">
            <AppIcon className="ri-image-add-line text-xl text-[#8b5cf6]"></AppIcon>
            <p className="mt-2 text-xs font-semibold text-[#475569]">Upload an image for this match</p>
            <p className="mt-1 text-[11px] text-[#64748b]">PNG, JPG, GIF, WEBP or SVG up to 5 MB</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <label
            htmlFor={inputId}
            className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[#5b2dbb] px-3 text-xs font-semibold !text-white hover:bg-[#4c1d95]"
          >
            <AppIcon className="ri-upload-2-line mr-1 text-white"></AppIcon>
            <span className="text-white">{uploading ? 'Uploading...' : pair.imageUrl ? 'Replace image' : 'Upload image'}</span>
          </label>
          <input id={inputId} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
          {pair.imageUrl && (
            <button
              type="button"
              onClick={() => updatePair({ imageUrl: '' })}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 hover:bg-red-100"
            >
              <AppIcon className="ri-delete-bin-line mr-1"></AppIcon>Remove image
            </button>
          )}
        </div>

        <input
          value={pair.left}
          onChange={event => updatePair({ left: event.target.value })}
          placeholder={labelPlaceholder}
          className="h-10 w-full rounded-lg border border-[#d8dde6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe]"
        />
      </div>

      <span className="hidden sm:flex items-center justify-center text-[#5b2dbb]">
        <AppIcon className="ri-arrow-right-line"></AppIcon>
      </span>

      <input
        value={pair.right}
        onChange={event => updatePair({ right: event.target.value })}
        placeholder={matchPlaceholder}
        className="min-w-0 h-10 rounded-lg border border-[#d8dde6] bg-white px-3 text-sm outline-none focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#ede9fe] sm:self-center"
      />
    </div>
  );
}
