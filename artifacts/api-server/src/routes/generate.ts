import { Router, type Request, type Response as ExpressResponse } from "express";
import { logger } from "../lib/logger";

const router = Router();

const FAL_API_KEY = process.env["FAL_API_KEY"];
const FAL_ENDPOINT = "https://fal.run/fal-ai/flux-pro/kontext";

router.post("/generate", async (req: Request, res: ExpressResponse) => {
  try {
    const { imageUrl, prompt } = req.body;

    if (!imageUrl || !prompt) {
      res.status(400).json({ error: "Missing imageUrl or prompt" });
      return;
    }

    if (!FAL_API_KEY) {
      logger.error("FAL_API_KEY is not configured");
      res.status(500).json({ error: "Server configuration error" });
      return;
    }

    logger.info({ imageUrlLength: imageUrl.length, promptLength: prompt.length }, "Calling fal.ai");

    const falRes = await fetch(FAL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${FAL_API_KEY}`,
      },
      body: JSON.stringify({
        prompt,
        image_url: imageUrl,
      }),
    });

    if (!falRes.ok) {
      const text = await falRes.text();
      logger.error({ status: falRes.status, body: text }, "fal.ai error");
      res.status(502).json({ error: "fal.ai returned an error" });
      return;
    }

    const falData = (await falRes.json()) as Record<string, unknown>;
    logger.info({ keys: Object.keys(falData) }, "fal.ai response received");

    // Normalize response to extract image URL
    let imageResultUrl: string | null = null;
    if (falData.images && Array.isArray(falData.images) && falData.images[0]) {
      const first = falData.images[0] as Record<string, unknown> | string;
      imageResultUrl = typeof first === "string" ? first : (first.url as string) || null;
    } else if (falData.image) {
      const img = falData.image as Record<string, unknown> | string;
      imageResultUrl = typeof img === "string" ? img : (img.url as string) || null;
    } else if (
      falData.output &&
      typeof falData.output === "object" &&
      Array.isArray((falData.output as Record<string, unknown>).images)
    ) {
      const images = (falData.output as Record<string, unknown>).images as unknown[];
      const first = images[0] as Record<string, unknown> | string;
      imageResultUrl = typeof first === "string" ? first : (first.url as string) || null;
    } else if (typeof falData.url === "string") {
      imageResultUrl = falData.url;
    } else if (
      falData.data &&
      typeof falData.data === "object" &&
      Array.isArray((falData.data as Record<string, unknown>).images)
    ) {
      const images = (falData.data as Record<string, unknown>).images as unknown[];
      const first = images[0] as Record<string, unknown> | string;
      imageResultUrl = typeof first === "string" ? first : (first.url as string) || null;
    }

    if (!imageResultUrl) {
      logger.error({ falData }, "No image URL found in fal.ai response");
      res.status(502).json({ error: "No image returned by generation API" });
      return;
    }

    res.json({ imageUrl: imageResultUrl });
  } catch (err) {
    logger.error({ err }, "Error in /api/generate");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
