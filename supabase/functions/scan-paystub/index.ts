import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// This function used to call Anthropic while every other function in the
// project (scan-ro, cluster-job-types, draft-dispute) called Gemini. That split
// meant one empty balance took out pay-stub and payroll-report scanning while
// the rest of the app carried on working — a confusing failure, and a second
// bill to keep topped up. Now everything runs on one provider and one key.
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

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY not set");

    let prompt: string;
    let maxTokens: number;

    if (mode === "payroll_report") {
      maxTokens = 8192;
      prompt = `This is a Technician Payroll Report from a car dealership — a "Report of Booked Repair Orders".

Read EVERY line item row. Each row has: RO number, booked date, closed date, tech number, a SOLD HOURS figure and a LABOR COST figure, then an op-code and description.

Important:
- The same RO number can appear on several consecutive rows (one per line/op). Each is its own row object.
- Two decimal columns appear before the cost: ACTUAL HOURS (usually 0.00) then SOLD HOURS. Use SOLD HOURS.
- Convert dates like "12AUG26" to "2026-08-12".
- Read digits carefully; RO numbers are 6 digits.

Return ONLY valid JSON, no markdown:
{
  "type": "payroll_report",
  "period": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "rows": [
    { "ro": "496740", "closedDate": "2026-08-12", "soldHours": 4.00, "laborCost": 60.00, "opCode": "DETAILPOC", "description": "FULL DETAIL O" }
  ],
  "totalSoldHours": 59.20,
  "totalLaborCost": 888.00
}

totalSoldHours and totalLaborCost must be the grand totals printed at the bottom of the report — copy them exactly as printed, do not compute them yourself.`;
    } else {
      maxTokens = 512;
      prompt = `This is a paycheck, pay stub, or payroll document image.

First determine the document type:
- If it is a "TECHNICIAN PAYROLL REPORT" or "Report of Booked Repair Orders" listing individual RO numbers, return exactly: {"type":"payroll_report","needsPayrollMode":true}
- Otherwise extract the GROSS pay — total earnings before deductions. Look for "Gross Pay", "Gross Earnings", "Total Gross", "Gross Wages", "Current Gross". Never return net pay or a deduction.

Return ONLY JSON, no markdown:
{"gross": 1234.56}
or
{"type":"payroll_report","needsPayrollMode":true}

Use {"gross": null} if gross pay is not visible.`;
    }

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
        maxOutputTokens: maxTokens,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    // Same retry policy as scan-ro: 429/502/503/504 are all transient for a
    // public API and shouldn't surface as a hard failure on the first hiccup.
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
      console.warn(`Gemini ${geminiRes.status} on attempt ${attempt + 1}, retrying...`);
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => "");
      let errMsg = errText;
      try {
        errMsg = JSON.parse(errText)?.error?.message || errText;
      } catch { /* use raw text */ }
      console.error("Gemini error", geminiRes.status, errText);
      return new Response(
        JSON.stringify({ error: `Gemini ${geminiRes.status}: ${errMsg}` }),
        { status: 502, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const geminiData = await geminiRes.json();
    // 2.5-flash can emit a "thought" part — take the first real text part.
    const parts = geminiData.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p: any) => p.text && !p.thought) || parts[0];
    const raw = textPart?.text?.trim() || "{}";

    let parsed: Record<string, any> = {};
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      parsed = {};
    }

    if (parsed.type === "payroll_report") {
      // Normalize rows so the client never has to guess at field shapes.
      const rows = Array.isArray(parsed.rows)
        ? parsed.rows
            .map((r: any) => ({
              ro: String(r?.ro ?? "").trim(),
              closedDate: String(r?.closedDate ?? r?.bookedDate ?? "").trim(),
              bookedDate: String(r?.bookedDate ?? r?.closedDate ?? "").trim(),
              soldHours: num(r?.soldHours),
              laborCost: num(r?.laborCost),
              opCode: String(r?.opCode ?? "").trim(),
              description: String(r?.description ?? "").trim(),
            }))
            .filter((r: any) => r.ro)
        : [];

      return new Response(
        JSON.stringify({
          type: "payroll_report",
          needsPayrollMode: parsed.needsPayrollMode === true && !rows.length,
          period: parsed.period ?? null,
          rows,
          totalSoldHours: num(parsed.totalSoldHours),
          totalLaborCost: num(parsed.totalLaborCost),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const g = num(parsed.gross);
    return new Response(
      JSON.stringify({ gross: g > 0 ? g : null }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String((err as Error)?.message || err) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
