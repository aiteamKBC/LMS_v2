/** Live teaching belongs to programme deliveries, not standalone self-study. */
export function isSelfStudyComponent(type: string): boolean {
  return type !== 'live-session';
}

export function requireSelfStudyContent(types: string[]): void {
  if (types.some(type => !isSelfStudyComponent(type))) {
    throw new Error('Free courses contain self-study content only. Choose content without live sessions.');
  }
}
