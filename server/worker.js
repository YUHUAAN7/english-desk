// Street Call trial coach server (Cloudflare Worker).
// Secrets (Settings → Variables and Secrets): ANTHROPIC_KEY = business API key, CODES = trial codes, comma separated.
// Optional KV binding USAGE enforces the daily limit on the server too.
const ORIGIN = "https://yuhuaan7.github.io";
const DAILY_LIMIT = 10;
const MODEL = "claude-sonnet-5-5";

const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-trial-code",
  "Access-Control-Max-Age": "86400"
};
const reply = (status, obj) => new Response(JSON.stringify(obj), {status, headers: {...cors, "content-type": "application/json"}});

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, {headers: cors});
    if (req.method !== "POST") return reply(405, {error: {message: "POST only"}});

    const code = (req.headers.get("x-trial-code") || "").trim();
    const codes = (env.CODES || "").split(",").map(s => s.trim()).filter(Boolean);
    if (!code || !codes.includes(code)) return reply(401, {error: {message: "체험 코드가 맞지 않습니다."}});

    // Only coaching requests: one short user message, fixed model, bounded output.
    let body;
    try { body = await req.json(); } catch { return reply(400, {error: {message: "bad json"}}); }
    const msg = body.messages && body.messages.length === 1 && body.messages[0];
    if (!msg || msg.role !== "user" || typeof msg.content !== "string" || msg.content.length > 6000)
      return reply(400, {error: {message: "요청 형식이 맞지 않습니다."}});

    if (env.USAGE) {
      const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // Seoul date
      const key = `${code}:${day}`;
      const used = Number(await env.USAGE.get(key)) || 0;
      if (used >= DAILY_LIMIT) return reply(429, {error: {message: `오늘 코치 교정 ${DAILY_LIMIT}회를 모두 쓰셨습니다. 내일 다시 이용해 주세요.`}});
      await env.USAGE.put(key, String(used + 1), {expirationTtl: 172800});
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {"content-type": "application/json", "x-api-key": env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01"},
      body: JSON.stringify({model: MODEL, max_tokens: 2000, output_config: body.output_config, messages: [{role: "user", content: msg.content}]})
    });
    return new Response(await r.text(), {status: r.status, headers: {...cors, "content-type": "application/json"}});
  }
};
