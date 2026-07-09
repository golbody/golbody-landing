import { Router, type Request, type Response as ExpressResponse } from "express";
import { GoogleGenAI } from "@google/genai";
import { logger } from "../lib/logger";

const router = Router();
const GEMINI_API_KEY = process.env["GEMINI_API_KEY"];
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// Synchronous image generation via Gemini
router.post("/generate", async (req: Request, res: ExpressResponse) => {
  try {
    const { imageUrl, prompt } = req.body;
    if (!imageUrl || !prompt) {
      res.status(400).json({ error: "Missing imageUrl or prompt" });
      return;
    }
    if (!ai) {
      res.status(500).json({ error: "Server configuration error" });
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

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-preview-image-generation",
      contents: [{
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          { text: prompt }
        ]
      }],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
      }
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (!part?.inlineData?.data) {
      res.status(502).json({ error: "No image returned by Gemini" });
      return;
    }

    const resultBase64 = part.inlineData.data;
    const resultMime = part.inlineData.mimeType || "image/png";
    const resultDataUrl = `data:${resultMime};base64,${resultBase64}`;

    res.json({ imageUrl: resultDataUrl });
  } catch (err) {
    logger.error({ err }, "Error in POST /api/generate");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
