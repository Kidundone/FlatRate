import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const KIND_TEXT: Record<string, { label: string; hint: string }> = {
  missing_work: { label: "Missing work",
    hint: "A job the technician completed isn't showing up on their pay statement at all." },
  short_pay:    { label: "Short pay",
    hint: "The technician was paid fewer hours than they actually turned on this job." },
  need_hours:   { label: "Need hours",
    hint: "The technician has run out of assigned work and is asking to be given more." },
  other:        { label: "Other",
    hint: "A general issue the technician wants their manager to know about." },
};

// Keep user-supplied strings short and single-line before they go into the prompt.
function clean(v: unknown, max = 200): string {
  return String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const kind    = KIND_TEXT[body.kind] ? body.kind : "other";
    const subject = clean(body.subject, 140);
    const ro      = clean(body.ro, 20);
    const date    = clean(body.date, 20);
    const hours   = Number(body.hours);
    const amount  = Number(body.amount);
    const notes   = clean(body.notes, 500);

    const hasHours  = Number.isFinite(hours) && hours > 0;
    const hasAmount = Number.isFinite(amount) && amount > 0;

    // Nothing concrete to write about — don't let the model invent facts to fill the gap.
    if (kind !== "need_hours" && !ro && !date && !hasHours && !hasAmount && !notes) {
      return new Response(
        JSON.stringify({ error: "Add an RO number, date, hours, or amount first — the draft needs at least one fact to work with." }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY not set");

    const k = KIND_TEXT[kind];
    const facts = [
      subject ? `Subject: ${subject}` : "",
      ro ? `RO number: ${ro}` : "",
      date ? `Work date: ${date}` : "",
      hasHours ? `Hours claimed: ${hours}` : "",
      hasAmount ? `Amount claimed: $${amount.toFixed(2)}` : "",
      notes ? `Technician's own notes: ${notes}` : "",
    ].filter(Boolean).join("\n");

    const prompt = `You write short, factual messages for auto technicians to send their service manager through a pay-tracking app. The technician already logged this work themselves; you are only turning their own facts into a professional message a manager will take seriously.

STRICT RULES:
- Use ONLY the facts listed below. Never invent an RO number, VIN, dollar amount, hour count, date, or name that isn't given.
- No emotion, no accusations, no blame language. Calm, plain, factual.
- 2-4 sentences. Plain text only — no markdown, no bullet points, no greeting, no sign-off.
- End with one clear, specific ask (e.g. "Requesting this be corrected on my next pay statement.").

Situation: ${k.label} — ${k.hint}
${facts || "(No specific job details were provided — keep this general and ask for the pay statement to be reviewed.)"}

Write only the message body, nothing else.`;

    const geminiBody = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 300,
        temperature: 0.4,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    // 502/504 (gateway errors) are just as transient as 503/429 for a
    // public API like Gemini's — retry all four instead of only 503/429.
    const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
    const RETRIES = 3;
    let geminiRes!: Response;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 1200));
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: geminiBody }
      );
      if (!RETRYABLE_STATUSES.has(geminiRes.status)) break;
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => "");
      let errMsg = errText;
      try { errMsg = JSON.parse(errText)?.error?.message || errText; } catch { /* use raw text */ }
      console.error("Gemini error", geminiRes.status, errText);
      return new Response(
        JSON.stringify({ error: `Gemini ${geminiRes.status}: ${errMsg}` }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const geminiData = await geminiRes.json();
    const parts = geminiData.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p: any) => p.text && !p.thought) || parts[0];
    let text = (textPart?.text || "").trim();
    // Strip stray markdown the model sometimes adds despite instructions.
    text = text.replace(/^["'*]+|["'*]+$/g, "").replace(/\*\*/g, "").trim();

    if (!text) {
      return new Response(JSON.stringify({ error: "Draft came back empty — try again." }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ text }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err?.message || err) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
