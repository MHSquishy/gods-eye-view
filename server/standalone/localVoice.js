import { readRequestBody } from '../providers/common/request.js';
import { admitSameSite } from '../providers/common/same-site.js';
import { readResponseJsonCapped } from '../../src/sources/httpBody.js';
import { GEV_REALTIME_TOOLS } from '../providers/openai/tools.js';

const COMMAND_TOOLS = new Set([
  'fly_to_location',
  'adjust_camera_zoom',
  'zoom_to_globe',
  'set_layer_visibility',
  'set_panel_open',
  'set_visual_style',
  'set_map_stack',
  'get_current_view_state',
]);
const TOOLS = GEV_REALTIME_TOOLS.filter((tool) =>
  COMMAND_TOOLS.has(tool.name),
).map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}));
const TOOL_HINTS = [
  [
    'fly_to_location',
    /\b(fly|take me|go to|head to|jump to|navigate|visit|find|show me|look at)\b/i,
  ],
  [
    'adjust_camera_zoom',
    /\b(zoom|closer|farther|further|pull back|back out)\b/i,
  ],
  ['zoom_to_globe', /\b(globe|whole world|planet view)\b/i],
  [
    'set_layer_visibility',
    /\b(layers?|flights?|planes?|aircraft|military|ships?|vessels?|satellites?|earthquakes?|fires?|traffic|cctv|cameras?|radio|transit|buses?|weather|air quality|alpr)\b/i,
  ],
  ['set_panel_open', /\b(panel|sidebar|drawer|tray)\b/i],
  [
    'set_visual_style',
    /\b(style|crt|nvg|flir|thermal|night vision|anime|noir|snow|sensor)\b/i,
  ],
  [
    'set_map_stack',
    /\b(map source|map stack|imagery|satellite map|terrain|osm|esri|photorealistic|3d tiles)\b/i,
  ],
  [
    'get_current_view_state',
    /\b(where am i|where are we|looking at|current view|view state|altitude|coordinates|latitude|longitude)\b/i,
  ],
];
const DEFAULT_TOOLS = new Set([
  'fly_to_location',
  'adjust_camera_zoom',
  'set_layer_visibility',
]);

function toolsFor(messages) {
  const text =
    [...messages].reverse().find((entry) => entry.role === 'user')?.content ||
    '';
  const selected = new Set(
    TOOL_HINTS.filter(([, pattern]) => pattern.test(text)).map(
      ([name]) => name,
    ),
  );
  const names = selected.size ? selected : DEFAULT_TOOLS;
  return TOOLS.filter((tool) => names.has(tool.function.name));
}
const MODEL_SERVER =
  process.platform === 'linux'
    ? 'http://host.docker.internal:1234'
    : 'http://127.0.0.1:1234';

function reply(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function availableModel(signal) {
  const response = await fetch(`${MODEL_SERVER}/v1/models`, { signal });
  if (!response.ok) throw new Error('LM Studio model server is unavailable');
  const body = await readResponseJsonCapped(response, 64 * 1024, signal);
  const ids = (body.data || [])
    .map((item) => item.id)
    .filter(
      (id) => typeof id === 'string' && id.length < 200 && !/embed/i.test(id),
    );
  const selected = ids.find((id) => /gemma-4-e4b/i.test(id));
  if (!selected) throw new Error('Download Gemma 4 E4B in LM Studio first');
  return selected;
}

function validMessages(messages) {
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= 8 &&
    messages.every(
      (entry) =>
        entry &&
        ['system', 'user', 'assistant'].includes(entry.role) &&
        typeof entry.content === 'string' &&
        entry.content.length <= 4000,
    )
  );
}

/** A fixed, same-origin bridge from the local app to LM Studio on this Mac. */
export function localVoicePlugin() {
  const install = (server) => {
    server.middlewares.use(async (req, res, next) => {
      const path = String(req.url || '').split('?', 1)[0];
      if (
        path !== '/api/local-voice/status' &&
        path !== '/api/local-voice/chat'
      )
        return next();
      if (admitSameSite(req, res)) return;
      if (
        (path.endsWith('/status') && req.method !== 'GET') ||
        (path.endsWith('/chat') && req.method !== 'POST')
      )
        return reply(res, 405, { error: 'Method not allowed' });
      const signal = AbortSignal.timeout(
        path.endsWith('/status') ? 5000 : 90000,
      );
      try {
        const model = await availableModel(signal);
        if (path.endsWith('/status')) return reply(res, 200, { model });
        if (
          !/^application\/json(?:\s*;|$)/i.test(
            req.headers['content-type'] || '',
          )
        )
          return reply(res, 415, { error: 'Expected JSON' });
        let body;
        try {
          body = JSON.parse(await readRequestBody(req, 24 * 1024, signal));
        } catch (error) {
          if (error instanceof SyntaxError)
            return reply(res, 400, { error: 'Invalid JSON' });
          throw error;
        }
        if (
          !validMessages(body?.messages) ||
          !['command', 'respond'].includes(body?.mode)
        )
          return reply(res, 400, { error: 'Invalid local voice request' });
        const offeredTools =
          body.mode === 'command' ? toolsFor(body.messages) : [];
        const offeredNames = new Set(
          offeredTools.map((tool) => tool.function.name),
        );
        const completion = await fetch(`${MODEL_SERVER}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: body.messages,
            ...(body.mode === 'command'
              ? { tools: offeredTools, tool_choice: 'auto' }
              : {}),
            reasoning_effort: 'none',
            temperature: 0.2,
            max_tokens: body.mode === 'command' ? 192 : 180,
            stream: false,
          }),
          signal,
        });
        const result = await readResponseJsonCapped(
          completion,
          256 * 1024,
          signal,
        );
        if (!completion.ok)
          return reply(res, 502, {
            error: result.error?.message || 'LM Studio request failed',
          });
        const message = result.choices?.[0]?.message;
        if (!message)
          return reply(res, 502, { error: 'LM Studio returned no answer' });
        return reply(res, 200, {
          model,
          message: {
            content: typeof message.content === 'string' ? message.content : '',
            tool_calls: Array.isArray(message.tool_calls)
              ? message.tool_calls
                  .slice(0, 3)
                  .filter((call) => offeredNames.has(call?.function?.name))
              : [],
          },
        });
      } catch (error) {
        const unavailable = /fetch failed|model server|Download Gemma/i.test(
          error.message,
        );
        return reply(res, unavailable ? 503 : 502, {
          error: unavailable
            ? 'Start LM Studio, enable its local server, and load Gemma 4 E4B.'
            : error.code === 'BODY_TOO_LARGE'
              ? 'Voice request is too large'
              : error.name === 'TimeoutError'
                ? 'Local model took too long to answer'
                : 'Local voice request failed',
        });
      }
    });
  };
  return { name: 'local-voice', configureServer: install };
}
