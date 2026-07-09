import { Router, type Request, type Response as ExpressResponse } from "express";
import { logger } from "../lib/logger";

const router = Router();

// gemini-2.5-flash added native image generation support.
// API version v1beta is the correct endpoint for image output on this model.
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_VERSION = "v1beta";

// Synchronous image generation via Gemini REST API
router.post("/generate", async (req: Request, res: ExpressResponse) => {
  try {
    const { imageUrl, prompt } = req.body;
    if (!imageUrl || !prompt) {
      res.status(400).json({ error: "Missing imageUrl or prompt" });
      return;
    }

    // Convert base64 data URI to inline image part
    const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      res.status(400).json({ error: "Invalid image format" });
      return;
    }
    const mimeType = matches[1];
    const base64Data = matches[2];

    const apiKey = process.env["GEMINI_API_KEY"];
    const geminiUrl = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: base64Data } },
            { text: prompt }
          ]
        }],
        generationConfig: {
          responseModalities: ["image", "text"]
        }
      })
    });

    const geminiData = await geminiRes.json() as Record<string, unknown>;
    logger.info({ status: geminiRes.status, data: JSON.stringify(geminiData).slice(0, 500) }, "Gemini raw response");

    if (!geminiRes.ok) {
      logger.error({ status: geminiRes.status, data: geminiData }, "Gemini API error");
      res.status(502).json({ error: "Gemini API error", details: geminiData });
      return;
    }

    const candidates = geminiData.candidates as Array<{ content: { parts: Array<{ inlineData?: { data: string; mimeType: string }; text?: string }> } }>;
    const imagePart = candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!imagePart?.inlineData?.data) {
      logger.error({ candidates: JSON.stringify(candidates).slice(0, 500) }, "No image in Gemini response");
      res.status(502).json({ error: "No image returned by Gemini" });
      return;
    }

    const resultDataUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
    res.json({ imageUrl: resultDataUrl });
  } catch (err) {
    logger.error({ err }, "Error in POST /api/generate");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
