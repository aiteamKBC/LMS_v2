import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

export default function AdminSystemSettingsPage() {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [autoBackup, setAutoBackup] = useState(true);
  const [emailRetries, setEmailRetries] = useState(3);
  const [sessionTimeout, setSessionTimeout] = useState(30);
  const [apiRateLimit, setApiRateLimit] = useState(1000);
  const [logRetention, setLogRetention] = useState(90);

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="System Settings" pageSubtitle="System configuration, maintenance, performance, and security" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-settings-3-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">System Control</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>Version 2.4.1</strong> — Uptime 99.97%. Last backup: 7 Jun 2026, 01:00. All systems operational.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">99.97%</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Uptime</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">2.4.1</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Version</p>
              </div>
            </div>
          </div>
        </div>

        {/* System Status Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatusCard label="Database" status="healthy" detail="14ms latency" icon="ri-database-2-line" />
          <StatusCard label="Cache" status="healthy" detail="Redis active" icon="ri-flashlight-line" />
          <StatusCard label="Queue" status="healthy" detail="0 jobs pending" icon="ri-stack-line" />
          <StatusCard label="Storage" status="warning" detail="72% used" icon="ri-hard-drive-2-line" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* System Configuration */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">System Configuration</h3>
            <div className="space-y-4">
              <ToggleRow label="Maintenance Mode" description="Temporarily disable the platform for all non-admin users" value={maintenanceMode} onChange={setMaintenanceMode} />
              <ToggleRow label="Debug Mode" description="Enable verbose logging and error traces" value={debugMode} onChange={setDebugMode} />
              <ToggleRow label="Auto Backup" description="Daily automated database backups at 01:00 UTC" value={autoBackup} onChange={setAutoBackup} />

              <div className="pt-3 border-t border-foreground-200/60">
                <NumberRow label="Session Timeout" value={sessionTimeout} onChange={setSessionTimeout} unit="minutes" min={5} max={120} />
                <NumberRow label="Email Retry Attempts" value={emailRetries} onChange={setEmailRetries} unit="times" min={1} max={10} />
                <NumberRow label="API Rate Limit" value={apiRateLimit} onChange={setApiRateLimit} unit="req/min" min={100} max={10000} />
                <NumberRow label="Log Retention" value={logRetention} onChange={setLogRetention} unit="days" min={7} max={365} />
              </div>
            </div>
          </div>

          {/* Security Settings */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Security & Access</h3>
            <div className="space-y-4">
              <SecurityRow label="Two-Factor Authentication" status="Enabled" detail="Required for Admin, Compliance, QA roles" icon="ri-shield-keyhole-line" />
              <SecurityRow label="IP Whitelist" status="Disabled" detail="No IP restrictions configured" icon="ri-global-line" />
              <SecurityRow label="Password Policy" status="Strong" detail="Min 12 chars, uppercase, number, symbol" icon="ri-lock-password-line" />
              <SecurityRow label="SSO / SAML" status="Disabled" detail="Azure AD integration not configured" icon="ri-id-card-line" />
              <SecurityRow label="Audit Logging" status="Enabled" detail="All actions recorded for 90 days" icon="ri-history-line" />
              <SecurityRow label="Data Encryption" status="AES-256" detail="At rest and in transit" icon="ri-lock-line" />
            </div>
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Performance Metrics (Last 24h)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <MetricCard label="Avg Response Time" value="124ms" trend="-12%" positive={true} />
            <MetricCard label="Requests Served" value="48.2K" trend="+8%" positive={true} />
            <MetricCard label="Error Rate" value="0.04%" trend="-0.01%" positive={true} />
            <MetricCard label="Active Sessions" value="142" trend="+23" positive={true} />
          </div>
          <div className="h-32 flex items-end gap-1 px-2">
            {[45, 52, 38, 61, 55, 72, 48, 66, 58, 74, 52, 68, 59, 77, 63, 71, 55, 69, 62, 80, 58, 67, 54, 70].map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full bg-primary-100 rounded-t-sm overflow-hidden" style={{ height: `${h}%` }}>
                  <div className="w-full h-full bg-gradient-to-t from-primary-500 to-primary-400"></div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-foreground-400 mt-1 px-2">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>23:59</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-save-line mr-1.5"></i> Save Changes
          </button>
          <button className="px-4 py-2.5 bg-background-100 border border-background-200 rounded-xl text-sm font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-refresh-line mr-1.5"></i> Restart Services
          </button>
          <button className="px-4 py-2.5 bg-background-100 border border-background-200 rounded-xl text-sm font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-download-line mr-1.5"></i> Download Logs
          </button>
        </div>
      </div>
    </WorkspaceShell>
  );
}

function StatusCard({ label, status, detail, icon }: { label: string; status: string; detail: string; icon: string }) {
  const statusColor = status === 'healthy' ? 'bg-emerald-500' : 'bg-accent-500';
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold text-foreground-600">{label}</span>
        <span className={`w-2 h-2 rounded-full ${statusColor}`}></span>
      </div>
      <div className="flex items-center gap-2">
        <i className={`${icon} text-foreground-400 text-sm`}></i>
        <span className="text-[12px] text-foreground-500">{detail}</span>
      </div>
    </div>
  );
}

function ToggleRow({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[13px] font-medium text-foreground-900">{label}</p>
        <p className="text-[11px] text-foreground-400">{description}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`w-11 h-6 rounded-full transition-smooth relative cursor-pointer ${value ? 'bg-primary-500' : 'bg-background-200'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-smooth ${value ? 'left-5.5' : 'left-0.5'}`} style={{ left: value ? '22px' : '2px' }}></span>
      </button>
    </div>
  );
}

function NumberRow({ label, value, onChange, unit, min, max }: { label: string; value: number; onChange: (v: number) => void; unit: string; min: number; max: number }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[12px] text-foreground-600">{label}</span>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(Math.max(min, value - 1))} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-foreground-500 hover:bg-background-200 transition-smooth cursor-pointer">
          <i className="ri-subtract-line text-xs"></i>
        </button>
        <span className="text-[13px] font-semibold text-foreground-900 w-12 text-center">{value}</span>
        <button onClick={() => onChange(Math.min(max, value + 1))} className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center text-foreground-500 hover:bg-background-200 transition-smooth cursor-pointer">
          <i className="ri-add-line text-xs"></i>
        </button>
        <span className="text-[11px] text-foreground-400 w-16">{unit}</span>
      </div>
    </div>
  );
}

function SecurityRow({ label, status, detail, icon }: { label: string; status: string; detail: string; icon: string }) {
  const isEnabled = status === 'Enabled' || status === 'Strong' || status === 'AES-256';
  return (
    <div className="flex items-start gap-3 py-2 border-b border-background-100 last:border-0">
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isEnabled ? 'bg-emerald-100 text-emerald-600' : 'bg-background-100 text-foreground-400'}`}>
        <i className={`${icon} text-sm`}></i>
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-foreground-900">{label}</p>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-background-100 text-foreground-500'}`}>{status}</span>
        </div>
        <p className="text-[11px] text-foreground-400 mt-0.5">{detail}</p>
      </div>
    </div>
  );
}

function MetricCard({ label, value, trend, positive }: { label: string; value: string; trend: string; positive: boolean }) {
  return (
    <div className="bg-background-100 rounded-lg p-4">
      <p className="text-[11px] text-foreground-400 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <p className="text-xl font-bold text-foreground-900">{value}</p>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${positive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{trend}</span>
      </div>
    </div>
  );
}