import { useState, useRef } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const SAMPLE_USERS = [
  { name: 'James Wilson', email: 'j.wilson@kbc.ac.uk', role: 'Learner', tenant: 'KBC', programme: 'Business Admin L3', cohort: 'Cohort C' },
  { name: 'Priya Sharma', email: 'p.sharma@kbc.ac.uk', role: 'Learner', tenant: 'KBC', programme: 'Digital Marketing L3', cohort: 'Cohort B' },
  { name: 'Oliver Bennett', email: 'o.bennett@lsa.ac.uk', role: 'Coach', tenant: 'LSA', programme: '—', cohort: '—' },
  { name: 'Fatima Hassan', email: 'f.hassan@kbc.ac.uk', role: 'Tutor', tenant: 'KBC', programme: 'Software Dev L4', cohort: 'Cohort A' },
  { name: 'Marcus Thompson', email: 'm.thompson@man.ac.uk', role: 'QA Officer', tenant: 'MAN', programme: '—', cohort: '—' },
  { name: 'Isabella Rossi', email: 'i.rossi@kbc.ac.uk', role: 'Learner', tenant: 'KBC', programme: 'Early Years L3', cohort: 'Cohort D' },
  { name: 'Daniel Chen', email: 'd.chen@lsa.ac.uk', role: 'Enrolment Officer', tenant: 'LSA', programme: '—', cohort: '—' },
  { name: 'Rachel Okafor', email: 'r.okafor@man.ac.uk', role: 'Employer', tenant: 'MAN', programme: '—', cohort: '—' },
];

const COLUMN_OPTIONS = ['Full Name', 'Email', 'Role', 'Tenant', 'Programme', 'Cohort', 'Phone', 'Department', 'Start Date', 'Ignore'];

