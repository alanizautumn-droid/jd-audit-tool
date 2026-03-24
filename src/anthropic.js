/**
 * api/anthropic.js  —  Vercel Serverless Function
 *
 * PURPOSE
 * -------
 * Proxies requests from the client to the Anthropic API, injecting the
 * API key server-side so it is never exposed in the browser.
 *
 * SETUP (one-time)
 * ----------------
 * 1. In Vercel dashboard → Project → Settings → Environment Variables:
 *    Add:  ANTHROPIC_API_KEY  =  sk-ant-...
 * 2. Deploy. The key is never in your repo or visible to the browser.
 *
 * CLIENT USAGE
 * ------------
 * Replace the direct Anthropic fetch in JDaudit.jsx:
 *
 *   // BEFORE (exposes key in browser network tab):
 *   fetch("https://api.anthropic.com/v1/messages", {
 *     headers: { "x-api-key": "sk-ant-...", "anthropic-dangerous-direct-browser-calls": "true" }
 *   })
 *
 *   // AFTER (key stays on server):
 *   fetch("/api/anthropic", {
 *     method: "POST",
 *     headers: { "Content-Type": "application/json" },
 *     body: JSON.stringify({ model, max_tokens, messages })
 *   })
 *
 * RATE LIMITING
 * -------------
 * Max 100 requests per hour per IP address.
 * Uses an in-memory store (resets on cold start — good enough for a prototype).
 * For production, replace with Redis or Vercel KV.
 *
 * SECURITY
 * --------
 * - API key injected server-side, never sent to browser
 * - Request body size capped at 32KB
 * - Only POST method accepted
 * - Prompt length validated before forwarding
 * - CORS locked to your own origin in production
 */

// ── In-memory rate limiter ────────────────────────────────────────
// Structure: { [ip]: { count: number, windowStart: number } }
const rateLimitStore = new Map();
const RATE_LIMIT_MAX = 100;        // requests
const RATE_LIMIT_WINDOW = 3600000; // 1 hour in ms

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW) {
    // New window
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

// ── Cleanup stale entries periodically ───────────────────────────
// Prevents unbounded memory growth on long-running instances
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore.entries()) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW) {
      rateLimitStore.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW);

// ── Main handler ─────────────────────────────────────────────────
export default async function handler(req, res) {
  // Method guard
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // CORS — lock to your own origin in production
  const origin = req.headers.origin;
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_SITE_URL,         // set this in Vercel env vars
    "http://localhost:3000",
    "http://localhost:5173",
  ].filter(Boolean);

  if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // IP extraction (works behind Vercel's proxy)
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  // Rate limit check
  const { allowed, remaining, resetIn } = checkRateLimit(ip);
  res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX);
  res.setHeader("X-RateLimit-Remaining", remaining ?? 0);

  if (!allowed) {
    res.setHeader("Retry-After", resetIn);
    return res.status(429).json({
      error: `Rate limit exceeded. Max ${RATE_LIMIT_MAX} requests per hour. Try again in ${resetIn}s.`,
    });
  }

  // Validate API key is configured
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set in environment variables.");
    return res.status(500).json({ error: "Server configuration error" });
  }

  // Parse and validate request body
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const { model, max_tokens, messages } = body || {};

  // Input validation
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }
  if (messages.length > 10) {
    return res.status(400).json({ error: "Too many messages" });
  }
  if (typeof max_tokens !== "number" || max_tokens < 1 || max_tokens > 8000) {
    return res.status(400).json({ error: "max_tokens must be between 1 and 8000" });
  }

  // Validate message structure and content length
  for (const msg of messages) {
    if (!msg.role || !msg.content) {
      return res.status(400).json({ error: "Each message needs role and content" });
    }
    if (!["user", "assistant"].includes(msg.role)) {
      return res.status(400).json({ error: "Invalid message role" });
    }
    if (typeof msg.content === "string" && msg.content.length > 50000) {
      return res.status(400).json({ error: "Message content too long (max 50,000 chars)" });
    }
  }

  // Allowlist model
  const allowedModels = [
    "claude-sonnet-4-5",
    "claude-opus-4-5",
    "claude-haiku-4-5-20251001",
  ];
  const safeModel = allowedModels.includes(model) ? model : "claude-sonnet-4-5";

  // Forward to Anthropic
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
      // Don't leak internal Anthropic error details to the client
      console.error("Anthropic API error:", response.status, data);
      return res.status(response.status).json({
        error: "Upstream API error",
        status: response.status,
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Proxy fetch error:", err);
    return res.status(502).json({ error: "Failed to reach upstream API" });
  }
}

// ── Vercel config: disable default body parsing so we control it ─
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "32kb", // Reject oversized payloads before they hit handler
    },
  },
};
