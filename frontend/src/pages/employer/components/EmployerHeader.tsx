import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
type Employer = { name: string; organisationName: string };

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function EmployerHeader({
  employer,
  title,
  subtitle,
  nav,
}: {
  employer: Employer;
  title?: string;
  subtitle?: string;
  nav?: ReactNode;
}) {
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
  };

  return (
    <header className="border-b border-background-200 bg-background-50">
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="flex items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-3">
            <img
              src="https://newsite.kentbusinesscollege.net/assets/logos/kbc-crest.png"
              alt="Kent Business College crest"
              className="h-11 w-auto md:h-12"
            />
            <span className="hidden h-9 w-px bg-background-200 sm:block" aria-hidden="true" />
            <p className="hidden text-xs font-medium text-foreground-500 sm:block">Employer Portal</p>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-foreground-900">{employer.name}</p>
              <p className="text-xs text-foreground-500">{employer.organisationName}</p>
            </div>
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-700"
              title={employer.name}
            >
              {initials(employer.name)}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Log out of the employer portal"
              className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border border-background-200 bg-background-50 px-3 py-2 text-sm font-medium text-foreground-700 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
              <span className="flex h-4 w-4 items-center justify-center">
                <i className="ri-logout-box-r-line text-base leading-none" aria-hidden="true"></i>
              </span>
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </div>

      {(title || nav) && (
        <div className="border-t border-background-200">
          <div className="mx-auto max-w-7xl px-4 py-4 md:px-6">
            {title && (
              <h1 className="text-xl font-bold text-foreground-950 md:text-2xl">{title}</h1>
            )}
            {subtitle && <p className="mt-1 text-sm text-foreground-600">{subtitle}</p>}
            {nav && <div className="mt-4">{nav}</div>}
          </div>
        </div>
      )}
    </header>
  );
}
