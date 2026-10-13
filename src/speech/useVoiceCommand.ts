// Hold-to-talk using the OS speech recognizer (SFSpeechRecognizer / Android
// SpeechRecognizer): free, and on-device whenever the phone supports it, so it
// keeps working offline there. Without the native module (e.g. an old build),
// voice is reported as unavailable and typing still works.
import { useCallback, useRef, useState } from 'react';

type SpeechModule = typeof import('expo-speech-recognition');
type SpeechErrorCode = import('expo-speech-recognition').ExpoSpeechRecognitionErrorCode;

let speech: SpeechModule | null = null;
try {
  speech = require('expo-speech-recognition') as SpeechModule;
} catch {
  speech = null;
}

// Biases recognition toward editing vocabulary ("vignette", not "vinaigrette").
const CONTEXTUAL_STRINGS = [
  'exposure',
  'contrast',
  'highlights',
  'shadows',
  'saturation',
  'vibrance',
  'vignette',
  'clarity',
  'dehaze',
  'sepia',
  'monochrome',
  'black and white',
  'background',
  'skin',
  'sky',
  'warmer',
  'cooler',
  'grain',
  'matte',
];

export interface VoiceCommand {
  available: boolean;
  listening: boolean;
  transcript: string;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  clearError: () => void;
}

/** Plain-language advice for recognizer errors; null means stay quiet. */
export function voiceErrorMessage(code: SpeechErrorCode, message?: string): string | null {
  switch (code) {
    case 'aborted':
    case 'no-speech':
    case 'speech-timeout':
      return null;
    case 'network':
      return "Voice needs a connection on this phone right now. Type the edit instead; everything else works offline.";
    case 'not-allowed':
      return 'Allow microphone and speech recognition in Settings to edit by voice.';
    case 'audio-capture':
      return "The microphone isn't available. Type the edit instead.";
    case 'language-not-supported':
    case 'service-not-allowed':
      return 'Speech recognition is not available for this language here. Type the edit instead.';
    case 'busy':
      return 'The speech recognizer is busy. Try again in a moment.';
    default:
      return message || "Voice didn't work that time. Try again or type the edit.";
  }
}

const UNAVAILABLE_MESSAGE = 'Voice input is not available in this build. Type the edit instead.';

function useVoiceUnavailable(): VoiceCommand {
  const [error, setError] = useState<string | null>(null);
  return {
    available: false,
    listening: false,
    transcript: '',
    error,
    start: async () => setError(UNAVAILABLE_MESSAGE),
    stop: () => {},
    clearError: () => setError(null),
  };
}

function useVoiceWithRecognizer(onCommand: (text: string) => void): VoiceCommand {
  const { ExpoSpeechRecognitionModule: recognizer, useSpeechRecognitionEvent } = speech!;
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const latest = useRef('');
  const onDevice = useRef(true);
  const handler = useRef(onCommand);
  handler.current = onCommand;

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    latest.current = text;
    setTranscript(text);
  });
  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    const text = latest.current.trim();
    latest.current = '';
    setTranscript('');
    if (text) handler.current(text);
  });
  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    if (onDevice.current && (event.error === 'language-not-supported' || event.error === 'service-not-allowed')) {
      // On-device model not installed for this language: use the OS network recognizer next time.
      onDevice.current = false;
      setError('On-device speech is not available for this language; hold the mic again to use the online recognizer.');
      return;
    }
    setError(voiceErrorMessage(event.error, event.message));
  });

  const start = useCallback(async () => {
    setError(null);
    try {
      const permission = await recognizer.requestPermissionsAsync();
      if (!permission.granted) {
        setError(voiceErrorMessage('not-allowed'));
        return;
      }
      if (!recognizer.isRecognitionAvailable()) {
        setError('Speech recognition is not available on this device. Type the edit instead.');
        return;
      }
      latest.current = '';
      recognizer.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
        addsPunctuation: false,
        contextualStrings: CONTEXTUAL_STRINGS,
        requiresOnDeviceRecognition: onDevice.current && recognizer.supportsOnDeviceRecognition(),
      });
    } catch (e) {
      setListening(false);
      setError(voiceErrorMessage('unknown', e instanceof Error ? e.message : undefined));
    }
  }, [recognizer]);

  const stop = useCallback(() => {
    try {
      recognizer.stop();
    } catch {
      setListening(false);
    }
  }, [recognizer]);

  return { available: true, listening, transcript, error, start, stop, clearError: () => setError(null) };
}

export const useVoiceCommand: (onCommand: (text: string) => void) => VoiceCommand = speech
  ? useVoiceWithRecognizer
  : () => useVoiceUnavailable();
