// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts"

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-TBYC-KEY",
  };
}

function extractOutputText(data: any): string | null {
  if (typeof data?.output_text === "string") return data.output_text;

  const output = data?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const line of content) {
          if (typeof line?.text === "string") return line.text;
        }
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "*";

  // handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders(origin),
    });
  }

  // --- default response --- //
  // let responseText = "Hello from Supabase Functions!";

  const expectedProxyKey = Deno.env.get("TBYC_PROXY_KEY");
  if (expectedProxyKey) {
    const provided = req.headers.get("X-TBYC-KEY");
    if (!provided || provided !== expectedProxyKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
          ...corsHeaders(origin), 
          "Content-Type": "application/json" 
        },
      });
    }
  }

  const AI_API_KEY = Deno.env.get("AI_API_KEY");

  if (!AI_API_KEY) {
    return new Response(JSON.stringify({ error: "Missing AI_API_KEY secret" }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const url = body?.url;
  const heuristic = body?.heuristic ?? {};
  const mode = body?.mode ?? "borderline"; // "borderline" | "ask_ai"

  if (!url || typeof url !== "string") {
    return new Response(JSON.stringify({ error: "Missing 'url' string" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const responseJsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      aiRiskLevel: { 
        type: "string",
        enum: ["SAFE", "WARNING", "HIGH_RISK"]
      },
      confidence : { 
        type: "number", 
        minimum: 0, maximum: 1 
      },
      reasons : {
        type: "array",
        items: { type: "string" },
      },
      recommendedAction : {
        type: "string",
        enum: ["PROCEED", "CAUTION", "AVOID"],
      }
    },
    required: ["aiRiskLevel", "confidence", "reasons"],
  };

  // const preview = heuristic.contentPreview ? 
  //   heuristic.contentPreview : heuristic.selectionPreview ?
  //   heuristic.selectionPreview : 
  //   null;

  const systemPrompt = `
  You are a phishing-risk classifier used in a browser security extension.

  Your job is to classify the phishing risk of a URL using heuristic signals detected by the extension.

  IMPORTANT RULES:

  1. You MUST treat heuristic signals as strong evidence of phishing intent.
  2. If the signals contain phrases related to credentials, financial information, or account verification, the result should be at least WARNING.
  3. If multiple phishing indicators appear together, the result should be HIGH_RISK.
  4. Do NOT assume the site is safe just because the domain looks legitimate.
  5. Do NOT claim you visited the site or fetched it. You only reason about the signals provided.

  Common phishing signals include:
  - requests for credentials (password, login credentials)
  - requests for financial information (credit card, bank account)
  - urgent warnings ("verify your account", "security alert", "suspended")
  - instructions to click links or update information

  Classification guidelines:

  SAFE
  - No phishing indicators
  - Informational or neutral content

  WARNING
  - At least one phishing-related signal
  - Language requesting credentials or financial data

  HIGH_RISK
  - Multiple phishing indicators
  - Urgency + credentials request
  - Account verification or payment request

  Example reasoning:

  Heuristic signals:
  ["Suspicious phrase detected: credit card"]

  Result:
  WARNING
  Reason:
  "The page references credit card information, which is commonly used in phishing attempts to obtain financial data."

  Now analyze the following input.

  URL: ${url}

  Heuristic signals:
  ${JSON.stringify(heuristic)}

  ${heuristic.preview ? "Page text preview:\n" + heuristic.preview : ""}

  Return ONLY a JSON object matching the provided schema.
  Reasons should be concise explanations based on the signals.
  `;

  // --- call GEMINI API --- //
  const model = "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": AI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{ text: systemPrompt}]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema,
        temperature: 0.2,
      }
    }),
  })

  if (!response.ok) {
    const details = await response.text();
    return new Response(JSON.stringify({ error: "AI API error", details }), {
      status: 502,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  const data = await response.json();

  // extract the JSON string from the first candidate
  const outputText = 
    data?.candidates?.[0]?.content?.parts?.[0]?.text ??
    data?.candidates?.[0]?.content?.parts?.[0]?.inlineData ??
    null;

  if (!outputText || typeof outputText !== "string") {
    return new Response(JSON.stringify({ error: "No text returned from Gemini", raw: data }), {
    status: 502,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // --- parse the output text as JSON --- //
  let parsed: any;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    return new Response(JSON.stringify({ error: "Gemini returned non-JSON", raw: outputText }), {
      status: 502,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  // end
  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/ai-assess' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
