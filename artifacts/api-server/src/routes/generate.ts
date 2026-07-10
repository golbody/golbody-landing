import { Router, type Request, type Response as ExpressResponse } from "express";
import { logger } from "../lib/logger";

const router = Router();

const FAL_MODEL = "fal-ai/nano-banana-2/edit";
const FAL_URL = `https://fal.run/${FAL_MODEL}`;

function safePrompt(prompt: string): string {
  return prompt
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 500);
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
      logger.error("FAL_API_KEY is not set");
      res.status(500).json({ error: "FAL_API_KEY is not configured" });
      return;
    }

    // Step 1: Upload image to FAL storage to get a real HTTPS URL
    const imageBuffer = Buffer.from(base64Data, "base64");
    const formData = new FormData();
    const imageBlob = new Blob([imageBuffer], { type: mimeType });
    formData.append("file", imageBlob, "upload.jpg");

    const uploadRes = await fetch("https://storage.fal.ai/upload", {
      method: "POST",
      headers: { Authorization: `Key ${apiKey}` },
      body: formData,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      logger.error({ status: uploadRes.status, err: errText }, "FAL storage upload failed");
      res.status(502).json({ error: "Image upload to FAL storage failed" });
      return;
    }

    const { url: falImageUrl } = await uploadRes.json() as { url: string };
    logger.info({ falImageUrl }, "Image uploaded to FAL storage");

    // Step 2: Call model with the uploaded URL
    const sanitizedPrompt = safePrompt(prompt);

    const falRes = await fetch(FAL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({
        image_urls: [falImageUrl],
        prompt: sanitizedPrompt,
      }),
    });

    const falData = await falRes.json() as Record<string, unknown>;
    logger.info(
      { status: falRes.status, data: JSON.stringify(falData).slice(0, 500) },
      "FAL raw response"
    );

    if (!falRes.ok) {
      logger.error({ status: falRes.status, data: falData }, "FAL API error");
      res.status(502).json({ error: "FAL API error", details: falData });
      return;
    }

    const images = (falData.images || falData.image) as
      | Array<{ url: string }>
      | { url: string }
      | undefined;

    let resultImageUrl: string | undefined;
    if (Array.isArray(images) && images[0]?.url) {
      resultImageUrl = images[0].url;
    } else if (images && typeof images === "object" && "url" in images) {
      resultImageUrl = (images as { url: string }).url;
    }

    if (!resultImageUrl) {
      logger.error({ data: JSON.stringify(falData).slice(0, 500) }, "No image in FAL response");
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
