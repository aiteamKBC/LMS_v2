import type { DeliveryLiveSession } from './deliveryDashboard';
import { useDeliveryRead } from './useDeliveryData';

/** Independent of overview and activity; no full-curriculum calendar rebuild. */
export function useDeliverySessions(scope: string) {
  const result = useDeliveryRead<{ sessions: DeliveryLiveSession[] }>('/curriculum/delivery-dashboard/sessions/', scope);
  return { ...result, sessions: result.data?.sessions ?? [] };
}
