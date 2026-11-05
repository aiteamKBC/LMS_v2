import type { QualityReviewType } from '@/api/coachingQualityReviews';
import { qualityTypeLabels } from './qualityReviewType';

export default function QualityTypePicker({ value, onChange, disabled = false }: { value: QualityReviewType | ''; onChange: (value: QualityReviewType) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled} className="min-w-0"><legend className="mb-2 text-xs font-semibold text-foreground-600">Quality form type</legend>
    <div className="grid gap-2 sm:grid-cols-2">{(['MCM', 'PR'] as const).map(kind => <label key={kind} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${value === kind ? 'border-primary-500 bg-primary-50 text-primary-900' : 'border-background-200 bg-white text-foreground-700'} has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary-500 has-[:disabled]:cursor-default has-[:disabled]:opacity-60`}>
      <input type="radio" name="quality-review-type" aria-label={kind} checked={value === kind} onChange={() => onChange(kind)} className="accent-primary-600" />
      <span><span className="block font-bold">{kind}</span><span className="mt-0.5 block text-xs">{qualityTypeLabels[kind]}</span></span>
    </label>)}</div>
  </fieldset>;
}
