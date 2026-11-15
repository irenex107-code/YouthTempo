import type { Page } from "@playwright/test";

type VoiceProbe = {
  info: () => Array<{ starts: number; stops: number; aborts: number }>;
  result: (index: number, transcript: string) => void;
  error: (index: number) => void;
  end: (index: number) => void;
};

declare global { interface Window { __voiceInputProbe: VoiceProbe } }

/** Replaces speech recognition before application JS. Never opens a microphone. */
export async function syntheticVoiceInput(page: Page) {
  await page.addInitScript(() => {
    type Result = { results: Array<{ 0: { transcript: string }; isFinal: boolean }> };
    const instances: Recognition[] = [];
    class Recognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: Result) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      captured: { result: Recognition["onresult"]; error: Recognition["onerror"]; end: Recognition["onend"] } | null = null;
      starts = 0;
      stops = 0;
      aborts = 0;
      constructor() { instances.push(this); }
      start() {
        ++this.starts;
        // Retain already queued callbacks even if the app later detaches handlers.
        this.captured = { result: this.onresult, error: this.onerror, end: this.onend };
      }
      stop() { ++this.stops; }
      abort() { ++this.aborts; }
    }
    Object.defineProperty(window, "SpeechRecognition", { value: Recognition, configurable: true });
    window.__voiceInputProbe = {
      info: () => instances.map(({ starts, stops, aborts }) => ({ starts, stops, aborts })),
      result: (index, transcript) => instances[index].captured?.result?.({ results: [{ 0: { transcript }, isFinal: true }] }),
      error: (index) => instances[index].captured?.error?.({ error: "not-allowed" }),
      end: (index) => instances[index].captured?.end?.(),
    };
  });
}
