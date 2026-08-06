import { useState } from 'react';
import { RECORDING_CATCH_UP_FORM } from '@/mocks/attendance';

export default function RecordingCatchUpForm() {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({
    sessionTitle: RECORDING_CATCH_UP_FORM.defaults.sessionTitle,
    sessionDate: RECORDING_CATCH_UP_FORM.defaults.sessionDate,
    recordingDate: '',
    timeSpent: '',
    keyLearning: '',
    workplaceApplication: '',
    ksbLink: '',
    reflection: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const allFilled = RECORDING_CATCH_UP_FORM.fields.every(f => !f.required || formData[f.name]?.trim());
    if (!allFilled) return;
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="text-center py-8">
        <span className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
          <AppIcon className="ri-check-line text-emerald-600 text-2xl"></AppIcon>
        </span>
        <h4 className="text-base font-heading font-semibold text-foreground-900 mb-2">Evidence Submitted!</h4>
        <p className="text-sm text-foreground-500 max-w-sm mx-auto leading-relaxed">
          Your catch-up evidence has been submitted. Your coach will review it and you'll be notified once it's approved.
        </p>
        <button
          onClick={() => setSubmitted(false)}
          className="mt-5 text-sm font-medium text-primary-600 hover:text-primary-700 whitespace-nowrap cursor-pointer"
        >
          Submit Another Catch-Up
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="w-7 h-7 rounded-lg bg-accent-100 flex items-center justify-center">
            <AppIcon className="ri-play-circle-line text-accent-600 text-sm"></AppIcon>
          </span>
          <h4 className="text-sm font-heading font-semibold text-foreground-900">Recording Catch-Up Evidence</h4>
        </div>
        <p className="text-xs text-foreground-400 ml-[38px]">Complete this evidence form after watching the session recording.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {RECORDING_CATCH_UP_FORM.fields.filter(f => f.type === 'text' || f.type === 'date').map((field) => (
            <div key={field.name}>
              <label className="block text-xs font-medium text-foreground-600 mb-1.5">
                {field.label} {field.required && <span className="text-red-500">*</span>}
              </label>
              <input
                type={field.type}
                name={field.name}
                value={formData[field.name] || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, [field.name]: e.target.value }))}
                placeholder={field.placeholder || ''}
                className="w-full px-3 py-2 rounded-lg border border-background-200 bg-white text-sm text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 transition-smooth"
                required={field.required}
              />
            </div>
          ))}
        </div>

        {RECORDING_CATCH_UP_FORM.fields.filter(f => f.type === 'textarea').map((field) => (
          <div key={field.name}>
            <label className="block text-xs font-medium text-foreground-600 mb-1.5">
              {field.label} {field.required && <span className="text-red-500">*</span>}
            </label>
            <textarea
              name={field.name}
              value={formData[field.name] || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, [field.name]: e.target.value }))}
              maxLength={field.maxLength || 500}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-background-200 bg-white text-sm text-foreground-900 placeholder:text-foreground-300 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 transition-smooth resize-none"
              required={field.required}
              placeholder={`Enter your ${field.label.toLowerCase()}...`}
            />
            <p className="text-[10px] text-foreground-300 text-right mt-0.5">
              {(formData[field.name] || '').length}/{field.maxLength || 500}
            </p>
          </div>
        ))}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-primary-500 text-background-50 text-sm font-semibold hover:bg-primary-600 transition-smooth whitespace-nowrap cursor-pointer"
          >
            <AppIcon className="ri-upload-cloud-2-line"></AppIcon> Submit Evidence
          </button>
          <button
            type="button"
            className="text-sm text-foreground-400 hover:text-foreground-600 whitespace-nowrap cursor-pointer"
          >
            Save Draft
          </button>
        </div>
      </form>
    </div>
  );
}