import type { ReactNode } from "react";

interface PanelProps {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  headingId?: string;
  as?: "section" | "div" | "article";
}

export default function Panel({
  title,
  description,
  action,
  children,
  className = "",
  bodyClassName = "",
  headingId,
  as = "section",
}: PanelProps) {
  const Wrapper = as;
  return (
    <Wrapper
      className={`rounded-xl border border-background-200 bg-background-50 ${className}`}
      aria-labelledby={title ? headingId : undefined}
    >
      {title ? (
        <div className="flex flex-col gap-2 border-b border-background-200 px-4 py-3.5 sm:px-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2
              id={headingId}
              className="font-heading text-[15px] font-semibold tracking-[-0.01em] text-foreground-950"
            >
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-foreground-600">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={bodyClassName || "p-4 sm:p-5"}>{children}</div>
    </Wrapper>
  );
}

