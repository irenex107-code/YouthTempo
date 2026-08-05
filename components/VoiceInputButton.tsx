import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/client";

type SpeechRecognitionEventLike = Event & {
  results: ArrayLike<{
    0: { transcript: string };
    isFinal: boolean;
  }>;
};

type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type VoiceInputButtonProps = {
  value: string;
  onChange: (value: string) => void;
};

function appendTranscript(current: string, transcript: string) {
  const clean = transcript.trim();
  if (!clean) return current;
  if (!current.trim()) return clean;
  return `${current.trimEnd()} ${clean}`;
}

export function VoiceInputButton({ value, onChange }: VoiceInputButtonProps) {
  const { t } = useTranslation();
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  }, [onChange, value]);

  useEffect(() => {
    setSupported(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
    return () => recognitionRef.current?.abort();
  }, []);

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function startListening() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setSupported(false);
      setMessage(t("common.voiceInput.unsupported"));
      return;
    }

    setMessage("");
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcripts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal && result[0]?.transcript) transcripts.push(result[0].transcript);
      }
      const nextValue = appendTranscript(valueRef.current, transcripts.join(" "));
      valueRef.current = nextValue;
      onChangeRef.current(nextValue);
      setMessage(t("common.voiceInput.transcribed"));
    };
    recognition.onerror = (event) => {
      const permissionDenied = event.error === "not-allowed" || event.error === "service-not-allowed";
      setMessage(
        permissionDenied
          ? t("common.voiceInput.permissionDenied")
          : t("common.voiceInput.notUnderstood"),
      );
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
      setMessage(t("common.voiceInput.startFailed"));
    }
  }

  if (supported === false) {
    return (
      <p className="text-xs leading-6 text-muted">
        {t("common.voiceInput.unsupported")}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={`min-h-10 rounded-full border px-4 py-2 text-xs font-bold transition focus:outline-none focus:ring-4 focus:ring-sage/15 ${
          listening
            ? "border-sage bg-mist text-sage-dark"
            : "border-ink/10 bg-white text-ink/70 hover:border-sage/50"
        }`}
        onClick={listening ? stopListening : startListening}
        aria-pressed={listening}
      >
        {listening ? t("common.voiceInput.stop") : t("common.voiceInput.start")}
      </button>
      {listening ? <span className="text-xs font-bold text-sage-dark">{t("common.voiceInput.listening")}</span> : null}
      {message ? <span className="text-xs leading-6 text-muted" aria-live="polite">{message}</span> : null}
    </div>
  );
}
