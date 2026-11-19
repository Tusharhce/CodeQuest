// Serverless function: the browser calls /api/gemini, and only this file talks to Google.
// The API key lives in the GEMINI_API_KEY environment variable and never reaches the browser.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || ''; // optional second model to try if the first is busy
const hits = new Map(); // simple per-IP rate limit (resets when the function restarts)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGoogle(model, body, key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({ error: { message: 'Bad response from the AI service.' } }));
  return { status: r.status, data };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: { message: 'Server is missing GEMINI_API_KEY.' } });

  const ip = String(req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  if (recent.length >= 15) return res.status(429).json({ error: { message: 'Too many requests. Please wait a minute.' } });
  recent.push(now);
  hits.set(ip, recent);

  const { contents, system, json } = req.body || {};
  if (!Array.isArray(contents) || contents.length === 0 || JSON.stringify(contents).length > 20000) {
    return res.status(400).json({ error: { message: 'Invalid request.' } });
  }

  const body = { contents, generationConfig: { maxOutputTokens: 8192 } };
  if (system) body.system_instruction = { parts: [{ text: String(system).slice(0, 2000) }] };
  if (json) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.temperature = 1;
  }

  try {
    const models = FALLBACK_MODEL && FALLBACK_MODEL !== MODEL ? [MODEL, FALLBACK_MODEL] : [MODEL];
    let last;
    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        last = await callGoogle(model, body, key);
        // Only retry when Google is overloaded (500/503). Anything else is returned straight away.
        if (last.status !== 503 && last.status !== 500) return res.status(last.status).json(last.data);
        if (attempt < 2) await sleep(1500 * (attempt + 1)); // wait 1.5s, then 3s
      }
    }
    return res.status(last.status).json(last.data);
  } catch (e) {
    return res.status(502).json({ error: { message: 'Could not reach the AI service.' } });
  }
};