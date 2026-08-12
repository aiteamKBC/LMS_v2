import { useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { BrandLockup } from '@/components/BrandLockup';

// AUDIT entry point: the portal's AUDIT card lands here so the user picks
// which of the two independent audit systems to open.
//  - Automatic: the existing workspace (audit_api + Last_audit source).
//  - Manual:    the new workspace (manual_audit_api + Manual_audit schema).
// The two share nothing but the synced learner data, so work in one never
// affects the other.
interface AuditSystemCard {
  slug: string;
  label: string;
  description: string;
  icon: string;
  path: string;
  accent: 'primary' | 'emerald';
}

const AUDIT_SYSTEMS: AuditSystemCard[] = [
  {
    slug: 'automatic',
    label: 'Automatic',
    description: 'The live audit workspace fed automatically from the fetched Aptem/LMS evidence pipeline.',
    icon: 'ri-flashlight-line',
    path: '/workspace/auditor-copy',
    accent: 'primary',
  },
  {
    slug: 'manual',
    label: 'Manual',
    description: 'An independent copy where auditors enter and manage records by hand, on its own database tables.',
    icon: 'ri-edit-2-line',
    path: '/workspace/auditor-manual',
    accent: 'emerald',
  },
];

export default function AuditSelectPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background-200 flex flex-col">
      <header className="border-b border-foreground-200 bg-background-50">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <BrandLockup size="compact" />
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-[13px] text-foreground-400 hover:text-foreground-700 transition-smooth cursor-pointer"
          >
            <AppIcon className="ri-arrow-left-line text-[15px]" />
            Back to portal
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-3xl">
          <div className="text-center mb-10">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-300/50 bg-primary-100 px-3 py-1 text-[11px] font-semibold text-primary-700 mb-4">
              <AppIcon className="ri-file-search-line text-[12px]" />
              AUDIT
            </span>
            <h1 className="text-[28px] md:text-[34px] font-heading font-semibold text-foreground-900 tracking-tight mb-3">
              Choose your audit system
            </h1>
            <p className="text-[14px] text-foreground-400 max-w-md mx-auto leading-relaxed">
              Two independent systems over the same learner data — pick the one you want to work in.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {AUDIT_SYSTEMS.map((system) => (
              <button
                key={system.slug}
                onClick={() => navigate(system.path)}
                aria-label={`Open the ${system.label} audit system`}
                className={`group relative flex flex-col items-start text-left gap-4 rounded-2xl border p-6 transition-all duration-300 ease-out hover:-translate-y-1.5 hover:scale-[1.02] cursor-pointer card-premium ${
                  system.accent === 'emerald'
                    ? 'bg-emerald-50/40 border-emerald-200/70 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-500/10'
                    : 'bg-primary-50/60 border-primary-300/70 ring-1 ring-primary-300/40 hover:border-primary-400 hover:shadow-xl hover:shadow-primary-500/15'
                }`}
              >
                <span
                  className={`w-12 h-12 rounded-xl flex items-center justify-center border transition-colors duration-300 ${
                    system.accent === 'emerald'
                      ? 'bg-emerald-50 border-emerald-200/60 group-hover:bg-emerald-100'
                      : 'bg-primary-100 border-primary-300/50 group-hover:bg-primary-200'
                  }`}
                >
                  <AppIcon
                    className={`${system.icon} text-[20px] ${system.accent === 'emerald' ? 'text-emerald-600' : 'text-primary-700'}`}
                  />
                </span>
                <span className="text-[16px] font-heading font-semibold text-foreground-900">{system.label}</span>
                <span className="text-[12.5px] text-foreground-400 leading-relaxed">{system.description}</span>
                <span
                  className={`mt-auto inline-flex items-center gap-1.5 text-[12px] font-semibold ${
                    system.accent === 'emerald' ? 'text-emerald-700' : 'text-primary-700'
                  }`}
                >
                  Open workspace
                  <AppIcon className="ri-arrow-right-line text-[13px] transition-transform duration-300 group-hover:translate-x-0.5" />
                </span>
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
