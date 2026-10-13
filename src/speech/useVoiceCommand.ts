// Hold-to-talk using the OS speech recognizer (SFSpeechRecognizer / Android
// SpeechRecognizer): free, and on-device whenever the phone supports it.
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useRef, useState } from 'react';

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

export function useVoiceCommand(onCommand: (text: string) => void) {
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
    if (event.error === 'aborted' || event.error === 'no-speech' || event.error === 'speech-timeout') return;
    if (onDevice.current && (event.error === 'language-not-supported' || event.error === 'service-not-allowed')) {
      // On-device model not installed for this language: fall back to the OS network recognizer next time.
      onDevice.current = false;
      setError('On-device speech is unavailable for this language; hold the mic again to use the network recognizer.');
      return;
    }
    setError(event.message || event.error);
  });

  const start = useCallback(async () => {
    setError(null);
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setError('Microphone and speech permissions are needed for voice edits.');
      return;
    }
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setError('Speech recognition is not available on this device.');
      return;
    }
    latest.current = '';
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      continuous: false,
      addsPunctuation: false,
      contextualStrings: CONTEXTUAL_STRINGS,
      requiresOnDeviceRecognition: onDevice.current && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
    });
  }, []);

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  return { listening, transcript, error, start, stop, clearError: () => setError(null) };
}
