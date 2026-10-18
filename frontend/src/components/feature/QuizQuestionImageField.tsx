import { useId, useRef, useState, type ChangeEvent } from 'react';
import { readImageFileAsDataUrl } from '@/lib/quizPairAnswers';
import { QuizQuestionImage } from './QuizQuestionImage';

export function QuizQuestionImageField({ imageUrl, onChange, disabled = false, onBusyChange }: {
  imageUrl?: string;
  onChange: (imageUrl: string) => void;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');

  const chooseImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setReading(true);
    onBusyChange(true);
    try {
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
        throw new Error('Choose a PNG, JPG, GIF or WEBP image.');
      }
      onChange(await readImageFileAsDataUrl(file));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not read this image.');
    } finally {
      setReading(false);
      onBusyChange(false);
    }
  };

  return (
    <div className="rounded-xl border border-foreground-200 bg-background-50 p-4">
      <p className="text-xs font-semibold text-foreground-700">Question image (optional)</p>
      <p id={`${inputId}-hint`} className="mt-1 text-xs text-foreground-500">Add a diagram or reference image. PNG, JPG, GIF or WEBP, up to 5 MB.</p>
      <QuizQuestionImage imageUrl={imageUrl} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={disabled || reading} onClick={() => inputRef.current?.click()}
          className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
          {reading ? 'Reading image...' : imageUrl ? 'Replace question image' : 'Upload question image'}
        </button>
        <input ref={inputRef} id={inputId} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
          aria-label="Question image" aria-describedby={`${inputId}-hint`} disabled={disabled || reading}
          className="hidden" onChange={chooseImage} />
        {imageUrl && <button type="button" disabled={disabled || reading} onClick={() => { setError(''); onChange(''); }}
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
          Remove question image
        </button>}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