export default function BulkUserImportPage() {
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<typeof SAMPLE_USERS | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({
    col0: 'Full Name', col1: 'Email', col2: 'Role', col3: 'Tenant', col4: 'Programme', col5: 'Cohort',
  });
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const csvHeaders = ['Name', 'Email', 'Role', 'Tenant', 'Programme', 'Cohort'];

  const handleFilePick = () => {
    setFileName('bulk-users-kbc-jun2026.csv');
    setPreviewData(SAMPLE_USERS);
    setStep(2);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); handleFilePick(); };

  const handleImport = () => {
    setImporting(true);
    setTimeout(() => { setImporting(false); setImportDone(true); setStep(3); }, 1800);
  };

  const totalRows = previewData?.length || 0;
  const mappedCols = Object.values(columnMapping).filter(v => v !== 'Ignore');

  return (
    <WorkspaceShell
      role="admin"
      roleLabel={adminNav.label}
      navItems={adminNav.items}
      workspaceLabel={adminNav.workspaceLabel}
      pageTitle="Bulk User Import"
      pageSubtitle={`Provision users across tenants · CSV upload · Column mapping`}
      userName="Platform Admin"
      userRole="Super Administrator"
    >
      <div className="p-3 md:p-6 space-y-4 md:space-y-6">
        {/* Hero */}
        <div className="relative rounded-2xl overflow-hidden min-h-[170px] md:min-h-[200px] isolate">
          <img
            src="https://readdy.ai/api/search-image?query=Dark%20sleek%20enterprise%20data%20migration%20interface%20with%20glowing%20CSV%20file%20icons%20floating%20above%20a%20modern%20server%20room%20backdrop%2C%20rows%20of%20structured%20data%20visualized%20as%20luminous%20columns%2C%20sophisticated%20corporate%20technology%20aesthetic%20with%20teal%20and%20warm%20gold%20accent%20lighting%2C%20clean%20minimalist%20dashboard%20with%20data%20import%20progress%20indicators%2C%20cinematic%20depth%20of%20field%2C%20professional%20UK%20data%20centre%20atmosphere&width=1600&height=400&seq=bulk-import-hero-2026&orientation=landscape"
            alt="Bulk user import"
            className="absolute inset-0 w-full h-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-primary-950 via-primary-900 to-primary-800" />
          <div className="absolute inset-0 bg-gradient-to-t from-primary-950/70 via-transparent to-primary-800/40" />
          <div className="relative z-10 p-5 sm:p-8 flex flex-col min-h-[170px] md:min-h-[200px]">
            <div className="flex items-start gap-4 mb-2">
              <div className="w-14 h-14 rounded-2xl bg-accent-500 flex items-center justify-center shrink-0 shadow-lg shadow-accent-500/20">
                <AppIcon className="ri-file-upload-line text-foreground-950 text-2xl"></AppIcon>
              </div>
              <div className="min-w-0">
                <h2 className="text-2xl sm:text-3xl font-heading font-bold text-white tracking-tight leading-tight">Bulk User Import</h2>
                <p className="text-[13px] text-white/55 leading-relaxed max-w-xl mt-2">
                  Upload a CSV to provision users across multiple tenants in one go.
                  <br />
                  <span className="text-accent-400 font-medium">Map columns</span> ·{' '}
                  <span className="text-primary-400 font-medium">Validate data</span> ·{' '}
                  <span className="text-secondary-400 font-medium">Import & notify</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Step Progress */}
        <div className="flex items-center gap-2">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-smooth ${
                step > s ? 'bg-emerald-500 text-white' : step === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-400'
              }`}>
                {step > s ? <AppIcon className="ri-check-line"></AppIcon> : s}
              </div>
              <span className={`text-[11px] font-medium ${step >= s ? 'text-foreground-700' : 'text-foreground-300'}`}>
                {s === 1 ? 'Upload CSV' : s === 2 ? 'Map & Preview' : 'Import'}
              </span>
              {s < 3 && <div className={`w-8 md:w-16 h-0.5 rounded-full ${step > s ? 'bg-emerald-400' : 'bg-background-200'}`}></div>}
            </div>
          ))}
        </div>

        {/* ============================================================ */}
        {/* Step 1 — Upload */}
        {/* ============================================================ */}
        {step === 1 && (
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-8 md:p-12 text-center">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-10 md:p-14 transition-smooth cursor-pointer ${dragOver ? 'border-primary-400 bg-primary-50/30' : 'border-background-200 hover:border-background-300 hover:bg-background-50/80'}`}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-16 h-16 rounded-2xl bg-secondary-100 flex items-center justify-center mx-auto mb-4">
                <AppIcon className="ri-upload-cloud-2-line text-secondary-600 text-2xl"></AppIcon>
              </div>
              <h3 className="text-base font-heading font-semibold text-foreground-900 mb-2">Drop your CSV file here</h3>
              <p className="text-[13px] text-foreground-400 mb-6">or click to browse. Supports .csv files up to 10MB.</p>
              <button
                onClick={handleFilePick}
                className="px-6 py-2.5 bg-primary-500 text-white rounded-xl text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
              >
                <AppIcon className="ri-file-line mr-1.5"></AppIcon> Choose File
              </button>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFilePick} />
              <p className="text-[11px] text-foreground-300 mt-4">Required columns: Name, Email, Role. Optional: Tenant, Programme, Cohort, Phone, Department, Start Date</p>
            </div>

            <div className="mt-6 p-4 bg-accent-50/60 rounded-xl border border-accent-200/40 text-left max-w-lg mx-auto">
              <p className="text-[11px] font-semibold text-foreground-700 mb-2 flex items-center gap-2">
                <AppIcon className="ri-lightbulb-line text-accent-600"></AppIcon> CSV Template Format
              </p>
              <code className="text-[10px] text-foreground-500 block bg-background-50 rounded-lg p-2 border border-background-200">Name,Email,Role,Tenant,Programme,Cohort<br/>James Wilson,j.wilson@kbc.ac.uk,Learner,KBC,Business Admin L3,Cohort C</code>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* Step 2 — Map Columns & Preview */}
        {/* ============================================================ */}
        {step === 2 && previewData && (
          <div className="space-y-4 md:space-y-6">
            {/* Column Mapping */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 md:p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                  <AppIcon className="ri-link text-primary-600 text-sm"></AppIcon>
                </div>
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Column Mapping</h3>
                  <p className="text-[10px] text-foreground-400">Map CSV columns to system fields</p>
                </div>
                <span className="ml-auto text-[11px] font-medium text-foreground-500">File: <span className="text-foreground-700">{fileName}</span></span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {csvHeaders.map((header, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-foreground-500 w-20 shrink-0">{header}:</span>
                    <select
                      value={columnMapping[`col${i}`] || 'Ignore'}
                      onChange={e => setColumnMapping(prev => ({ ...prev, [`col${i}`]: e.target.value }))}
                      className="flex-1 text-[11px] border border-background-200 rounded-lg px-2.5 py-1.5 bg-background-50 text-foreground-700 cursor-pointer focus:outline-none focus:border-primary-300"
                    >
                      {COLUMN_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Preview Table */}
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="px-4 md:px-5 py-3 border-b border-background-100 flex items-center justify-between">
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Data Preview</h3>
                <span className="text-[11px] text-foreground-400">{totalRows} rows · {mappedCols.length} columns mapped</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-background-100">
                      <th className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">#</th>
                      {mappedCols.map(col => (
                        <th key={col} className="text-left px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">{col}</th>
                      ))}
                      <th className="text-center px-4 py-2.5 text-foreground-400 font-medium text-[10px] uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.map((row, idx) => {
                      const emailExists = idx === 4;
                      return (
                        <tr key={idx} className={`border-b border-background-50 hover:bg-background-50/60 transition-smooth ${emailExists ? 'bg-amber-50/40' : ''}`}>
                          <td className="px-4 py-2.5 text-foreground-400 text-[10px]">{idx + 1}</td>
                          {mappedCols.map(col => (
                            <td key={col} className="px-4 py-2.5 text-foreground-700 text-[11px] whitespace-nowrap">
                              {(() => {
                                const keyMap: Record<string, keyof typeof row> = {
                                  'Full Name': 'name', 'Email': 'email', 'Role': 'role', 'Tenant': 'tenant', 'Programme': 'programme', 'Cohort': 'cohort',
                                };
                                return row[keyMap[col] as keyof typeof row] || '—';
                              })()}
                            </td>
                          ))}
                          <td className="px-4 py-2.5 text-center">
                            {emailExists ? (
                              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/50">Duplicate email</span>
                            ) : (
                              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/50">Ready</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button onClick={() => setStep(1)} className="px-4 py-2.5 bg-background-50 border border-background-200 rounded-xl text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-arrow-left-line mr-1"></AppIcon> Back
              </button>
              <button onClick={handleImport} className="px-5 py-2.5 bg-primary-500 text-white rounded-xl text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-upload-cloud-line mr-1.5"></AppIcon> Import {totalRows} Users
              </button>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* Step 3 — Results */}
        {/* ============================================================ */}
        {step === 3 && (
          <>
            {importing ? (
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-12 text-center">
                <div className="w-14 h-14 rounded-2xl bg-primary-100 flex items-center justify-center mx-auto mb-4 animate-spin-slow">
                  <AppIcon className="ri-loader-4-line text-primary-600 text-2xl"></AppIcon>
                </div>
                <h3 className="text-base font-heading font-semibold text-foreground-900 mb-2">Importing users...</h3>
                <p className="text-[13px] text-foreground-400">Creating accounts, assigning roles, sending welcome emails</p>
              </div>
            ) : importDone && (
              <div className="space-y-4 md:space-y-6">
                <div className="bg-emerald-50 rounded-2xl border border-emerald-200/60 p-6 md:p-8 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                    <AppIcon className="ri-check-line text-emerald-600 text-3xl"></AppIcon>
                  </div>
                  <h3 className="text-lg font-heading font-semibold text-emerald-900 mb-2">Import Complete!</h3>
                  <p className="text-[13px] text-emerald-700 mb-6">
                    Successfully imported <strong>{totalRows - 1}</strong> users across tenants. <strong>1</strong> row skipped (duplicate email).
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-lg mx-auto">
                    <ResultCard label="Imported" value={totalRows - 1} color="emerald" icon="ri-check-line" />
                    <ResultCard label="Skipped" value={1} color="amber" icon="ri-error-warning-line" />
                    <ResultCard label="Tenants" value={3} color="primary" icon="ri-building-4-line" />
                    <ResultCard label="Emails Sent" value={totalRows - 1} color="secondary" icon="ri-mail-line" />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button onClick={() => { setStep(1); setFileName(null); setPreviewData(null); setImportDone(false); }} className="px-5 py-2.5 bg-primary-500 text-white rounded-xl text-[13px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-add-line mr-1"></AppIcon> Import Another File
                  </button>
                  <a href="/admin/users" className="px-5 py-2.5 bg-background-50 border border-background-200 rounded-xl text-[13px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <AppIcon className="ri-user-line mr-1.5"></AppIcon> View All Users
                  </a>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}

function ResultCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  const colorMap: Record<string, { bg: string; text: string; iconBg: string }> = {
    emerald: { bg: 'bg-emerald-100/70', text: 'text-emerald-700', iconBg: 'bg-emerald-100 text-emerald-600' },
    amber: { bg: 'bg-amber-100/70', text: 'text-amber-700', iconBg: 'bg-amber-100 text-amber-600' },
    primary: { bg: 'bg-primary-100/70', text: 'text-primary-700', iconBg: 'bg-primary-100 text-primary-600' },
    secondary: { bg: 'bg-secondary-100/70', text: 'text-secondary-700', iconBg: 'bg-secondary-100 text-secondary-600' },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className={`${c.bg} rounded-xl p-3 text-center`}>
      <span className={`w-7 h-7 rounded-lg flex items-center justify-center mx-auto mb-1.5 ${c.iconBg}`}>
        <AppIcon className={`${icon} text-xs`}></AppIcon>
      </span>
      <p className={`text-xl font-heading font-bold ${c.text}`}>{value}</p>
      <p className="text-[10px] text-foreground-400">{label}</p>
    </div>
  );
}