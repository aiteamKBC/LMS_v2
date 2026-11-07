import { useEffect, useId, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { formatClock } from '@/components/feature/ReflectionWindow.helpers';
import manualTimeStyles from './ActivityManualTimeInput.module.css';

export function ActivityTimeSpentInput({ onChange, initialSeconds = null }: { onChange: (seconds: number | null) => void; initialSeconds?: number | null }) {
  const partsFromSeconds = (seconds: number | null) => {
    if (seconds == null || seconds <= 0) return { hours: '', minutes: '' };
    const [hours, minutes] = formatClock(seconds).split(':');
    return { hours, minutes };
  };
  const [parts, setParts] = useState(() => partsFromSeconds(initialSeconds));

  useEffect(() => {
    setParts(current => {
      const currentSeconds = current.hours || current.minutes
        ? (Number(current.hours) || 0) * 3600 + (Number(current.minutes) || 0) * 60
        : null;
      // Keep in-progress typing, but reflect time edited in the other control.
      return currentSeconds === initialSeconds ? current : partsFromSeconds(initialSeconds);
    });
  }, [initialSeconds]);

  const totalSeconds = (next: typeof parts): number | null => {
    if (!next.hours && !next.minutes) return null;
    return (Number(next.hours) || 0) * 3600 + (Number(next.minutes) || 0) * 60;
  };

  const updatePart = (part: keyof typeof parts, rawValue: string) => {
    const value = rawValue.replace(/\D/g, '').slice(0, part === 'hours' ? 3 : 2);
    const next = { ...parts, [part]: value };
    setParts(next);
    onChange(totalSeconds(next));
  };

  const normalise = () => {
    const total = totalSeconds(parts);
    if (total == null) return;
    const [hours, minutes] = formatClock(total).split(':');
    setParts({ hours, minutes });
    onChange(total);
  };

  const fields: { key: keyof typeof parts; label: string; ariaLabel: string }[] = [
    { key: 'hours', label: 'Hours', ariaLabel: 'Hours spent' },
    { key: 'minutes', label: 'Minutes', ariaLabel: 'Minutes spent' },
  ];
  const helpId = useId();
  const [selectedHours, selectedMinutes, selectedRemainder] = formatClock(initialSeconds ?? 0).split(':').map(Number);

  return (
    <div
      className={manualTimeStyles.card}
      title="Enter time spent in hours and minutes"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) normalise();
      }}
    >
      <div className={manualTimeStyles.heading}>
        <span className={manualTimeStyles.icon}><AppIcon className="ri-edit-2-line" /></span>
        <span>Manual time entry</span>
        <span className={manualTimeStyles.badge}>Editable</span>
      </div>
      <div className={manualTimeStyles.fields}>
        {fields.map((field) => (
          <label key={field.key} className={manualTimeStyles.field}>
            <span className={manualTimeStyles.label}>{field.label}</span>
            <input
              type="text"
              inputMode="numeric"
              value={parts[field.key]}
              onChange={(event) => updatePart(field.key, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  event.preventDefault();
                  const empty = { hours: '', minutes: '' };
                  setParts(empty);
                  onChange(null);
                }
              }}
              placeholder={field.key === 'hours' ? '0' : '30'}
              aria-label={field.ariaLabel}
              aria-describedby={helpId}
              className={manualTimeStyles.input}
            />
          </label>
        ))}
      </div>
      <p id={helpId} className={manualTimeStyles.hint}>For 30 minutes: enter 0 in Hours and 30 in Minutes.</p>
      <p className={manualTimeStyles.summary} aria-live="polite" aria-atomic="true">
        {initialSeconds !== null && `Selected time: ${selectedHours} ${selectedHours === 1 ? 'hour' : 'hours'} and ${selectedMinutes} ${selectedMinutes === 1 ? 'minute' : 'minutes'}${selectedRemainder > 0 ? ` and ${selectedRemainder} ${selectedRemainder === 1 ? 'second' : 'seconds'}` : ''}.`}
      </p>
    </div>
  );
}
