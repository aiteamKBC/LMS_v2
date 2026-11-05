export function audioAlternativeUrl(value: unknown): string | null;
export function openAudioAlternative(value: unknown, handlers: { pause: () => void; persist: () => unknown | Promise<unknown>; open: (url: string) => unknown | Promise<unknown> }): Promise<boolean>;
