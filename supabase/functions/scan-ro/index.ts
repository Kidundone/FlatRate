import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { imageBase64, mediaType = "image/jpeg" } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "imageBase64 required" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY not set");

    const prompt = `You are scanning an automotive shop document — a Get Ready checklist or Repair Order from a car dealership. Extract these fields carefully.

── FIELDS ──

ro: Work order number. Labels: "WORKORDER", "RO#", "W/O". Usually 5-6 digits printed large (e.g. "492043"). Return null if absent.

stk: Stock number only — the alphanumeric code after labels "Stock", "STOCK #", "STK:", "SOLD-STK:". Examples: "A7127", "VXS13593", "DT253". Do NOT include the label word "STK" in the value. Return null if absent.

vin: Vehicle Identification Number. IMPORTANT rules:
  - A full VIN is EXACTLY 17 characters, only letters A-Z (never I, O, or Q) and digits 0-9
  - On Repair Orders it appears in the vehicle info table row under the "VIN" column header — read it character by character carefully
  - Common VIN starts: 1G, 2G, 3G (GM), 1F, 2F (Ford), 1C, 2C (Chrysler), 5J, JH, 19X (Honda/Acura), WBA, WBS (BMW), JN, 1N (Nissan), 4T, JT (Toyota/Lexus)
  - If you find a 17-char string matching this pattern, that IS the VIN — return it fully
  - On Get Ready sheets look near labels "VIN Verification" or "VIN (LAST 6)" for a 6-8 char partial
  - Return null only if truly nothing VIN-like exists

jobs: Array of work items. Rules:
  - INCLUDE: checked (✓/✗/filled box), circled items (circle drawn around text = highest priority, list first)
  - SKIP: strikethrough items (line through text = cancelled), empty boxes
  - Name mapping: "ACPDI"/"PDI"→"PDI", "ACNCIS"/"NCI"→"NCI", "ACND"/"REMOVE ALL PLASTICS/WASH & WAX"→"Remove plastics/wash wax", "RE-CLEAN FOR DELIVERY"→"Re-clean delivery", "FINANCE FPF"→"Finance FPF", "FPF"→"FPF", "PRE-OWNED DETAIL"→"Pre-owned detail", "AUCTION DETAIL"→"Auction detail", "OIL CHANGE"→"Oil change", "CERTIFIED INSPECTION"→"Cert inspection", "1-HOUR SAFETY CHECK"→"Safety check", "INAC NC SAFETY INSPECTION"→"Safety check", "5 HOUR RE-DIST CHECK"→"Re-dist check", "BID-LOT WASH & VACUUM"→"Lot wash", "SHOWROOM RE-CLEAN"→"Showroom re-clean"
  - For Repair Orders: each LINE OP (A, B, C…) with DESCRIPTIONS/INSTRUCTIONS text = one job entry (under 40 chars)
  - Return [] if nothing found

IGNORE: Handwritten 5-digit numbers in colored marker (tech reach numbers, not RO/VIN/STK).

Return ONLY this JSON, no markdown, no extra text:
{"ro": "492043", "vin": "5J8YE1H80TL041284", "stk": "A7127", "jobs": ["PDI", "Safety check", "Remove plastics/wash wax"]}`;

    const geminiBody = JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mediaType, data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    });

    const RETRIES = 3;
    let geminiRes!: Response;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, attempt * 1200));
      }
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: geminiBody }
      );
      // retry on 503 (overloaded) or 429 (rate limit)
      if (geminiRes.status !== 503 && geminiRes.status !== 429) break;
      console.warn(`Gemini ${geminiRes.status} on attempt ${attempt + 1}, retrying...`);
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => "");
      let errMsg = errText;
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson?.error?.message || errText;
      } catch { /* use raw text */ }
      console.error("Gemini error", geminiRes.status, errText);
      return new Response(
        JSON.stringify({ error: `Gemini ${geminiRes.status}: ${errMsg}` }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const geminiData = await geminiRes.json();
    // 2.5-flash has thinking mode — find the non-thought text part
    const parts = geminiData.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p: any) => p.text && !p.thought) || parts[0];
    const raw = textPart?.text?.trim() || "{}";

    let parsed: { ro?: string | null; vin?: string | null; stk?: string | null; jobs?: string[] } = {};
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      parsed = {};
    }

    return new Response(
      JSON.stringify({
        ro: parsed.ro || null,
        vin: parsed.vin || null,
        stk: parsed.stk || null,
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err?.message || err) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
