import { SYSTEM_TIME_ZONE } from './format';

export interface ComponentAccessWindow {
  open: boolean;
  currentTimeLabel: string;
  closedReason: 'outside-hours' | 'weekend' | 'invalid' | null;
}

/** Learning content is available at all times; retain the shape for callers. */
export function componentAccessWindow(at: Date | number = new Date()): ComponentAccessWindow {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return { open: false, currentTimeLabel: '', closedReason: 'invalid' };

  const currentTimeLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: SYSTEM_TIME_ZONE,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date);

  return {
    open: true,
    currentTimeLabel,
    closedReason: null,
  };
}

export const COMPONENT_ACCESS_MESSAGE =
  'Learning components are available at any time.';
