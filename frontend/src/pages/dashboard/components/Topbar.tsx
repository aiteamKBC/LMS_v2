import { Header, type HeaderNotification } from "@/components/feature/Header";
import { REVIEWER_ROLE } from "@/pages/dashboard/constants";

interface TopbarProps {
  onMenu: () => void;
  title?: string;
  section?: string;
  notifications?: HeaderNotification[];
  onNotificationClick?: (notification: HeaderNotification) => void;
}

/** Keep the QA dashboard on the same workspace chrome as the rest of the LMS. */
export default function Topbar({ onMenu, title = "Quality Assurance", section = "Quality Assurance", notifications, onNotificationClick }: TopbarProps) {
  return (
    <>
      <Header
        pageTitle={title}
        pageSubtitle={section}
        onOpenSearch={() => undefined}
        onToggleMobileSidebar={onMenu}
        role="curriculum"
        appearance="curriculum"
        workspaceLabel={REVIEWER_ROLE}
        sidebarSignOut
        notifications={notifications}
        onNotificationClick={onNotificationClick}
      />
      <div className="workspace-breadcrumbs mx-2 flex h-8 shrink-0 items-center overflow-hidden rounded-xl border-b border-background-300/40 bg-background-200 px-3 md:px-5 lg:ml-0 lg:mr-3">
        <nav className="flex min-w-0 items-center gap-1.5 overflow-x-auto text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Breadcrumb">
          <span className="whitespace-nowrap text-foreground-400">Curriculum Studio</span>
          <i className="ri-arrow-right-s-line text-foreground-200 text-xs" aria-hidden="true" />
          <span className="whitespace-nowrap font-medium text-foreground-700" aria-current="page">{section}</span>
        </nav>
      </div>
    </>
  );
}
