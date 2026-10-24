const DOT = 'h-1.5 w-1.5 rounded-full bg-inclusion-dot motion-reduce:animate-none motion-reduce:opacity-70';

export function InclusionLoading() {
  return <div className="fixed inset-0 z-[9999] grid place-items-center bg-inclusion-bg p-6 text-inclusion-ink" role="status" aria-live="polite" aria-label="Opening Inclusion & Safeguarding">
    <div className="max-w-[480px] text-center">
      <div className="mx-auto mb-7 mt-0 grid h-[76px] w-[76px] place-items-center rounded-full border border-inclusion-gold-border bg-inclusion-gold-bg text-inclusion-gold" aria-hidden="true">
        <svg className="h-[34px] w-[34px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/></svg>
      </div>
      <h1 className="m-0 font-georgia text-[clamp(24px,4vw,30px)] font-medium leading-[1.3] tracking-[-0.3px] text-inclusion-ink">Inclusion &amp; Safeguarding</h1>
      <p className="mx-0 mb-0 mt-3 font-arial text-[14px] leading-[1.6] text-inclusion-muted">A moment for your wellbeing.</p>
      <div className="mt-[30px] flex justify-center gap-[7px]" aria-hidden="true">
        <span className={`${DOT} animate-inclusion-breathe`}/><span className={`${DOT} animate-inclusion-breathe-2`}/><span className={`${DOT} animate-inclusion-breathe-3`}/>
      </div>
    </div>
  </div>;
}
