import { Router, type Request, type Response as ExpressResponse } from "express";
import { logger } from "../lib/logger";

const router = Router();

const FAL_URL = "https://fal.run/fal-ai/nano-banana-2/edit";

router.post("/generate", async (req: Request, res: ExpressResponse) => {
  try {
    const { imageUrl, prompt } = req.body;
    if (!imageUrl || !prompt) {
      res.status(400).json({ error: "Missing imageUrl or prompt" });
      return;
    }

    const apiKey = process.env["FAL_API_KEY"];
    if (!apiKey) {
      logger.error({}, "FAL_API_KEY not set");
      res.status(500).json({ error: "FAL_API_KEY not configured" });
      return;
    }

    const safePrompt = prompt
      .replace(/reduce\s+body\s+fat/gi, 'sculpt a more toned physique')
      .replace(/reduce\s+belly\s+fat/gi, 'tone the midsection')
      .replace(/reduce\s+fat/gi, 'tone and sculpt')
      .replace(/\bbody\s+fat\b/gi, 'silhouette')
      .replace(/\bbelly\s+fat\b/gi, 'midsection')
      .replace(/\bfat\b/gi, 'softness')
      .replace(/lose\s+weight/gi, 'get more toned')
      .replace(/weight\s+loss/gi, 'toning');

    const falRes = await fetch(FAL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${apiKey}`,
      },
      body: JSON.stringify({
        prompt: safePrompt,
        image_urls: [imageUrl],
      }),
    });

    const falData = await falRes.json() as Record<string, unknown>;
    logger.info({ status: falRes.status, promptLength: safePrompt.length, data: JSON.stringify(falData).slice(0, 500) }, "fal raw response");

    if (!falRes.ok) {
      const detail = (falData as any)?.detail?.[0];
      if (detail?.type === 'no_media_generated') {
        res.status(422).json({ error: 'Le modèle n\'a pas pu générer l\'image. Essayez un prompt différent.' });
      } else {
        res.status(502).json({ error: 'fal.ai API error', details: falData });
      }
      return;
    }

    const images = falData.images as Array<{ url: string }> | undefined;
    const outputImageUrl = images?.[0]?.url;
    if (!outputImageUrl) {
      logger.error({ images: JSON.stringify(images).slice(0, 500) }, "No image in fal response");
      res.status(502).json({ error: "No image returned by fal" });
      return;
    }

    res.json({ imageUrl: outputImageUrl });
  } catch (err) {
    logger.error({ err }, "Error in POST /api/generate");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
