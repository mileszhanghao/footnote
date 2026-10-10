import { useCallback, useEffect, useRef, useState } from 'react'

// Minimal typing for the Web Speech API, which TypeScript's DOM lib omits.
interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}
interface Recognition {
  lang: string
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((event: RecognitionResultEvent) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}
type RecognitionCtor = new () => Recognition

function getRecognition(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

/**
 * Voice input and spoken answers using the browser's built-in Web Speech API.
 * The course version pulled in two third-party packages for this.
 */
export function useVoice(onTranscript: (text: string) => void) {
  const Ctor = getRecognition()
  const supported = Boolean(Ctor)
  const [listening, setListening] = useState(false)
  const recognition = useRef<Recognition | null>(null)
  const callback = useRef(onTranscript)
  useEffect(() => {
    callback.current = onTranscript
  }, [onTranscript])

  const start = useCallback(() => {
    if (!Ctor) return
    const r = new Ctor()
    r.lang = 'en-US'
    r.interimResults = false
    r.onresult = (event) => {
      const text = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? '')
        .join(' ')
        .trim()
      if (text) callback.current(text)
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    recognition.current = r
    setListening(true)
    r.start()
  }, [Ctor])

  const stop = useCallback(() => recognition.current?.stop(), [])

  const speak = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
  }, [])

  return { supported, listening, start, stop, speak }
}
