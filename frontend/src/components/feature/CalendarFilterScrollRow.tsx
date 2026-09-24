import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function CalendarFilterScrollRow({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  const scrollId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerX: number; scrollLeft: number } | null>(null);
  const [metrics, setMetrics] = useState({ left: 0, max: 0, clientWidth: 0, scrollWidth: 0 });

  const updateMetrics = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const maxScroll = element.scrollWidth - element.clientWidth;
    setMetrics({ left: element.scrollLeft, max: Math.max(0, maxScroll), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth });
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!element) return;
    updateMetrics();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMetrics);
    observer?.observe(element);
    if (content) observer?.observe(content);
    window.addEventListener('resize', updateMetrics);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateMetrics);
    };
  }, [updateMetrics]);

  const thumbWidth = metrics.scrollWidth > 0
    ? Math.min(100, Math.max(12, (metrics.clientWidth / metrics.scrollWidth) * 100))
    : 100;
  const thumbPosition = metrics.max > 0
    ? Math.min(1, Math.max(0, metrics.left / metrics.max))
    : 0;

  return (
    <div className="calendar-filter-scroll-shell">
      <div
        id={scrollId}
        ref={scrollRef}
        role="group"
        aria-label={ariaLabel}
        className="calendar-filter-row"
        onScroll={updateMetrics}
        onWheel={event => {
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            event.currentTarget.scrollLeft += event.deltaY;
            event.preventDefault();
          }
        }}
      >
        <div ref={contentRef} className="calendar-filter-row-content">{children}</div>
      </div>
      {metrics.max > 0 && (
        <div
          className="calendar-filter-scrollbar"
          role="scrollbar"
          aria-label={`${ariaLabel} scrollbar`}
          aria-controls={scrollId}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={Math.round(metrics.max)}
          aria-valuenow={Math.round(metrics.left)}
          tabIndex={0}
          onKeyDown={event => {
            const element = scrollRef.current;
            if (!element) return;
            if (event.key === 'ArrowLeft') element.scrollLeft -= 40;
            else if (event.key === 'ArrowRight') element.scrollLeft += 40;
            else if (event.key === 'Home') element.scrollLeft = 0;
            else if (event.key === 'End') element.scrollLeft = element.scrollWidth;
            else return;
            event.preventDefault();
          }}
          onPointerDown={event => {
            if (event.target !== event.currentTarget) return;
            const element = scrollRef.current;
            const trackWidth = event.currentTarget.clientWidth;
            if (!element || trackWidth <= 0) return;
            const ratio = element.clientWidth / element.scrollWidth;
            const position = event.nativeEvent.offsetX / trackWidth;
            element.scrollLeft = Math.max(0, Math.min(metrics.max, ((position - ratio / 2) / (1 - ratio)) * metrics.max));
          }}
        >
          <span
            className="calendar-filter-scrollbar-thumb"
            style={{ width: `${thumbWidth}%`, left: `${thumbPosition * 100}%`, transform: `translateX(-${thumbPosition * 100}%)` }}
            onPointerDown={event => {
              event.stopPropagation();
              dragRef.current = { pointerX: event.clientX, scrollLeft: scrollRef.current?.scrollLeft || 0 };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              const drag = dragRef.current;
              const element = scrollRef.current;
              const track = event.currentTarget.parentElement;
              if (!drag || !element || !track) return;
              element.scrollLeft = drag.scrollLeft + ((event.clientX - drag.pointerX) / track.clientWidth) * metrics.scrollWidth;
            }}
            onPointerUp={event => {
              dragRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { dragRef.current = null; }}
          />
        </div>
      )}
      <span aria-hidden="true" className={`calendar-filter-fade calendar-filter-fade-left${metrics.left > 1 ? ' is-visible' : ''}`} />
      <span aria-hidden="true" className={`calendar-filter-fade calendar-filter-fade-right${metrics.max - metrics.left > 1 ? ' is-visible' : ''}`} />
    </div>
  );
}
