import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";

const router = Router();

/** Dev/testing: JWT for Postman (24h). Restrict or remove in production. */
router.get("/token", (_req: Request, res: Response) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: "JWT_SECRET is not configured" });
    return;
  }

  const token = jwt.sign({ purpose: "postman-test" }, secret, { expiresIn: "24h" });
  res.json({ token, expiresIn: "24h" });
});

export default router;
