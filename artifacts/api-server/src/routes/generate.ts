import { Router, type Request, type Response as ExpressResponse } from "express";
import { logger } from "../lib/logger";
import { fal } from "@fal-ai/client";

const router = Router();

const FAL_MODEL = "fal-ai/nano-banana-2/edit";

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

    const result = await fal.subscribe(FAL_MODEL, {
      input: {
        image_urls: [imageUrl],
        prompt: prompt,
      },
    });

    const images = (result.data as Record<string, unknown>)?.images as Array<{ url: string }> | undefined;
    const outputImageUrl = images?.[0]?.url;
    if (!outputImageUrl) {
      logger.error({ result: JSON.stringify(result).slice(0, 500) }, "No image in fal response");
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
