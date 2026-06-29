import { useEffect, useRef, useState } from 'react';

interface UseCountUpOptions {
  end: number;
  duration?: number;
  startOnMount?: boolean;
}

export function useCountUp({ end, duration = 1200, startOnMount = true }: UseCountUpOptions) {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(startOnMount);
  const frameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  const start = () => setStarted(true);

  useEffect(() => {
    if (!started) return;

    const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const progress = Math.min((timestamp - startTimeRef.current) / duration, 1);
      const eased = easeOutQuart(progress);
      setCount(Math.floor(eased * end));

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        setCount(end);
      }
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [started, end, duration]);

  return { count, start };
}

export function useInView(options?: { threshold?: number; rootMargin?: string; root?: Element | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
        }
      },
      { threshold: 0.2, ...options }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [options]);

  return { ref, isInView };
}