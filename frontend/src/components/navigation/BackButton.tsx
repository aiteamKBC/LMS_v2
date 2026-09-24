import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useSmartBack } from '@/hooks/useSmartBack';

export interface BackButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  fallback: string;
  children?: ReactNode;
  onBeforeBack?: () => boolean | void;
}

export function BackButton({ fallback, children = 'Back', onBeforeBack, type = 'button', ...props }: BackButtonProps) {
  const back = useSmartBack(fallback);
  return <button {...props} type={type} onClick={() => { if (onBeforeBack?.() !== false) back(); }}>{children}</button>;
}
