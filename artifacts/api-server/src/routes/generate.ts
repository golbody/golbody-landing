import { Router, type Request, type Response as ExpressResponse } from "express";
import { logger } from "../lib/logger";

const router = Router();

const FAL_API_KEY = process.env["FAL_API_KEY"];
const FAL_MODEL = "fal-ai/flux-pro/kontext";
const FAL_QUEUE_BASE = `https://queue.fal.run/${FAL_MODEL}`;

function extractImageUrl(falData: Record<string, unknown>): string | null {
  if (falData.images && Array.isArray(falData.images) && falData.images[0]) {
    const first = falData.images[0] as Record<string, unknown> | string;
    return typeof first === "string" ? first : (first.url as string) || null;
  }
  if (falData.image) {
    const img = falData.image as Record<string, unknown> | string;
    return typeof img === "string" ? img : (img.url as string) || null;
  }
  if (falData.output && typeof falData.output === "object") {
    const out = falData.output as Record<string, unknown>;
    if (Array.isArray(out.images) && out.images[0]) {
      const first = out.images[0] as Record<string, unknown> | string;
      return typeof first === "string" ? first : (first.url as string) || null;
    }
  }
  if (typeof falData.url === "string") return falData.url;
  if (falData.data && typeof falData.data === "object") {
    const d = falData.data as Record<string, unknown>;
    if (Array.isArray(d.images) && d.images[0]) {
      const first = d.images[0] as Record<string, unknown> | string;
      return typeof first === "string" ? first : (first.url as string) || null;
    }
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
    logger.info({ promptLength: prompt.length }, "Submitting to fal.ai queue");
    const falRes = await fetch(FAL_QUEUE_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${FAL_API_KEY}` },
      body: JSON.stringify({ prompt, image_url: imageUrl }),
    });
    if (!falRes.ok) {
      const text = await falRes.text();
      logger.error({ status: falRes.status, body: text }, "fal.ai queue submit error");
      res.status(502).json({ error: "fal.ai returned an error" });
      return;
    }
    const data = (await falRes.json()) as Record<string, unknown>;
    const requestId = (data.request_id || data.requestId) as string;
    if (!requestId) {
      logger.error({ data }, "No request_id from fal.ai");
      res.status(502).json({ error: "No request_id from fal.ai" });
      return;
    }
    res.json({ requestId });
  } catch (err) {
    logger.error({ err }, "Error in POST /api/generate");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/generate/status/:requestId", async (req: Request, res: ExpressResponse) => {
  try {
    if (!FAL_API_KEY) { res.status(500).json({ error: "Server configuration error" }); return; }
    const { requestId } = req.params;
    const statusRes = await fetch(`${FAL_QUEUE_BASE}/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${FAL_API_KEY}` },
    });
    if (!statusRes.ok) { res.status(502).json({ error: "fal.ai status error" }); return; }
    const data = (await statusRes.json()) as Record<string, unknown>;
    res.json({ status: data.status });
  } catch (err) {
    logger.error({ err }, "Error in GET /api/generate/status");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/generate/result/:requestId", async (req: Request, res: ExpressResponse) => {
  try {
    if (!FAL_API_KEY) { res.status(500).json({ error: "Server configuration error" }); return; }
    const { requestId } = req.params;
    const resultRes = await fetch(`${FAL_QUEUE_BASE}/requests/${requestId}`, {
      headers: { Authorization: `Key ${FAL_API_KEY}` },
    });
    if (!resultRes.ok) { res.status(502).json({ error: "fal.ai result error" }); return; }
    const falData = (await resultRes.json()) as Record<string, unknown>;
    const imageUrl = extractImageUrl(falData);
    if (!imageUrl) {
      logger.error({ falData }, "No image URL in fal.ai result");
      res.status(502).json({ error: "No image returned by generation API" });
      return;
    }
    res.json({ imageUrl });
  } catch (err) {
    logger.error({ err }, "Error in GET /api/generate/result");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
