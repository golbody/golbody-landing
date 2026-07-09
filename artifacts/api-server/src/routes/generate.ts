import { Router, type Request, type Response as ExpressResponse } from "express";
import { logger } from "../lib/logger";

const router = Router();

const FAL_API_KEY = process.env["FAL_API_KEY"];
const FAL_QUEUE_SUBMIT = "https://queue.fal.run/fal-ai/flux-pro/kontext";
const FAL_QUEUE_STATUS = (id: string) =>
  `https://queue.fal.run/fal-ai/flux-pro/kontext/requests/${id}/status`;
const FAL_QUEUE_RESULT = (id: string) =>
  `https://queue.fal.run/fal-ai/flux-pro/kontext/requests/${id}`;

function extractImageUrl(falData: Record<string, unknown>): string | null {
  if (falData.images && Array.isArray(falData.images) && falData.images[0]) {
    const first = falData.images[0] as Record<string, unknown> | string;
    return typeof first === "string" ? first : (first.url as string) || null;
  }
  if (falData.image) {
    const img = falData.image as Record<string, unknown> | string;
    return typeof img === "string" ? img : (img.url as string) || null;
  }
  if (
    falData.output &&
    typeof falData.output === "object" &&
    Array.isArray((falData.output as Record<string, unknown>).images)
  ) {
    const images = (falData.output as Record<string, unknown>).images as unknown[];
    const first = images[0] as Record<string, unknown> | string;
    return typeof first === "string" ? first : (first.url as string) || null;
  }
  if (typeof falData.url === "string") {
    return falData.url;
  }
  if (
    falData.data &&
    typeof falData.data === "object" &&
    Array.isArray((falData.data as Record<string, unknown>).images)
  ) {
    const images = (falData.data as Record<string, unknown>).images as unknown[];
    const first = images[0] as Record<string, unknown> | string;
    return typeof first === "string" ? first : (first.url as string) || null;
  }
  return null;
}

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

    logger.info(
      { imageUrlLength: imageUrl.length, promptLength: prompt.length },
      "Submitting to fal.ai queue",
    );

    const falRes = await fetch(FAL_QUEUE_SUBMIT, {
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
      logger.error({ status: falRes.status, body: text }, "fal.ai queue submit error");
      res.status(502).json({ error: "fal.ai returned an error" });
      return;
    }

    const falData = (await falRes.json()) as { request_id?: string };
    const requestId = falData.request_id;

    if (!requestId) {
      logger.error({ falData }, "No request_id in fal.ai queue response");
      res.status(502).json({ error: "No request_id returned by generation API" });
      return;
    }

    logger.info({ requestId }, "fal.ai job submitted");
    res.json({ requestId });
  } catch (err) {
    logger.error({ err }, "Error in POST /api/generate");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/generate/status/:requestId", async (req: Request, res: ExpressResponse) => {
  try {
    const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;

    if (!FAL_API_KEY) {
      res.status(500).json({ error: "Server configuration error" });
      return;
    }

    const falRes = await fetch(FAL_QUEUE_STATUS(requestId), {
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
      },
    });

    if (!falRes.ok) {
      const text = await falRes.text();
      logger.error({ status: falRes.status, body: text }, "fal.ai queue status error");
      res.status(502).json({ error: "fal.ai returned an error" });
      return;
    }

    const falData = (await falRes.json()) as { status?: string };
    const rawStatus = falData.status || "UNKNOWN";

    // Map fal.ai statuses to a simple set for the client
    const mappedStatus =
      rawStatus === "COMPLETED"
        ? "COMPLETED"
        : rawStatus === "FAILED"
          ? "FAILED"
          : "IN_PROGRESS";

    res.json({ status: mappedStatus });
  } catch (err) {
    logger.error({ err }, "Error in GET /api/generate/status");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/generate/result/:requestId", async (req: Request, res: ExpressResponse) => {
  try {
    const requestId = Array.isArray(req.params.requestId) ? req.params.requestId[0] : req.params.requestId;

    if (!FAL_API_KEY) {
      res.status(500).json({ error: "Server configuration error" });
      return;
    }

    const falRes = await fetch(FAL_QUEUE_RESULT(requestId), {
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
      },
    });

    if (!falRes.ok) {
      const text = await falRes.text();
      logger.error({ status: falRes.status, body: text }, "fal.ai queue result error");
      res.status(502).json({ error: "fal.ai returned an error" });
      return;
    }

    const falData = (await falRes.json()) as Record<string, unknown>;
    logger.info({ keys: Object.keys(falData) }, "fal.ai queue result received");

    const imageResultUrl = extractImageUrl(falData);

    if (!imageResultUrl) {
      logger.error({ falData }, "No image URL found in fal.ai queue result");
      res.status(502).json({ error: "No image returned by generation API" });
      return;
    }

    res.json({ imageUrl: imageResultUrl });
  } catch (err) {
    logger.error({ err }, "Error in GET /api/generate/result");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
