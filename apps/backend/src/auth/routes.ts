import { Router } from "express";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { createSession } from "./auth.js";
import { verifyTelegramInitData } from "./telegram.js";

export const authRouter = Router();
authRouter.post("/telegram", async (req, res, next) => {
  try {
    let user: { telegramId: bigint; username?: string };
    if (env.DEV_AUTH && !req.body?.initData) user = { telegramId: env.DEV_TELEGRAM_ID, username: env.DEV_USERNAME };
    else {
      if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN is required for Telegram authentication");
      const telegram = verifyTelegramInitData(String(req.body?.initData ?? ""), env.BOT_TOKEN);
      user = { telegramId: BigInt(telegram.id), username: telegram.username };
    }
    await prisma.user.upsert({ where: { telegramId: user.telegramId }, update: { username: user.username }, create: { telegramId: user.telegramId, username: user.username } });
    res.json({ token: createSession(user) });
  } catch (error) { next(error); }
});
