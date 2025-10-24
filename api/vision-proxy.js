export const config = { runtime: "edge" };

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "600"
  };
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders(),
    });
  }

  try {
    const body = await req.json();
    const imageBase64 = body?.imageBase64;
    const minConfidence = typeof body?.minConfidence === "number" ? body.minConfidence : 0.75;
    const model = body?.model || "gpt-4o-mini";

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "Missing imageBase64 in request body" }), {
        status: 400,
        headers: corsHeaders(),
      });
    }

    const prompt = `Tu es un expert en reconnaissance d'animaux.
Retourne UNIQUEMENT ce JSON strict :
{
  "animal": "chien|chat|inconnu",
  "breed": "string (vide si confiance < minConfidence)",
  "confidence": 0.0,
  "candidates": [{ "label": "string", "score": 0.0 }]
}
Règles :
- Identifie chien/chat/inconnu.
- Donne la race si confiance >= ${Math.round(minConfidence*100)}%, sinon breed="".
- Jusqu'à 3 candidats (label + score 0..1).
- AUCUN texte hors JSON.`;

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: [
              { type: "input_text", text: "Voici l'image à analyser :" },
              { type: "input_image", image_url: `data:image/jpeg;base64,${imageBase64}` },
            ],
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 800,
      }),
    });

    if (!openaiRes.ok) {
      const details = await openaiRes.text();
      return new Response(JSON.stringify({ error: "OpenAI API error", details }), {
        status: 502,
        headers: corsHeaders(),
      });
    }

    const openaiJson = await openaiRes.json();
    let content = openaiJson?.choices?.[0]?.message?.content || "{}";
    let result;
    try { result = typeof content === "string" ? JSON.parse(content) : content; }
    catch {
      return new Response(JSON.stringify({ error: "Invalid JSON from model" }), {
        status: 502,
        headers: corsHeaders(),
      });
    }

    const a = String(result.animal || "").toLowerCase();
    if (a.includes("dog") || a.includes("chien")) result.animal = "chien";
    else if (a.includes("cat") || a.includes("chat")) result.animal = "chat";
    else result.animal = "inconnu";

    if (typeof result.confidence === "number" && result.confidence < minConfidence) result.breed = "";

    const output = {
      animal: result.animal || "inconnu",
      breed: result.breed || "",
      confidence: typeof result.confidence === "number" ? result.confidence : 0,
      candidates: Array.isArray(result.candidates)
        ? result.candidates.slice(0, 3).map((c) => ({ label: c.label, score: Number(c.score) || 0 }))
        : [],
    };

    return new Response(JSON.stringify(output), { status: 200, headers: corsHeaders() });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: corsHeaders(),
    });
  }
}
