import { Router, type Request, type Response as ExpressResponse } from "express";
import { logger } from "../lib/logger";
import { fal } from "@fal-ai/client";

const router = Router();
const FAL_MODEL = "fal-ai/nano-banana-2/edit";

function safePrompt(prompt: string): string {
  return prompt.replace(/[<>]/g, "").trim().slice(0, 500);
}

router.post("/generate", async (req: Request, res: ExpressResponse) => {
  try {
    const { imageUrl, prompt } = req.body;
    if (!imageUrl || !prompt) {
      res.status(400).json({ error: "Missing imageUrl or prompt" });
      return;
    }
    const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      res.status(400).json({ error: "Invalid image format" });
      return;
    }
    const mimeType = matches[1];
    const base64Data = matches[2];
    const apiKey = process.env["FAL_API_KEY"];
    if (!apiKey) {
      res.status(500).json({ error: "FAL_API_KEY is not configured" });
      return;
    }
    fal.config({ credentials: apiKey });
    const imageBuffer = Buffer.from(base64Data, "base64");
    const blob = new Blob([imageBuffer], { type: mimeType });
    const falImageUrl = await fal.storage.upload(blob);
    logger.info({ falImageUrl }, "Image uploaded to FAL storage");
    const sanitizedPrompt = safePrompt(prompt);
    const result = await fal.subscribe(FAL_MODEL, {
      input: { image_urls: [falImageUrl], prompt: sanitizedPrompt },
    });
    const data = result.data as Record<string, unknown>;
    const images = (data.images || data.image) as Array<{ url: string }> | { url: string } | undefined;
    let resultImageUrl: string | undefined;
    if (Array.isArray(images) && images[0]?.url) {
      resultImageUrl = images[0].url;
    } else if (images && typeof images === "object" && "url" in images) {
      resultImageUrl = (images as { url: string }).url;
    }
    if (!resultImageUrl) {
      res.status(502).json({ error: "No image returned by FAL" });
      return;
    }
    res.json({ imageUrl: resultImageUrl });
  } catch (err) {
    logger.error({ err }, "Error in POST /api/generate");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;




