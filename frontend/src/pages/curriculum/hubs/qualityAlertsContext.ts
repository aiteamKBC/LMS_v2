import { createContext, useContext } from 'react';
import type { HeaderNotification } from '@/components/feature/Header';
import type { useQualityNotifications } from '@/pages/dashboard/useQualityNotifications';

type Alerts = ReturnType<typeof useQualityNotifications> & { select: (notification: HeaderNotification) => void };
export const AlertsContext = createContext<Alerts | null>(null);
export const useQualityAlerts = () => useContext(AlertsContext);
