// Flags a page (or section) as running on illustrative data because its
// metrics are owned by another team's system that has no API yet — e.g.
// attendance %, engagement score, OTJH, KSB progression, quiz average. Keeps
// staff from mistaking a mocked view for the live points economy.
export function SampleDataNotice({ detail }: { detail: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200/60 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800">
      <AppIcon className="ri-flask-line mt-0.5 shrink-0"></AppIcon>
      <span>
        <span className="font-semibold">Sample data.</span> {detail}
      </span>
    </div>
  );
}
