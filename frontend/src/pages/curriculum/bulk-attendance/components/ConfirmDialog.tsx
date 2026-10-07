import { useEffect } from "react";

interface ConfirmDialogProps {
  open: boolean;
  icon?: string;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Small centered confirmation modal used for actions that need an explicit
 * "are you sure?" step.
 */
export default function ConfirmDialog({
  open,
  icon = "ri-question-line",
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-foreground-950/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-lg border border-background-300 bg-background-50">
        <div className="flex items-start gap-3 px-5 py-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700">
            <i className={`${icon} text-xl`} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground-950">{title}</h3>
            <p className="mt-1 text-sm text-foreground-500">{description}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-background-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm font-medium text-foreground-800 transition-colors hover:bg-background-200"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-500 px-3 py-2 text-sm font-medium text-background-50 transition-colors hover:bg-primary-600"
          >
            <i className="ri-arrow-go-back-line" />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

