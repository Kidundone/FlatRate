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
    const { imageBase64, mediaType = "image/jpeg", mode = "auto" } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "imageBase64 required" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    let prompt: string;
    let maxTokens: number;

    if (mode === "payroll_report") {
      maxTokens = 4096;
      prompt = `This is a Technician Payroll Report from a car dealership showing booked repair orders (ROs).

Extract every line item row. For dates in format like "12AUG26", convert to ISO format "2026-08-12".

Return ONLY valid JSON, no other text:
{
  "type": "payroll_report",
  "techId": "tech ID/name or null",
  "period": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "rows": [
    {
      "ro": "RO number as string",
      "closedDate": "YYYY-MM-DD",
      "soldHours": 4.00,
      "laborCost": 60.00,
      "opCode": "DETAILPOC",
      "description": "FULL DETAIL O"
    }
  ],
  "totalSoldHours": 59.20,
  "totalLaborCost": 888.00
}

Include ALL rows even if soldHours is 0. Each sub-line under the same RO is a separate row object.
Use the CLOSED DATE column (not booked date) as closedDate.`;
    } else {
      maxTokens = 512;
      prompt = `This is a paycheck, pay stub, or payroll document image.

First, determine the document type:
- If it's a "TECHNICIAN PAYROLL REPORT" or "Booked Repair Orders" report listing individual RO numbers, return: {"type":"payroll_report","needsPayrollMode":true}
- Otherwise, extract the gross pay amount — the total earnings before deductions. Look for: "Gross Pay", "Gross Earnings", "Total Gross", "Gross Wages", "Current Gross". Do NOT return net pay or deductions.

Return ONLY JSON:
{"gross": 1234.56}
or
{"type":"payroll_report","needsPayrollMode":true}

Use {"gross": null} if you cannot find gross pay.`;
    }

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: imageBase64 },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API error: ${claudeRes.status} ${errText}`);
    }

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.[0]?.text?.trim() || "{}";

    let parsed: Record<string, unknown> = {};
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      parsed = {};
    }

    if (parsed.type === "payroll_report") {
      return new Response(JSON.stringify(parsed), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Standard paycheck response
    const gross = parsed.gross != null && Number.isFinite(Number(parsed.gross)) && Number(parsed.gross) > 0
      ? round2(Number(parsed.gross))
      : null;

    return new Response(
      JSON.stringify({ gross }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String((err as Error)?.message || err) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
