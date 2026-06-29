import { useState, useEffect, useRef } from 'react';

const CASE_MESSAGES = [
  { from: 'Med Maher', role: 'Coach', date: '8 Jun 2026', text: 'Looking forward to our coaching session on the 18th. Please prepare your reflection on how the segmentation learning has impacted your day-to-day work at Tim Hortons.', unread: true, channel: 'In-app' },
  { from: 'Crispin Jones', role: 'Tutor', date: '6 Jun 2026', text: 'I have uploaded the recording of last week\'s session on the marketing environment. Please watch before Wednesday if you missed it.', unread: false, channel: 'In-app' },
  { from: 'Lauren Mitchell', role: 'Line Manager', date: '3 Jun 2026', text: 'Sophie applied segmentation thinking in our team meeting — suggested we look at our breakfast customer vs lunch customer profiles differently.', unread: false, channel: 'Email' },
];

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { threshold: 0.12 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

function AnimatedSection({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useScrollReveal();
  return (
    <div ref={ref} className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export default function MessagesTab() {
  const [activeMessage, setActiveMessage] = useState<number | null>(null);

  return (
    <div className="space-y-5">
      <AnimatedSection delay={0}>
        <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
          <div className="p-5 md:p-6">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2 mb-4">
              <i className="ri-mail-line text-primary-500"></i> Recent Messages
            </h2>
            <div className="space-y-2">
              {CASE_MESSAGES.map((msg, i) => (
                <div
                  key={i}
                  onClick={() => setActiveMessage(activeMessage === i ? null : i)}
                  className={`rounded-xl border p-4 cursor-pointer transition-all ${
                    msg.unread
                      ? 'border-primary-200/50 bg-primary-50/10 hover:border-primary-300/60'
                      : 'border-foreground-200/60 bg-background-100/60 hover:border-background-300/60'
                  }`}
                  style={{ animation: `fadeInUp 0.4s ease-out ${i * 0.08}s both` }}
                >
                  <div className="flex items-start justify-between mb-1.5">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        msg.role === 'Coach' ? 'bg-primary-100 text-primary-700' :
                        msg.role === 'Tutor' ? 'bg-accent-100 text-accent-700' :
                        'bg-secondary-100 text-secondary-700'
                      }`}>{msg.from.charAt(0)}</span>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-semibold text-foreground-900">{msg.from}</span>
                          <span className="text-[10px] text-foreground-400">{msg.role}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500 border border-background-200">{msg.channel}</span>
                      <span className="text-[10px] text-foreground-400">{msg.date}</span>
                      {msg.unread && <span className="w-2 h-2 rounded-full bg-primary-500"></span>}
                    </div>
                  </div>
                  <p className={`text-[12px] text-foreground-600 leading-relaxed ${activeMessage === i ? '' : 'line-clamp-2'}`}>{msg.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  );
}