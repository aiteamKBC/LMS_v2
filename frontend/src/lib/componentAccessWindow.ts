import { SYSTEM_TIME_ZONE } from './format';

export const COMPONENT_ACCESS_START_HOUR = 7;
export const COMPONENT_ACCESS_END_HOUR = 19;

export interface ComponentAccessWindow {
  open: boolean;
  currentTimeLabel: string;
  closedReason: 'outside-hours' | 'weekend' | 'invalid' | null;
}

/** Weekday learner component access, evaluated in UK civil time (GMT/BST). */
export function componentAccessWindow(at: Date | number = new Date()): ComponentAccessWindow {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return { open: false, currentTimeLabel: '', closedReason: 'invalid' };

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SYSTEM_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);
  const weekday = parts.find(part => part.type === 'weekday')?.value || '';
  const weekend = weekday === 'Sat' || weekday === 'Sun';
  const currentTimeLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: SYSTEM_TIME_ZONE,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date);

  const insideHours = Number.isFinite(hour)
    && Number.isFinite(minute)
    && hour >= COMPONENT_ACCESS_START_HOUR
    && hour < COMPONENT_ACCESS_END_HOUR;
  const open = !weekend && insideHours;

  return {
    open,
    currentTimeLabel,
    closedReason: open ? null : weekend ? 'weekend' : 'outside-hours',
  };
}

export const COMPONENT_ACCESS_MESSAGE =
  'Learning components are available Monday to Friday from 07:00 to 19:00 UK time.';
