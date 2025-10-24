export const config = {
  runtime: "edge"
};

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
  // Gestion OPTIONS pour CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders()
    });
  }

  // Seul POST est accepté
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders()
    });
  }

  try {
    const body = await req.json();
    const imageBase64 = body?.imageBase64;
    const minConfidence = typeof body?.minConfidence === "number" ? body.minConfidence : 0.75;
    const model = body?.model || "gpt-4o-mini";

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "Missing imageBase64" }), {
        status: 400,
        headers: corsHeaders()
      });
    }

    // Prompt pour OpenAI - VERSION CORRIGÉE
    const prompt = `Tu es un expert vétérinaire en reconnaissance de races d'animaux.

Analyse cette image et retourne UNIQUEMENT un JSON valide avec cette structure exacte :
{
  "animal": "chien ou chat ou inconnu",
  "breed": "nom précis de la race en français (ex: Golden Retriever, Berger Allemand, Siamois...)",
  "confidence": 0.95,
  "candidates": [
    { "label": "Golden Retriever", "score": 0.95 },
    { "label": "Labrador Retriever", "score": 0.85 }
  ]
}

RÈGLES IMPORTANTES :
- Si c'est un chien, mets "chien" dans animal et identifie la race précise
- Si c'est un chat, mets "chat" dans animal et identifie la race précise
- Si pas d'animal ou impossible à identifier, mets "inconnu"
- confidence = ton niveau de certitude entre 0 et 1
- candidates = liste des 2-3 races les plus probables avec leur score
- Si confidence < ${minConfidence}, laisse breed vide ""
- Réponds UNIQUEMENT avec le JSON, aucun texte avant ou après`;

    // Appel à OpenAI Vision
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: prompt
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Voici l'image à analyser :"
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`
                }
              }
            ]
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 800
      })
    });

    if (!openaiRes.ok) {
      const details = await openaiRes.text();
      return new Response(JSON.stringify({ error: "OpenAI API error", details }), {
        status: 502,
        headers: corsHeaders()
      });
    }

    const openaiJson = await openaiRes.json();
    const content = openaiJson?.choices?.[0]?.message?.content || "{}";
    const result = JSON.parse(content);

    // Normalisation de l'animal
    const a = String(result.animal || "").toLowerCase();
    if (a.includes("dog") || a.includes("chien")) result.animal = "chien";
    else if (a.includes("cat") || a.includes("chat")) result.animal = "chat";
    else result.animal = "inconnu";

    // Si confiance trop faible, vider la race
    if (result.confidence < minConfidence) result.breed = "";

    const output = {
      animal: result.animal || "inconnu",
      breed: result.breed || "",
      confidence: result.confidence || 0,
      candidates: Array.isArray(result.candidates) ? result.candidates.slice(0, 3) : []
    };

    return new Response(JSON.stringify(output), {
      status: 200,
      headers: corsHeaders()
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsHeaders()
    });
  }
}
