import app from "./app";
import { type Request, type Response } from "express";

export default function handler(req: Request, res: Response) {
  return app(req, res);
}
