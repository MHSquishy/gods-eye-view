import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalGemmaSession } from './localGemmaSession.js';

function harness(t) {
  const names = [
    'SpeechRecognition',
    'webkitSpeechRecognition',
    'speechSynthesis',
    'SpeechSynthesisUtterance',
    'fetch',
  ];
  const previous = new Map(
    names.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  let time = 1000;
  let nextTimer = 0;
  const timers = new Map();
  const setTimer = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, due: time + delay });
    return id;
  };
  const advance = (milliseconds) => {
    const end = time + milliseconds;
    while (true) {
      const due = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
      if (!due || due[1].due > end) break;
      time = due[1].due;
      timers.delete(due[0]);
      due[1].callback();
    }
    time = end;
  };
  const recognizers = [];
  class Recognition {
    start() {
      recognizers.push(this);
    }
    stop() {
      this.stopCount = (this.stopCount || 0) + 1;
    }
    abort() {}
  }
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  const spoken = [];
  globalThis.SpeechRecognition = Recognition;
  globalThis.SpeechSynthesisUtterance = Utterance;
  globalThis.speechSynthesis = {
    cancel() {},
    speak(utterance) {
      spoken.push(utterance.text);
    },
  };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call-1',
                function: {
                  name: 'fly_to_location',
                  arguments: JSON.stringify({ query: 'Tokyo' }),
                },
              },
            ],
          },
        };
      },
    };
  };
  const actions = [];
  const session = createLocalGemmaSession({
    emit: () => {},
    runAction: async (name, args) => {
      actions.push({ name, args });
      return { ok: true, say: 'Flying to Tokyo.' };
    },
    setTimer,
    clearTimer: (id) => timers.delete(id),
    now: () => time,
  });
  t.after(() => {
    session.stop();
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const result = (text, isFinal = true) => ({
    0: { transcript: text },
    isFinal,
  });
  const heard = (recognizer, ...results) =>
    recognizer.onresult({ resultIndex: 0, results });
  return {
    session,
    recognizers,
    requests,
    actions,
    spoken,
    advance,
    result,
    heard,
  };
}

async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

test('speech without the wake phrase cannot reach Gemma or a map action', async (t) => {
  const h = harness(t);
  h.session.start();
  assert.equal(h.recognizers[0].continuous, true);
  h.heard(h.recognizers[0], h.result('Take me to Tokyo'));
  h.advance(2200);
  await settle();
  assert.equal(h.requests.length, 0);
  assert.equal(h.actions.length, 0);
  assert.equal(h.spoken.length, 0);
  h.advance(200);
  assert.equal(h.recognizers.length, 2);
  h.heard(h.recognizers[1], h.result("Take me to Tokyo, God's Eye View"));
  h.advance(2200);
  assert.equal(h.requests.length, 0);
});

test('wake phrase and command split across recognition sessions are joined once', async (t) => {
  const h = harness(t);
  h.session.start();
  const first = h.recognizers[0];
  h.heard(first, h.result("God's Eye View, take me"));
  first.onend();
  h.advance(200);
  const second = h.recognizers[1];
  h.heard(second, h.result('to', false));
  h.heard(second, h.result('to Tokyo'));
  h.advance(2200);
  await settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/local-voice/chat');
  assert.equal(
    JSON.parse(h.requests[0].options.body).messages.at(-1).content,
    'take me to Tokyo',
  );
  assert.deepEqual(h.actions, [
    { name: 'fly_to_location', args: { query: 'Tokyo' } },
  ]);
  assert.deepEqual(h.spoken, ['Flying to Tokyo.']);
});

test('speech end closes the microphone and sends the command promptly', async (t) => {
  const h = harness(t);
  h.session.start();
  const recognizer = h.recognizers[0];
  h.heard(recognizer, h.result("God's Eye View, take me to Tokyo"));
  recognizer.onspeechend();
  assert.equal(recognizer.stopCount, 1);
  recognizer.onend();
  h.advance(199);
  assert.equal(h.requests.length, 0);
  h.advance(1);
  await settle();
  assert.equal(h.requests.length, 1);
});

test('wake phrase by itself arms only the next spoken command', async (t) => {
  const h = harness(t);
  h.session.start();
  h.heard(h.recognizers[0], h.result('Gods eye view.'));
  h.advance(2200);
  await settle();
  assert.equal(h.requests.length, 0);
  h.advance(200);
  h.heard(h.recognizers[1], h.result('Take me to Tokyo'));
  h.advance(2200);
  await settle();
  assert.equal(h.requests.length, 1);
});

test('speaking again holds an early fragment until the rest arrives', async (t) => {
  const h = harness(t);
  h.session.start();
  const recognizer = h.recognizers[0];
  h.heard(recognizer, h.result("God's Eye View take me"));
  h.advance(700);
  recognizer.onspeechstart();
  h.advance(2500);
  assert.equal(h.requests.length, 0);
  h.heard(recognizer, h.result("God's Eye View take me"), h.result('to Tokyo'));
  recognizer.onspeechend();
  recognizer.onend();
  h.advance(200);
  await settle();
  assert.equal(
    JSON.parse(h.requests[0].options.body).messages.at(-1).content,
    'take me to Tokyo',
  );
});

test('the last interim result is used when speech ends without a final result', async (t) => {
  const h = harness(t);
  h.session.start();
  const recognizer = h.recognizers[0];
  h.heard(recognizer, h.result("God's Eye View take me to Tokyo", false));
  recognizer.onspeechend();
  h.advance(2200);
  await settle();
  assert.equal(h.requests.length, 1);
  assert.equal(
    JSON.parse(h.requests[0].options.body).messages.at(-1).content,
    'take me to Tokyo',
  );
});

test('an interim-only result also closes by itself if Chrome omits speechend', async (t) => {
  const h = harness(t);
  h.session.start();
  h.heard(h.recognizers[0], h.result("God's Eye View take me to Tokyo", false));
  h.advance(1199);
  assert.equal(h.requests.length, 0);
  h.advance(1);
  await settle();
  assert.equal(h.requests.length, 1);
});

test('a standalone wake phrase expires before a later command', async (t) => {
  const h = harness(t);
  h.session.start();
  h.heard(h.recognizers[0], h.result("God's Eye View"));
  h.advance(2200);
  h.advance(8001);
  h.heard(h.recognizers.at(-1), h.result('Take me to Tokyo'));
  h.advance(2200);
  await settle();
  assert.equal(h.requests.length, 0);
});
