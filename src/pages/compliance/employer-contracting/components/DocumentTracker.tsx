import type { EmployerContractingRecord } from '@/mocks/employer-contracting';

interface DocumentTrackerProps {
  record: EmployerContractingRecord;
}

export function DocumentTracker({ record }: DocumentTrackerProps) {
  const signed = record.documents.filter(d => d.status === 'signed').length;
  const total = record.documents.filter(d => d.status !== 'not_applicable').length;
  const percent = total > 0 ? Math.round((signed / total) * 100) : 0;

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-heading font-semibold text-foreground-900">Documents</h3>
        <span className="text-[11px] font-medium text-foreground-500">{signed}/{total} signed</span>
      </div>

      {/* Mini progress bar */}
      <div className="h-1.5 bg-background-100 rounded-full overflow-hidden mb-5">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${percent}%`,
            background: percent === 100
              ? 'oklch(var(--emerald-500) / 1)'
              : percent >= 50
              ? 'oklch(var(--amber-500) / 1)'
              : 'oklch(var(--secondary-500) / 1)',
          }}
        ></div>
      </div>

      <div className="space-y-2">
        {record.documents.map(doc => (
          <div
            key={doc.id}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-foreground-200/60 hover:border-background-300/60 transition-smooth cursor-pointer bg-background-50"
          >
            {/* Status icon */}
            <span className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${getDocIconBg(doc.status)}`}>
              <i className={`${getDocIcon(doc.status)} text-sm`}></i>
            </span>

            {/* Doc info */}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground-800 truncate">{doc.name}</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className={`text-[10px] font-medium ${getDocStatusColor(doc.status)}`}>
                  {doc.status === 'not_applicable' ? 'N/A' : doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
                </span>
                {doc.sentDate && (
                  <>
                    <span className="text-[8px] text-foreground-300">&middot;</span>
                    <span className="text-[10px] text-foreground-400">Sent: {formatDate(doc.sentDate)}</span>
                  </>
                )}
                {doc.signedDate && (
                  <>
                    <span className="text-[8px] text-foreground-300">&middot;</span>
                    <span className="text-[10px] text-foreground-400">Signed: {formatDate(doc.signedDate)}</span>
                  </>
                )}
                {doc.signedBy && (
                  <span className="text-[10px] text-foreground-400">by {doc.signedBy}</span>
                )}
              </div>
              {doc.notes && (
                <p className="text-[10px] text-foreground-400 mt-0.5">{doc.notes}</p>
              )}
            </div>

            {/* Action */}
            <button className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-300 hover:text-primary-600 hover:bg-primary-50 transition-smooth cursor-pointer" title="View document">
              <i className="ri-arrow-right-s-line"></i>
            </button>
          </div>
        ))}
      </div>

      {/* Upload button */}
      <button className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-background-300/60 text-[12px] text-foreground-400 hover:text-primary-600 hover:border-primary-300/60 hover:bg-primary-50/50 transition-smooth cursor-pointer">
        <i className="ri-upload-cloud-2-line"></i>
        Upload or Request Document
      </button>
    </div>
  );
}

function getDocIcon(status: string): string {
  switch (status) {
    case 'signed': return 'ri-check-double-line';
    case 'sent': return 'ri-send-plane-line';
    case 'required': return 'ri-file-text-line';
    case 'expired': return 'ri-error-warning-line';
    case 'not_applicable': return 'ri-forbid-line';
    default: return 'ri-file-text-line';
  }
}

function getDocIconBg(status: string): string {
  switch (status) {
    case 'signed': return 'bg-emerald-50 text-emerald-600';
    case 'sent': return 'bg-primary-50 text-primary-600';
    case 'required': return 'bg-background-100 text-foreground-400';
    case 'expired': return 'bg-red-50 text-red-600';
    case 'not_applicable': return 'bg-background-100 text-foreground-300';
    default: return 'bg-background-100 text-foreground-400';
  }
}

function getDocStatusColor(status: string): string {
  switch (status) {
    case 'signed': return 'text-emerald-600';
    case 'sent': return 'text-primary-600';
    case 'required': return 'text-foreground-400';
    case 'expired': return 'text-red-600';
    case 'not_applicable': return 'text-foreground-300';
    default: return 'text-foreground-400';
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}