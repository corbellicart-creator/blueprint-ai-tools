'use strict';
// ── The one door to Anthropic for every Corbellic AI tool ────────────────
//
// WHY. Until Oct 2026 each tool page (basquiat-reverse, elite-title-creator,
// …) carried the API key in its own <script> and called api.anthropic.com
// from the browser. The key sat in public page source on two dozen sites;
// someone lifted it and ran Opus on the account at $60+ a minute. The pages
// now call THIS function instead, and the key lives only in this site's
// Netlify environment (ANTHROPIC_API_KEY) — never in a page, never in git.
//
// WHAT IT ALLOWS. A browser on one of our sites may ask for a Messages call
// with the fields a tool needs (messages, system, tools, max_tokens, model,
// temperature). Everything else is dropped. The model must be on the list
// below (a stranger cannot pick Opus), max_tokens is capped, and only our
// sites may call it (CORS allow-list). The workspace's monthly spend limit
// in the Claude Console is the backstop behind all of that.

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

// Models a tool may ask for. The first is what a page gets when it names
// something else (the retired claude-sonnet-4-20250514 the pages still name, a typo, or Opus).
const MODELS = [
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
];
const DEFAULT_MODEL = MODELS[0];
const MAX_TOKENS_CAP = 4096;
const MAX_MESSAGES = 40;
const MAX_BODY_BYTES = 5 * 1024 * 1024;   // photos arrive as base64; Netlify's own ceiling is ~6 MB

// Who may call: our Netlify sites and our domains. Add a site here when you
// make a new tool; a page from anywhere else gets no CORS header and the
// browser refuses the response.
const SITES = [
  'blueprintaitools', 'october-challenge', 'september-paint', 'basquiat-king',
  'august-paint-challenge', 'corb-vlt-k82mx4qz7', 'qr-code-thankyou',
  'accountability-checklist', 'elite-profit-calculator', 'june-winners',
  'july-summer-challenge', 'vip-application', 'vip-mentorship', 'june-challenge',
  'creator-translator', 'elite-picture-engineer', 'elite-photo-creator',
  'elite-title-creator', 'daily-paint-planner', 'may-challenge', 'basquiat-reverse',
  'basquiat-reference', 'elite-weekly-target', 'elite-shift-planner', 'listing-workshop',
  'april-challenge',
];
const DOMAINS = /^https:\/\/([a-z0-9-]+\.)*(corbellic-businessbuilder\.com|corbellic\.com)$/i;

function allowedOrigin(origin) {
  const o = String(origin || '').toLowerCase().replace(/\/$/, '');
  if (!o) return false;
  if (DOMAINS.test(o)) return true;
  const m = o.match(/^https:\/\/(?:[a-z0-9-]+--)?([a-z0-9-]+)\.netlify\.app$/);   // previews are deploy-preview-N--site.netlify.app
  return !!(m && SITES.includes(m[1]));
}

function corsHeaders(origin) {
  const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (allowedOrigin(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

// Only the fields a tool legitimately sends, each checked.
function shape(body) {
  if (!body || typeof body !== 'object') throw new Error('body must be a JSON object');
  if (!Array.isArray(body.messages) || !body.messages.length) throw new Error('messages[] is required');
  if (body.messages.length > MAX_MESSAGES) throw new Error('too many messages');
  for (const m of body.messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) throw new Error('each message needs role user|assistant');
    if (m.content == null) throw new Error('each message needs content');
  }
  const out = {
    model: MODELS.includes(body.model) ? body.model : DEFAULT_MODEL,
    max_tokens: Math.max(1, Math.min(MAX_TOKENS_CAP, parseInt(body.max_tokens, 10) || 2048)),
    messages: body.messages,
  };
  if (typeof body.system === 'string' && body.system) out.system = body.system;
  if (typeof body.temperature === 'number' && body.temperature >= 0 && body.temperature <= 1) out.temperature = body.temperature;
  if (Array.isArray(body.tools) && body.tools.length) {
    // Server tools only (web search); a client-defined tool makes no sense from a page.
    const tools = body.tools.filter((t) => t && typeof t.type === 'string' && /^web_search/.test(t.type));
    if (tools.length) out.tools = tools.map((t) => ({ type: t.type, name: t.name || 'web_search', max_uses: Math.min(5, parseInt(t.max_uses, 10) || 3) }));
  }
  return out;
}

async function handler(event, context, deps) {
  const d = deps || {};
  const doFetch = d.fetch || fetch;
  const key = d.key !== undefined ? d.key : process.env.ANTHROPIC_API_KEY;
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const headers = corsHeaders(origin);
  const reply = (statusCode, obj) => ({ statusCode, headers, body: JSON.stringify(obj) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });
  if (!allowedOrigin(origin)) return reply(403, { error: 'this tool may only be used from a Corbellic site' });
  if (!key) return reply(503, { error: 'AI is not configured on this site (no key)' });

  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return reply(413, { error: 'request too large — use smaller photos' });
  let body;
  try { body = JSON.parse(raw); } catch (e) { return reply(400, { error: 'body is not JSON' }); }
  let payload;
  try { payload = shape(body); } catch (e) { return reply(400, { error: e.message }); }

  try {
    const r = await doFetch(ANTHROPIC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': VERSION },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    // Pass Anthropic's answer through as-is (the pages already parse it), but
    // never its headers, and never anything that could carry the key.
    if (r.status >= 500) console.log('[ai] anthropic ' + r.status + ' for ' + origin);
    return { statusCode: r.status, headers, body: text };
  } catch (e) {
    console.log('[ai] fetch failed: ' + e.message);
    return reply(502, { error: 'could not reach the AI service — try again in a minute' });
  }
}

exports.handler = (event, context) => handler(event, context);
exports._test = { handler, shape, allowedOrigin, corsHeaders, MODELS, DEFAULT_MODEL, MAX_TOKENS_CAP, SITES };
