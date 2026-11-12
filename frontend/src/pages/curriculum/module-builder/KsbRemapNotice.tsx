import { Notice } from '@/components/ui/Notice';
import type { KsbRemapReport } from './moduleAuthoringData';

export function KsbRemapNotice({ report, onReview }: { report?: KsbRemapReport | null; onReview: () => void }) {
  if (!report?.unmatched?.length) return null;
  const byCode = new Map<string, { count: number; reasons: Set<string> }>();
  for (const entry of report.unmatched) {
    const code = entry.code?.trim() || 'Unknown code';
    const group = byCode.get(code) || { count: 0, reasons: new Set<string>() };
    group.count += 1;
    group.reasons.add(entry.reason?.trim() || 'Review this mapping.');
    byCode.set(code, group);
  }
  return <div data-testid="module-ksb-remap-report"><Notice tone="attention" title="Review copied KSB links"
    detailsLabel={`View copy report · ${byCode.size} ${byCode.size === 1 ? 'code' : 'codes'}`}
    details={<>
      <p>{report.unmatched.length} copied links could not be matched when this module was copied. The same code may appear in several places. Compare this saved report with the current mappings.</p>
      <div role="region" aria-label="Copied KSB links" tabIndex={0} className="mt-3 max-h-72 overflow-auto rounded-lg border border-background-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-background-100 text-foreground-600"><tr><th scope="col" className="px-3 py-2">Code</th><th scope="col" className="px-3 py-2">Links</th><th scope="col" className="px-3 py-2">Reason</th></tr></thead>
          <tbody className="divide-y divide-background-200">{[...byCode].map(([code, group]) => <tr key={code}>
            <th scope="row" className="px-3 py-2 align-top">{code}</th><td className="px-3 py-2 align-top tabular-nums">{group.count}</td>
            <td className="px-3 py-2"><ul>{[...group.reasons].map(reason => <li key={reason}>{reason}</li>)}</ul></td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
    actions={<button type="button" onClick={onReview} className="min-h-9 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-[13px] font-semibold text-primary-700 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">Review current mappings</button>}>
    Some links to knowledge, skills and behaviours need checking against this programme’s requirements.
  </Notice></div>;
}
