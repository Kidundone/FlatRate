import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ITEMS = 80;

function clean(v: unknown, max = 140): string {
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
    const rawItems = Array.isArray(body.items) ? body.items : [];

    // De-dupe + clean, cap the list so the prompt (and cost) stay bounded.
    const seen = new Set<string>();
    const items: { name: string; count: number }[] = [];
    for (const it of rawItems) {
      const name = clean(it?.name, 140);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const count = Math.max(1, Math.round(Number(it?.count) || 1));
      items.push({ name, count });
      if (items.length >= MAX_ITEMS) break;
    }

    if (items.length < 2) {
      return new Response(JSON.stringify({ groups: [] }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY not set");

    const list = items.map(it => `- "${it.name}" (logged ${it.count}× )`).join("\n");

    const prompt = `You are cleaning up job type labels logged by an auto shop technician. The same job often gets typed inconsistently — abbreviations, misspellings, spelled-out vs. shorthand, punctuation. Your job: find labels in the list below that clearly describe the SAME real job, and group them under one short canonical name.

RULES:
- Only group items you're confident describe the same task. When unsure, leave it out of every group — a missed grouping is fine, a wrong one isn't.
- Never invent a label that isn't in the list below — every "variants" entry must be copied EXACTLY (verbatim, same case) from the list.
- A group needs at least 2 variants. Don't output single-item groups.
- Pick a short, clean canonical name (title case, no punctuation soup) — prefer the clearest/most common spelling already in the list, or a standard short form (e.g. "PDI", "Pre-Owned", "Dealer Trade").
- Don't group items that are merely similar-sounding but different jobs (e.g. "Oil Change" and "Oil Filter" are NOT the same job — leave separate).
- Items with no clear match to anything else should simply not appear in any group.

Job type labels logged by this tech:
${list}

Return ONLY this JSON shape, no markdown, no extra text:
{"groups": [{"canonical": "PDI", "variants": ["P.D.I.", "pre delivery insp"]}]}`;

    const geminiBody = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const RETRIES = 3;
    let geminiRes!: Response;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 1200));
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: geminiBody }
      );
      if (geminiRes.status !== 503 && geminiRes.status !== 429) break;
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
    const raw = textPart?.text?.trim() || "{}";

    let parsed: { groups?: { canonical?: string; variants?: string[] }[] } = {};
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      parsed = {};
    }

    // Trust nothing the model returns that isn't literally an item we sent it —
    // this is the guard against invented/hallucinated variant strings.
    const validNames = new Set(items.map(it => it.name));
    const groups = (Array.isArray(parsed.groups) ? parsed.groups : [])
      .map(g => {
        const canonical = clean(g?.canonical, 60);
        const variants = Array.isArray(g?.variants)
          ? [...new Set(g.variants.map(v => clean(v, 140)))].filter(v => validNames.has(v))
          : [];
        return { canonical, variants };
      })
      .filter(g => g.canonical && g.variants.length >= 2);

    return new Response(JSON.stringify({ groups }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err?.message || err) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
