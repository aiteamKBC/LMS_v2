import { ticketAttachmentUrl, type TicketAttachment } from '@/api/supportTickets';

export default function TicketAttachments({ ticketId, attachments = [], staff = false, attachmentUrl }: {
  ticketId: string; attachments?: TicketAttachment[]; staff?: boolean;
  attachmentUrl?: (ticketId: string, attachmentId: string) => string;
}) {
  if (!attachments.length) return null;
  return <ul aria-label="Attachments" className="mt-2 space-y-2">
    {attachments.map(file => <li key={file.id}>
      <a href={attachmentUrl ? attachmentUrl(ticketId, file.id) : ticketAttachmentUrl(ticketId, file.id, staff)} download={file.name}
        className="flex min-w-0 items-center gap-2 rounded-lg border border-background-200 bg-background-50 px-3 py-2 text-xs text-primary-700 hover:bg-primary-50"
        aria-label={`Download ${file.name}`}>
        <span className="min-w-0 flex-1 break-all">{file.name}</span>
        <span className="shrink-0 text-[10px] text-foreground-400">{Math.max(1, Math.ceil(file.size / 1024))} KB</span>
        <span className="shrink-0">Download</span>
      </a>
    </li>)}
  </ul>;
}
