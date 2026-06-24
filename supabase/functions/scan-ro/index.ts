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

    const prompt = `You are scanning an automotive shop document — a Get Ready checklist or Repair Order from a car dealership. Extract the following fields. Be liberal: if something looks like it could be a stock number, RO number, or VIN, include it.

── FIELDS TO EXTRACT ──

ro: A repair/work order number. Look for labels like "WORKORDER", "RO#", "W/O", "ORDER NO", or a large printed number near those labels. Usually 5-6 digits (e.g. "490060"). Return null if not found.

stk: A stock number. Look for "Stock", "STOCK #", "STK", "SOLD-STK:" labels. Often alphanumeric like "VXS13593", "SXS14394A", "DT253", "S6934". Return null if not found.

vin: A VIN or partial VIN. Look for "VIN", "VIN Verification", "VIN (LAST 6)", or a 17-char alphanumeric string in a vehicle info bar. Can be 6–17 chars. Return null if not found.

jobs: An array of work items to be performed. Rules:
  - INCLUDE: items with a ✓, ✗, checkmark, or filled square; items with a hand-drawn circle/oval around the label (highest priority — list first)
  - SKIP: items with a line crossed THROUGH the text (strikethrough = cancelled); empty unchecked boxes
  - Map common names: "RE-CLEAN FOR DELIVERY"→"Re-clean delivery", "FINANCE FPF"→"Finance FPF", "FPF"→"FPF", "DT-FPF"→"DT-FPF", "PRE-OWNED DETAIL"→"Pre-owned detail", "AUCTION DETAIL"→"Auction detail", "PDI"→"PDI", "REPDI"→"REPDI", "NCI"→"NCI", "OIL CHANGE"→"Oil change", "CERTIFIED INSPECTION"→"Cert inspection", "1-HOUR SAFETY CHECK"→"Safety check", "5 HOUR RE-DIST CHECK"→"Re-dist check", "ACCESSORIES"→"Accessories", "BID-LOT WASH & VACUUM"→"Lot wash", "SHOWROOM RE-CLEAN"→"Showroom re-clean", "MICS. RE-CLEAN"→"Misc re-clean", "AUCTION RE-CLEAN"→"Auction re-clean", "REMOVE ALL PLASTICS"→"Remove plastics/wash wax", "WASH"→"Wash & wax"
  - For Repair Orders: extract each op-line description (keep under 40 chars each)
  - Return [] if no marked items found

IGNORE: Large handwritten 5-digit numbers in colored marker — those are technician reach numbers, not RO/STK/VIN.

Return ONLY valid JSON, no markdown, no explanation:
{"ro": null, "vin": "TCS19634", "stk": "VXS13593", "jobs": ["Re-clean delivery", "Finance FPF"]}`;

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
      },
    });

    const RETRIES = 3;
    let geminiRes!: Response;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, attempt * 1200));
      }
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
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
