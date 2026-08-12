// PI Buddy AI proxy
//
// Holds the real Anthropic API key server-side (as a Vercel env var) so the
// standalone PI_Buddy.html file never has to embed or ask anyone for a key.
// The browser posts { system, messages } here; this forwards it to Anthropic
// with the real key attached and relays the response back.
//
// Speaks the exact same protocol as LearnBuddy's "Ask Buddy" proxy — if you
// already have that one deployed, you can point PI Buddy's ⚙️ AI setup at
// that same URL (and secret, if you set one) instead of deploying this.
//
// Web search (the web_search_20250305 tool) is available but OFF by default —
// it only runs on a given request if the caller sends allowSearch:true in the
// POST body. PI Buddy exposes this as an explicit toggle the person checks,
// rather than deciding on Claude's behalf.
// Each search actually performed has a small additional cost on top of normal
// token usage — see https://docs.claude.com for current pricing.
//
// Required env var (Vercel dashboard -> Project -> Settings -> Environment Variables):
//   ANTHROPIC_API_KEY   your real Anthropic API key
//
// Optional env var, recommended so random visitors can't spend your quota:
//   PIBUDDY_APP_SECRET   any string; PI Buddy must send the same value
//                         back as the X-LearnBuddy-Secret header
//                         (kept as the same header name as LearnBuddy on purpose,
//                          so one proxy can serve both apps with one secret)

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-LearnBuddy-Secret");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (req.method === "GET") {
    // simple health check — visit the URL in a browser to confirm the key is set
    // add ?test=1 to make PI Buddy's proxy actually call Anthropic with a tiny
    // request, so you can see Anthropic's real rejection reason instead of
    // just a bare status code.
    if (req.query && req.query.test) {
      if (!apiKey) {
        res.status(200).json({ status: "no-key", message: "ANTHROPIC_API_KEY is empty on this deployment." });
        return;
      }
      try {
        const testRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 10,
            messages: [{ role: "user", content: "Reply with just: PONG" }],
          }),
        });
        const testData = await testRes.json();
        res.status(200).json({
          status: testRes.ok ? "live-call-succeeded" : "live-call-failed",
          anthropicStatus: testRes.status,
          anthropicResponse: testData,
          keyPreview: apiKey.slice(0, 7) + "..." + apiKey.slice(-4),
          keyLength: apiKey.length,
        });
      } catch (err) {
        res.status(200).json({ status: "fetch-threw", message: err.message });
      }
      return;
    }
    res.status(200).json({
      status: "ok",
      anthropicKeyConfigured: !!apiKey,
      appSecretConfigured: !!process.env.PIBUDDY_APP_SECRET,
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const requiredSecret = process.env.PIBUDDY_APP_SECRET;
  if (requiredSecret) {
    const provided = req.headers["x-learnbuddy-secret"];
    if (provided !== requiredSecret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  if (!apiKey) {
    res.status(500).json({
      error:
        "This proxy has no ANTHROPIC_API_KEY set yet — add it in the Vercel project's Environment Variables, then redeploy.",
    });
    return;
  }

  try {
    const { system, messages, allowSearch } = req.body || {};
    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "Request body must include a messages array." });
      return;
    }

    const payload = {
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: system || undefined,
      messages,
    };
    // Web search only runs when the caller explicitly asks for it on this request —
    // PI Buddy shows the person a toggle for this rather than deciding silently.
    if (allowSearch) {
      payload.tools = [{ type: "web_search_20250305", name: "web_search" }];
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      res.status(anthropicRes.status).json(data);
      return;
    }
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "Proxy error: " + err.message });
  }
};
