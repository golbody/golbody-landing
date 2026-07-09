import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index";
import paymentsRouter from "./routes/payments";
import { webhookHandler } from "./routes/webhook";
import { logger } from "./lib/logger";

const app: Express = express();

app.post("/webhook", express.raw({ type: "application/json" }), webhookHandler);

app.use(
  (pinoHttp as any)({
    logger,
    serializers: {
      req(req: Request) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res: Response) { return { statusCode: res.statusCode }; },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(paymentsRouter);
app.use("/api", router);

export default app;
