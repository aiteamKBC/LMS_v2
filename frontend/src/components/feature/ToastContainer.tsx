import { useEffect, useState } from 'react';
import { useToast, type ToastItem, type ToastType } from '@/hooks/useToast';

const toastConfig: Record<ToastType, { icon: string; bar: string; iconBg: string; iconColor: string; titleColor: string }> = {
  success: {
    icon: 'ri-check-line',
    bar: 'bg-emerald-500',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-600',
    titleColor: 'text-foreground-900',
  },
  error: {
    icon: 'ri-close-circle-line',
    bar: 'bg-red-500',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    titleColor: 'text-foreground-900',
  },
  warning: {
    icon: 'ri-alert-line',
    bar: 'bg-amber-500',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    titleColor: 'text-foreground-900',
  },
  info: {
    icon: 'ri-information-line',
    bar: 'bg-primary-500',
    iconBg: 'bg-primary-100',
    iconColor: 'text-primary-600',
    titleColor: 'text-foreground-900',
  },
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  const cfg = toastConfig[item.type];

  return (
    <div
      className={`relative w-80 bg-background-50 border border-foreground-200 rounded-xl shadow-lg shadow-foreground-950/8 overflow-hidden transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}
    >
      {/* Progress bar */}
      <div className={`absolute top-0 left-0 h-0.5 w-full ${cfg.bar} opacity-80`}></div>

      <div className="flex items-start gap-3 p-4 pt-4.5">
        {/* Icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${cfg.iconBg}`}>
          <i className={`${cfg.icon} text-sm ${cfg.iconColor}`}></i>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pt-0.5">
          <p className={`text-[13px] font-semibold leading-snug ${cfg.titleColor}`}>{item.title}</p>
          {item.message && (
            <p className="text-[12px] text-foreground-500 mt-0.5 leading-snug">{item.message}</p>
          )}
        </div>

        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="w-6 h-6 flex items-center justify-center rounded-md text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer shrink-0"
        >
          <i className="ri-close-line text-xs"></i>
        </button>
      </div>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
<<<<<<< HEAD
    <div className="fixed bottom-24 right-5 z-[9999] flex flex-col gap-2.5 pointer-events-none">
=======
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2.5 pointer-events-none">
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <ToastCard item={t} onDismiss={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
<<<<<<< HEAD
}
=======
}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
