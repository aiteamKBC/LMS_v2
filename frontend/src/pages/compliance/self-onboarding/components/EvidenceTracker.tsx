import type { SelfOnboardingLearner } from '@/mocks/self-onboarding';

interface EvidenceTrackerProps {
  learner: SelfOnboardingLearner;
}

interface EvidenceItem {
  key: string;
  label: string;
  status: string;
  fileName?: string;
  uploadDate?: string;
  required: boolean;
}

function getEvidenceItems(learner: SelfOnboardingLearner): EvidenceItem[] {
  const e = learner.evidenceUploads;
  return [
    { key: 'id', label: 'ID Document', status: String(e.idFile || 'not-uploaded'), fileName: String(e.idFileName || ''), uploadDate: String(e.idUploadDate || ''), required: true },
    { key: 'proofOfAddress', label: 'Proof of Address', status: String(e.proofOfAddress || 'not-uploaded'), fileName: String(e.proofOfAddressFileName || ''), uploadDate: String(e.proofOfAddressUploadDate || ''), required: true },
    { key: 'qualifications', label: 'Qualification Certificates', status: String(e.qualifications || 'not-uploaded'), fileName: Array.isArray(e.qualificationsFileNames) ? e.qualificationsFileNames.join(', ') : String(e.qualificationsFileNames || ''), uploadDate: String(e.qualificationsUploadDate || ''), required: true },
    { key: 'cv', label: 'CV', status: String(e.cv || 'not-uploaded'), fileName: String(e.cvFileName || ''), uploadDate: String(e.cvUploadDate || ''), required: true },
    { key: 'rightToWork', label: 'Right to Work Evidence', status: String(e.rightToWork || 'not-uploaded'), fileName: String(e.rightToWorkFileName || ''), uploadDate: String(e.rightToWorkUploadDate || ''), required: true },
    { key: 'visaEvidence', label: 'Visa Evidence', status: String(e.visaEvidence || 'not-uploaded'), fileName: String(e.visaEvidenceFileName || ''), uploadDate: String(e.visaEvidenceUploadDate || ''), required: false },
  ];
}

export function EvidenceTracker({ learner }: EvidenceTrackerProps) {
  const items = getEvidenceItems(learner);
  const requiredItems = items.filter(i => i.required);
  const uploaded = requiredItems.filter(i => i.status === 'uploaded').length;
  const pct = Math.round((uploaded / requiredItems.length) * 100);

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Evidence Uploads</h3>
          <p className="text-[11px] text-foreground-400 mt-0.5">{uploaded} of {requiredItems.length} required uploaded</p>
        </div>
        <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-full ${
          learner.evidenceUploads.allUploaded ? 'bg-emerald-50 text-emerald-600' : uploaded > 0 ? 'bg-primary-50 text-primary-600' : 'bg-background-200 text-foreground-400'
        }`}>
          {learner.evidenceUploads.allUploaded ? 'All Uploaded' : `${pct}%`}
        </span>
      </div>

      <div className="w-full h-1.5 bg-background-200 rounded-full overflow-hidden mb-4">
        <div className="h-full bg-primary-500 rounded-full transition-smooth" style={{ width: `${pct}%` }}></div>
      </div>

      <div className="space-y-2">
        {items.map(item => (
          <div key={item.key} className={`flex items-center justify-between p-2.5 rounded-lg border ${
            item.status === 'uploaded' ? 'border-emerald-200/50 bg-emerald-50/20' :
            item.status === 'partial' ? 'border-amber-200/50 bg-amber-50/20' :
            item.required ? 'border-red-200/30 bg-red-50/10' : 'border-background-200/30 bg-background-50'
          }`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                item.status === 'uploaded' ? 'bg-emerald-100 text-emerald-600' :
                item.status === 'partial' ? 'bg-amber-100 text-amber-600' :
                item.required ? 'bg-red-50 text-red-400' : 'bg-background-100 text-foreground-300'
              }`}>
                <AppIcon className={`${item.status === 'uploaded' ? 'ri-check-line' : item.status === 'partial' ? 'ri-time-line' : 'ri-close-line'} text-xs`}></AppIcon>
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-foreground-700 truncate">{item.label}</p>
                {item.fileName && <p className="text-[10px] text-foreground-400 truncate">{item.fileName}</p>}
              </div>
            </div>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
              item.status === 'uploaded' ? 'bg-emerald-50 text-emerald-600' :
              item.status === 'partial' ? 'bg-amber-50 text-amber-600' :
              item.required ? 'bg-red-50 text-red-500' : 'bg-background-200 text-foreground-400'
            }`}>
              {item.status === 'uploaded' ? 'Uploaded' : item.status === 'partial' ? 'Partial' : item.required ? 'Missing' : 'Optional'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}