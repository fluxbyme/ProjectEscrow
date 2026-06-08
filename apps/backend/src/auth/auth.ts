import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { adminTelegramIds, env } from "../config/env.js";

export type AuthUser = { telegramId: bigint; username?: string };
const sign = (payload: string) => crypto.createHmac("sha256", env.ADMIN_SECRET).update(payload).digest("base64url");

export function createSession(user: AuthUser): string {
  const payload = Buffer.from(JSON.stringify({ telegramId: user.telegramId.toString(), username: user.username, expiresAt: Date.now() + 86400000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readSession(token: string): AuthUser {
  const [payload, supplied] = token.split(".");
  if (!payload || !supplied) throw new Error("Invalid session");
  const expected = sign(payload);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw new Error("Invalid session");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { telegramId: string; username?: string; expiresAt: number };
  if (data.expiresAt < Date.now()) throw new Error("Session expired");
  return { telegramId: BigInt(data.telegramId), username: data.username };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    if (env.DEV_AUTH && !req.headers.authorization) req.authUser = { telegramId: env.DEV_TELEGRAM_ID, username: env.DEV_USERNAME };
    else {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) throw new Error("Authentication required");
      req.authUser = readSession(token);
    }
    next();
  } catch (error) { res.status(401).json({ error: error instanceof Error ? error.message : "Unauthorized" }); }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.headers["x-admin-secret"] !== env.ADMIN_SECRET && (!req.authUser || !adminTelegramIds.has(req.authUser.telegramId))) {
    return void res.status(403).json({ error: "Admin access required" });
  }
  next();
}
