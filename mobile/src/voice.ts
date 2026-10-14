import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

// Shared across playback and dictation so a late permission/voice response cannot restart a cancelled session.
let generation = 0;

export async function stopVoice(): Promise<void> {
  generation += 1;
  try { ExpoSpeechRecognitionModule.abort(); } catch { /* Capture may already be unavailable or stopped. */ }
  try { await Speech.stop(); } catch { /* Cancellation must remain safe during unmount/permission denial. */ }
}

export function chunkSpeechText(text: string, maximumLength = 3800): string[] {
  const limit = Number.isFinite(maximumLength) ? Math.max(1, Math.floor(maximumLength)) : 3800;
  const chunks: string[] = [];
  for (const sentence of text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []) {
    let remaining = sentence.trim();
    while (remaining.length > limit) {
      const boundary = remaining.lastIndexOf(' ', limit);
      const end = boundary > 0 ? boundary : limit;
      chunks.push(remaining.slice(0, end));
      remaining = remaining.slice(end).trimStart();
    }
    if (remaining) chunks.push(remaining);
  }
  return chunks;
}

export async function speakBritish(
  text: string,
  rate = 1,
  onDone?: () => void,
  onStart?: () => void,
  onError?: (message: string) => void,
): Promise<void> {
  const id = ++generation;
  let settled = false;
  let currentChunk = 0;
  const current = () => id === generation && !settled;
  const finish = (message?: string) => {
    if (!current()) return;
    settled = true;
    onDone?.();
    if (message) onError?.(message);
  };
  try {
    try { ExpoSpeechRecognitionModule.abort(); } catch { /* TTS remains available without dictation support. */ }
    await Speech.stop();
    if (!current()) return;
    const voices = await Speech.getAvailableVoicesAsync();
    if (!current()) return;
    const voice = voices.find(item => item.language.toLowerCase() === 'en-gb');
    const nativeLimit = Speech.maxSpeechInputLength;
    const limit = Number.isFinite(nativeLimit) && nativeLimit > 0 ? Math.min(nativeLimit, 3800) : 3800;
    const chunks = chunkSpeechText(text, limit);
    let index = 0;
    const next = () => {
      if (!current()) return;
      if (index >= chunks.length) { finish(); return; }
      const token = ++currentChunk;
      const ownsChunk = () => current() && token === currentChunk;
      try {
        Speech.speak(chunks[index++], {
          language: 'en-GB',
          voice: voice?.identifier,
          rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
          onStart: () => { if (ownsChunk()) onStart?.(); },
          onDone: () => { if (ownsChunk()) { currentChunk += 1; next(); } },
          onStopped: () => { if (ownsChunk()) finish(); },
          onError: () => { if (ownsChunk()) finish('Device read-aloud stopped. You can keep reading or use the tutor conversation.'); },
        });
      } catch {
        finish('Device read-aloud could not start. You can keep reading or use the tutor conversation.');
      }
    };
    next();
  } catch {
    finish('Device read-aloud could not start. You can keep reading or use the tutor conversation.');
  }
}

/** False means the request was cancelled while permissions were pending; no recording was started. */
export async function requestDictation(): Promise<boolean> {
  const id = ++generation;
  if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) throw new Error('Voice input is not available on this device. You can type your answer.');
  await Speech.stop();
  if (id !== generation) return false;
  const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (id !== generation) return false;
  if (!permission.granted) throw new Error('Microphone access was not granted. You can type instead.');
  ExpoSpeechRecognitionModule.start({ lang: 'en-GB', interimResults: true, continuous: false, maxAlternatives: 1 });
  return true;
}
