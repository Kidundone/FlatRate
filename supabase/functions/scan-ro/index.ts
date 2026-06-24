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

    const prompt = `You are reading a Flow Motors Winston Salem automotive document. Extract data precisely.

THERE ARE 3 DOCUMENT TYPES:

TYPE A — HANDWRITTEN GET READY (yellow paper):
- Header says "Flow Motors Winston Salem / New- Preowned Get Ready"
- Handwritten fields: "Stock" (e.g. "VXS13593"), "VIN Verification" (e.g. "TCS19634")
- NO repair order number on this form

TYPE B — PRINTED GET READY (white paper with checkboxes):
- Header says "FLOW MOTORS WINSTON SALEM / NEW - PRE-OWNED GET READY" or "NEW/PRE-OWNED GET READY"
- Printed fields: "STOCK #" (e.g. "SXS14394A", "DT253"), "VIN (LAST 6)" (e.g. "D53269", "169625")
- NO repair order number on this form

TYPE C — REPAIR ORDER (printed, multi-copy):
- Header: "FLOW MOTORS OF WINSTON-SALEM" with large number next to "WORKORDER" (e.g. "490060")
- Full 17-char VIN in vehicle bar (e.g. "4S4WMAJD6K3441392")
- Stock may appear in options line as "SOLD-STK:S6934"

CRITICAL — IGNORE THE TECH NUMBER:
- Every form has a large 5-digit handwritten number in blue/green marker (e.g. "10537", "10534")
- This is the technician reach number — NOT the RO, stock, or VIN — IGNORE IT

READING HANDWRITTEN MARKS ON CHECKBOXES (Get Ready forms):
- CIRCLED item = top priority work — list it FIRST in job output
- CHECKED box (✓ or ✗ checkmark inside box) = work to be done — list after circled items
- STRIKETHROUGH on text (a line drawn through the words) = cancelled/not happening — SKIP IT completely
- Empty unchecked box = not happening — SKIP IT
- An item can be both circled AND checked — still list it first

EXTRACT:
1. ro — Only from Type C near "WORKORDER". Null for Types A and B.
2. stk — From "Stock", "STOCK #", or "SOLD-STK:" field. Examples: "VXS13593", "SXS14394A", "S6934", "DT253"
3. vin — From "VIN Verification", "VIN (LAST 6)", or VIN bar. 6–17 chars. Examples: "TCS19634", "D53269", "4S4WMAJD6K3441392"
4. job — Work to be done, built from circled and checked items only (never strikethrough, never unchecked):
   - Type A/B Get Ready: identify circled items first, then checked items. Map names: "RE-CLEAN FOR DELIVERY" → "Re-clean delivery", "FINANCE FPF" → "Finance FPF", "FPF" → "FPF", "DT-FPF" → "DT-FPF", "PRE-OWNED DETAIL" → "Pre-owned detail", "AUCTION DETAIL" → "Auction detail", "PDI" → "PDI", "REPDI" → "REPDI", "NCI" → "NCI", "OIL CHANGE" → "Oil change", "CERTIFIED INSPECTION" → "Cert inspection", "1-HOUR SAFETY CHECK" → "Safety check", "5 HOUR RE-DIST CHECK" → "Re-dist check", "ACCESSORIES" → "Accessories", "BID-LOT WASH & VACUUM" → "Lot wash", "SHOWROOM RE-CLEAN" → "Showroom re-clean", "MICS. RE-CLEAN" → "Misc re-clean", "AUCTION RE-CLEAN" → "Auction re-clean". Join all with " + ". If none found, return null.
   - Type C Repair Order: use DESCRIPTIONS/INSTRUCTIONS text from Line A. Keep under 40 chars. If unreadable, return null.

Return ONLY this JSON, nothing else:
{"ro": null, "vin": "TCS19634", "stk": "VXS13593", "job": "Re-clean delivery + Finance FPF"}`;

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
        thinkingConfig: { thinkingBudget: 0 },
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

    let parsed: { ro?: string | null; vin?: string | null; stk?: string | null } = {};
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
        job: parsed.job || null,
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
