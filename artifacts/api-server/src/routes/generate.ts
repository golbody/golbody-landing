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

    const falRes = await fetch(FAL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${apiKey}`,
      },
      body: JSON.stringify({
        prompt,
        image_urls: [imageUrl],
      }),
    });

    const falData = await falRes.json() as Record<string, unknown>;
    logger.info({ status: falRes.status, data: JSON.stringify(falData).slice(0, 500) }, "fal raw response");

    if (!falRes.ok) {
      logger.error({ status: falRes.status, data: falData }, "fal API error");
      res.status(502).json({ error: "fal API error", details: falData });
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
