import type { AdminTransfer } from '@/api/progressTransfer';

function cell(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value);
  let first = 0;
  while (first < text.length && (text.charCodeAt(first) < 32 || /\s/.test(text[first]))) first++;
  const safe = /^[=+@-]/.test(text.slice(first)) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** One row per saved module; requests without modules are retained in the log. */
export function transferLogCsv(requests: AdminTransfer[]): string {
  const rows: (string | number | null | undefined)[][] = [[
    'Request ID', 'Learner', 'Learner ID', 'Learner type', 'Current programme', 'Status', 'Requested at', 'Approved at',
    'Source course', 'Source module', 'Destination module ID', 'Destination module', 'Saved progress (%)', 'Recorded hours', 'Demo progress',
  ]];
  for (const request of requests) {
    for (const module of request.modules.length ? request.modules : [null]) {
      rows.push([request.requestId, request.learnerName, request.learnerId, request.learnerKind, request.programme, request.status, request.requestedAt, request.approvedAt,
        module?.courseRef, module?.oldTitle, module?.moduleId, module?.newTitle,
        module && Number.isFinite(module.percent) && module.percent >= 0 && module.percent <= 100 ? module.percent : '',
        module && Number.isFinite(module.hours) && module.hours >= 0 ? module.hours : '', module ? module.demoProgress ? 'Yes' : 'No' : '',
      ]);
    }
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
