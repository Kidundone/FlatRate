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

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: imageBase64 },
              },
              {
                type: "text",
                text: `You are reading an automotive dealership document from Flow Motors Winston Salem. It may be handwritten or printed. Read carefully.

STEP 1 — Identify the document type:

A) REPAIR ORDER — printed form with "WORKORDER" or "Work Order" or "R.O." at the top, usually has a customer address, VIN bar, line items with labor codes. The RO number is the large number printed at the top (e.g. "490060").

B) GET READY / PRE-OWNED GET READY — titled "Get Ready", "Pre-Owned Get Ready", "New-Preowned Get Ready", or "Detail Sheet". These have a Stock # and VIN field but NO repair order number.

STEP 2 — Extract these three values:

1. ro — the Repair Order / Work Order number.
   - For REPAIR ORDER docs: this is the large number labeled "WORKORDER" or printed prominently at top (e.g. 490060). Return it as a string.
   - For GET READY docs: set to null. Get Ready slips do not have RO numbers.
   - IGNORE any large handwritten numbers written in marker on the page — those are internal reach/tech numbers, NOT the RO.

2. stk — the Stock number, labeled "STOCK #", "STK#", "Stock", or "Stock No". Usually alphanumeric like "SXS14394A" or "VXS13593" or "S6934". Return it as a string or null.

3. vin — a full 17-character VIN, OR whatever appears next to a label that says "VIN", "VIN (LAST 6)", "VIN Verification", or "VIN#". May be partial (last 6-8 chars). Return it as a string or null.

Return ONLY this JSON, nothing else:
{"ro": null, "vin": "TCS19634", "stk": "VXS13593"}

Use null for any value not clearly labeled. Never guess unlabeled numbers.`,
              },
            ],
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text().catch(() => "");
      console.error("Claude error", claudeRes.status, errText);
      return new Response(
        JSON.stringify({ error: `Claude ${claudeRes.status}: ${errText}` }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.[0]?.text?.trim() || "{}";

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
