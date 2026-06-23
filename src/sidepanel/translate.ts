// Translation without any external API, key, or backend.
//
// Primary: Chrome's built-in on-device Translator API (stable since Chrome 138),
// which runs a local model — free, private, offline once downloaded.
// Fallback: one-click links that open the selected text pre-filled in DeepL or
// Google Translate.

const PAIR = { sourceLanguage: 'es', targetLanguage: 'en' } as const;

// Minimal typings for the built-in Translator API (no official @types yet).
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available' | string;

interface TranslatorInstance {
  translate(input: string): Promise<string>;
}

interface TranslatorStatic {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  create(opts: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }): Promise<TranslatorInstance>;
}

function translatorStatic(): TranslatorStatic | undefined {
  return (globalThis as unknown as { Translator?: TranslatorStatic }).Translator;
}

/** Whether the browser exposes the built-in Translator API at all. */
export function isOnDeviceSupported(): boolean {
  return !!translatorStatic();
}

// Cache the created translator so we download the model at most once.
let translatorPromise: Promise<TranslatorInstance> | null = null;

export interface TranslateProgress {
  /** True while the on-device model is still downloading. */
  downloading: boolean;
}

async function getTranslator(
  onProgress?: (p: TranslateProgress) => void,
): Promise<TranslatorInstance | null> {
  const api = translatorStatic();
  if (!api) return null;

  const availability = await api.availability(PAIR);
  if (availability === 'unavailable' || availability === 'no') return null;

  if (!translatorPromise) {
    if (availability !== 'available' && availability !== 'readily') {
      onProgress?.({ downloading: true });
    }
    translatorPromise = api
      .create({
        ...PAIR,
        monitor(m) {
          m.addEventListener('downloadprogress', () => onProgress?.({ downloading: true }));
        },
      })
      .catch((err) => {
        translatorPromise = null; // allow retry on a later attempt
        throw err;
      });
  }
  return translatorPromise;
}

/** Translate Spanish → English on-device. Throws if the API is unavailable. */
export async function translateOnDevice(
  text: string,
  onProgress?: (p: TranslateProgress) => void,
): Promise<string> {
  const translator = await getTranslator(onProgress);
  if (!translator) throw new Error('on-device translation unavailable');
  return translator.translate(text);
}

export function deeplUrl(text: string): string {
  return `https://www.deepl.com/translator#es/en/${encodeURIComponent(text)}`;
}

export function googleTranslateUrl(text: string): string {
  return `https://translate.google.com/?sl=es&tl=en&op=translate&text=${encodeURIComponent(text)}`;
}

/** Open a URL in a new browser tab (works from the side panel). */
export function openInTab(url: string): void {
  if (chrome?.tabs?.create) chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noopener');
}
