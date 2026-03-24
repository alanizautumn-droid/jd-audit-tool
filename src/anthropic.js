/**
 * api/anthropic.js — Vercel Serverless Function
 *
 * Proxies requests to Anthropic, injecting the API key server-side.
 * Rate limited to 100 requests per hour per IP.
 *
 * SETUP: In Vercel dashboard → Settings → Environment Variables, add:
 *   ANTHROPIC_API_KEY = sk-ant-...
 */

const rateLimitStore = new Map();
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW = 3600000;

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitStore.get(ip);
  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (record.count >= RATE_LIMIT_MAX) {
    const resetIn = Math.ceil((RATE_LIMIT_WINDOW - (now - record.windowStart)) / 1000);
    return { allowed: false, remaining: 0, resetIn };
  }
  record.count += 1;
  rateLimitStore.set(ip, record);
  return { allowed: true, remaining: RATE_LIMIT_MAX - record.count };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const { allowed, remaining, resetIn } = checkRateLimit(ip);
  res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
  res.setHeader("X-RateLimit-Remaining", String(remaining || 0));

  if (!allowed) {
    res.setHeader("Retry-After", String(resetIn));
    return res.status(429).json({ error: "Rate limit exceeded. Try again in " + resetIn + "s." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server configuration error" });
  }

  const body = req.body || {};
  const { model, max_tokens, messages } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }
  if (typeof max_tokens !== "number" || max_tokens < 1 || max_tokens > 8000) {
    return res.status(400).json({ error: "max_tokens must be between 1 and 8000" });
  }

  const allowedModels = ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5-20251001"];
  const safeModel = allowedModels.includes(model) ? model : "claude-sonnet-4-5";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: safeModel, max_tokens, messages }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Anthropic error:", response.status, data);
      return res.status(response.status).json({ error: "Upstream API error" });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(502).json({ error: "Failed to reach upstream API" });
  }
};
