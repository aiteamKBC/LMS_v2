import { type ReactNode } from 'react';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightText(text: string, query: string): ReactNode {
  if (!query || !query.trim()) return text;
  const escaped = escapeRegExp(query.trim());
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    part.toLowerCase() === query.trim().toLowerCase()
      ? <mark key={i} className="bg-accent-200 text-accent-900 rounded-sm px-0.5">{part}</mark>
      : part
  );
}

export function highlightTextFragment(text: string, query: string): ReactNode {
  return highlightText(text, query);
}