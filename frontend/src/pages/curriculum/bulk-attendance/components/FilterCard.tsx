import { useEffect, useRef, useState } from "react";

export interface FilterOption {
  value: string;
  label: string;
}

interface FilterCardProps {
  icon: string;
  label: string;
  value: string;
  options: FilterOption[];
  placeholder: string;
  disabled?: boolean;
  variant?: "card" | "compact";
  onChange: (value: string) => void;
}

export default function FilterCard({
  icon,
  label,
  value,
  options,
  placeholder,
  disabled = false,
  variant = "card",
  onChange,
}: FilterCardProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selected = options.find((option) => option.value === value);
  const isActive = Boolean(selected);
  const compact = variant === "compact";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex w-full items-center rounded-lg border bg-background-50 text-left transition-colors ${
          compact ? "h-11 gap-2 px-3" : "gap-3 p-4"
        } ${
          disabled
            ? "cursor-not-allowed border-background-200 opacity-60"
            : "cursor-pointer border-background-300 hover:border-primary-300"
        } ${open ? "border-primary-400" : ""}`}
      >
        {compact ? (
          <>
            <i
              className={`${icon} shrink-0 text-base ${
                isActive ? "text-primary-600" : "text-foreground-500"
              }`}
            />
            <span className="hidden shrink-0 font-label text-xs uppercase tracking-wide text-foreground-400 lg:inline">
              {label}
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-sm ${
                isActive
                  ? "font-medium text-foreground-950"
                  : "text-foreground-500"
              }`}
            >
              {selected ? selected.label : placeholder}
            </span>
            <i
              className={`ri-arrow-down-s-line shrink-0 text-base text-foreground-500 transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </>
        ) : (
          <>
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                isActive
                  ? "bg-primary-100 text-primary-700"
                  : "bg-background-200 text-foreground-600"
              }`}
            >
              <i className={`${icon} text-lg`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-label text-xs uppercase tracking-wide text-foreground-500">
                {label}
              </span>
              <span
                className={`block truncate text-sm font-medium ${
                  isActive ? "text-foreground-950" : "text-foreground-500"
                }`}
              >
                {selected ? selected.label : placeholder}
              </span>
            </span>
            <i
              className={`ri-arrow-down-s-line shrink-0 text-lg text-foreground-500 transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </>
        )}
      </button>

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-64 overflow-y-auto rounded-lg border border-background-300 bg-background-50 p-1.5 shadow-lg">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value || "all"}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? "bg-primary-100 text-primary-800"
                    : "text-foreground-700 hover:bg-background-100"
                }`}
              >
                <span className="truncate">{option.label}</span>
                {active && <i className="ri-check-line shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

