const SYSTEM_PROMPT = `You are the voice assistant for God's Eye View, a local globe app.
Use the available tools for requests that change the map or ask about its current view.
Only claim a map action happened after its tool succeeds. For other questions, answer
briefly and plainly. Never invent live data or claim to have consulted a feed.`;

const ALLOWED_ACTIONS = new Set([
  'fly_to_location',
  'adjust_camera_zoom',
  'zoom_to_globe',
  'set_layer_visibility',
  'set_panel_open',
  'set_visual_style',
  'set_map_stack',
  'get_current_view_state',
]);

const WAKE_PHRASE = /^god['’]?s\s+eye\s+view\b[\s,.:;!?–—-]*/i;
const RESULT_PAUSE_MS = 900;
const INTERIM_PAUSE_MS = 1200;
const SPEECH_END_GRACE_MS = 450;
const CLOSED_GRACE_MS = 200;
const WAKE_WINDOW_MS = 8000;

async function localCompletion(messages, signal) {
  const response = await fetch('/api/local-voice/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'command', messages }),
    signal,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Local model did not answer');
  return body.message;
}

function actionReply(name, result) {
  if (result?.ok === false)
    return result.error || `${name.replaceAll('_', ' ')} failed`;
  return typeof result?.say === 'string' && result.say.trim()
    ? result.say.trim()
    : `${name.replaceAll('_', ' ')} complete.`;
}

/** Browser speech input/output with Gemma reasoning through the local server. */
export function createLocalGemmaSession({
  emit,
  runAction,
  signal,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
}) {
  const Recognition =
    globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  const synthesis = globalThis.speechSynthesis;
  let recognition = null;
  let active = false;
  let processing = false;
  let request = null;
  let restartTimer = null;
  let utteranceTimer = null;
  let bufferedText = '';
  let recognitionResults = [];
  let wakeUntil = 0;
  let generation = 0;
  let history = [];

  const clearRestart = () => {
    if (restartTimer !== null) clearTimer(restartTimer);
    restartTimer = null;
  };
  const clearUtteranceTimer = () => {
    if (utteranceTimer !== null) clearTimer(utteranceTimer);
    utteranceTimer = null;
  };
  const resultText = () =>
    recognitionResults
      .map((result) => result.text)
      .filter(Boolean)
      .join(' ');
  const resetCapture = () => {
    bufferedText = '';
    recognitionResults = [];
    clearUtteranceTimer();
  };
  const scheduleUtterance = (delay = RESULT_PAUSE_MS) => {
    clearUtteranceTimer();
    if (!active || processing) return;
    utteranceTimer = setTimer(() => {
      utteranceTimer = null;
      const heard = `${bufferedText} ${resultText()}`
        .replace(/\s+/g, ' ')
        .trim();
      resetCapture();
      if (!heard || !active || processing) return;
      const wake = WAKE_PHRASE.exec(heard);
      const command = wake ? heard.slice(wake[0].length).trim() : heard;
      if (wake && !command) {
        wakeUntil = now() + WAKE_WINDOW_MS;
        stopRecognition();
        emit({
          type: 'state',
          state: 'listening',
          detail: 'Wake phrase heard — say a command',
        });
        scheduleListening();
        return;
      }
      if (!wake && (!wakeUntil || now() > wakeUntil)) {
        stopRecognition();
        scheduleListening();
        return;
      }
      wakeUntil = 0;
      void handleText(command);
    }, delay);
  };
  const stopRecognition = () => {
    const current = recognition;
    recognition = null;
    if (current) {
      current.onend = null;
      current.onresult = null;
      current.onerror = null;
      current.onspeechstart = null;
      current.onspeechend = null;
      try {
        current.abort();
      } catch {
        /* Already stopped. */
      }
    }
  };
  const beginListening = () => {
    if (!active || processing) return;
    try {
      const next = new Recognition();
      let speechEnded = false;
      next.lang = globalThis.navigator?.language || 'en-US';
      next.continuous = true;
      next.interimResults = true;
      next.onresult = (event) => {
        // A result event contains the whole session. Interim entries can be
        // replaced or removed, so rebuild rather than appending duplicates.
        recognitionResults = Array.from(event.results, (result) => ({
          text: result[0]?.transcript?.trim() || '',
          final: Boolean(result.isFinal),
        }));
        if (bufferedText || recognitionResults.some((result) => result.final))
          scheduleUtterance(
            speechEnded ? SPEECH_END_GRACE_MS : RESULT_PAUSE_MS,
          );
        else if (resultText())
          scheduleUtterance(
            speechEnded ? SPEECH_END_GRACE_MS : INTERIM_PAUSE_MS,
          );
      };
      next.onspeechstart = clearUtteranceTimer;
      next.onspeechend = () => {
        if (speechEnded || recognition !== next) return;
        speechEnded = true;
        // stop() closes the microphone but still asks Chrome for its final
        // transcript. abort() would discard the last words.
        try {
          next.stop();
        } catch {
          /* The recognizer may already be closing. */
        }
        if (recognition === next && (bufferedText || resultText()))
          scheduleUtterance(SPEECH_END_GRACE_MS);
      };
      next.onerror = (event) => {
        if (
          [
            'not-allowed',
            'service-not-allowed',
            'audio-capture',
            'network',
          ].includes(event.error)
        ) {
          stop();
          emit({
            type: 'state',
            state: 'error',
            detail: `Microphone: ${event.error}`,
          });
        }
      };
      next.onend = () => {
        if (recognition !== next) return;
        recognition = null;
        bufferedText = `${bufferedText} ${resultText()}`.trim();
        recognitionResults = [];
        if (bufferedText)
          scheduleUtterance(speechEnded ? CLOSED_GRACE_MS : RESULT_PAUSE_MS);
        if (!speechEnded || !bufferedText) scheduleListening();
      };
      recognition = next;
      next.start();
      emit({
        type: 'state',
        state: 'listening',
        detail:
          wakeUntil > now()
            ? 'Wake phrase heard — say a command'
            : 'Say “God’s Eye View,” then your command',
      });
    } catch (error) {
      stop();
      emit({ type: 'state', state: 'error', detail: error.message });
    }
  };
  const scheduleListening = () => {
    clearRestart();
    if (!active || processing) return;
    restartTimer = setTimer(() => {
      restartTimer = null;
      beginListening();
    }, 200);
  };
  const speak = (text, turnGeneration) => {
    if (!active || turnGeneration !== generation) return;
    const line = String(text || '')
      .trim()
      .slice(0, 800);
    emit({ type: 'transcript', role: 'assistant', text: line, final: true });
    history = [...history, { role: 'assistant', content: line }].slice(-4);
    if (!line) {
      processing = false;
      scheduleListening();
      return;
    }
    const utterance = new globalThis.SpeechSynthesisUtterance(line);
    utterance.lang = globalThis.navigator?.language || 'en-US';
    utterance.rate = 1.05;
    const done = () => {
      if (turnGeneration !== generation) return;
      processing = false;
      scheduleListening();
    };
    utterance.onend = done;
    utterance.onerror = done;
    synthesis.cancel();
    synthesis.speak(utterance);
  };
  const handleText = async (rawText) => {
    const text = String(rawText || '')
      .trim()
      .slice(0, 1200);
    if (!active || processing || !text) return false;
    processing = true;
    const turnGeneration = generation;
    clearRestart();
    stopRecognition();
    emit({ type: 'interruption' });
    emit({ type: 'transcript', role: 'user', text, final: true });
    emit({
      type: 'state',
      state: 'executing',
      detail: 'Gemma is thinking locally',
    });
    request = new AbortController();
    try {
      const message = await localCompletion(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history,
          { role: 'user', content: text },
        ],
        request.signal,
      );
      if (!active || turnGeneration !== generation) return false;
      const calls = Array.isArray(message.tool_calls)
        ? message.tool_calls.slice(0, 3)
        : [];
      const replies = [];
      for (const call of calls) {
        const name = call?.function?.name;
        if (!ALLOWED_ACTIONS.has(name)) continue;
        let args;
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          replies.push('The map command was malformed.');
          continue;
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) continue;
        try {
          const result = await runAction(name, args, { callId: call.id });
          replies.push(actionReply(name, result));
        } catch (error) {
          if (turnGeneration !== generation) return false;
          replies.push(error.message || 'The map action failed.');
        }
      }
      if (!active || turnGeneration !== generation) return false;
      history = [...history, { role: 'user', content: text }].slice(-3);
      const answer = replies.length
        ? replies.join(' ')
        : String(message.content || '').trim() ||
          'I could not answer that yet.';
      speak(answer, turnGeneration);
      return true;
    } catch (error) {
      if (!active || turnGeneration !== generation) return false;
      stop();
      emit({ type: 'state', state: 'error', detail: error.message });
      return false;
    } finally {
      if (turnGeneration === generation) request = null;
    }
  };
  function stop() {
    generation++;
    active = false;
    processing = false;
    clearRestart();
    resetCapture();
    wakeUntil = 0;
    request?.abort();
    request = null;
    stopRecognition();
    synthesis?.cancel();
    history = [];
  }

  signal?.addEventListener('abort', stop, { once: true });
  return {
    capabilities: {
      costControls: false,
      pushToTalk: false,
      advisoryLimit:
        'Gemma runs on this Mac. Chrome speech recognition may use Chrome’s speech service.',
    },
    start() {
      if (!Recognition || !synthesis || !globalThis.SpeechSynthesisUtterance)
        throw new Error(
          'Open this local app in Chrome to use free Gemma voice.',
        );
      active = true;
      generation++;
      history = [];
      resetCapture();
      wakeUntil = 0;
      beginListening();
    },
    stop,
    sendText: (text) => {
      void handleText(text);
      return active;
    },
    sendMapEvent: () => false,
    getStartOptions: () => ({ pushToTalk: false }),
  };
}
