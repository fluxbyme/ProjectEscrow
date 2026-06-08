import { Address } from "@ton/core";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.js";
import { adminTelegramIds, env } from "../config/env.js";
import { prisma } from "../db.js";
import { jsonSafe } from "../utils/json.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);
usersRouter.get("/me", async (req, res, next) => {
  try {
    const user = await prisma.user.upsert({ where: { telegramId: req.authUser!.telegramId }, update: { username: req.authUser!.username }, create: { telegramId: req.authUser!.telegramId, username: req.authUser!.username } });
    res.json({ ...jsonSafe(user), isAdmin: adminTelegramIds.has(user.telegramId) });
  } catch (error) { next(error); }
});
usersRouter.get("/config", (_req, res) => {
  res.json({
    network: env.TON_NETWORK,
    jetton: { name: env.JETTON_DISPLAY_NAME, masterAddress: env.JETTON_MASTER_ADDRESS, decimals: env.USDT_DECIMALS },
    limits: { tonNano: env.MAX_TON_DEAL_NANO.toString(), jettonAtomic: env.MAX_USDT_DEAL_ATOMIC.toString() },
    funding: { tonStorageReserveNano: env.ESCROW_RESERVE_NANO.toString(), jettonGasNano: "120000000" },
    warning: "This product and its smart contracts are not audited. Use only amounts you can afford to lose."
  });
});
usersRouter.post("/wallet/connect", async (req, res, next) => {
  try {
    const { address } = z.object({ address: z.string() }).parse(req.body);
    const normalized = Address.parse(address).toString({ bounceable: false });
    const user = await prisma.user.upsert({ where: { telegramId: req.authUser!.telegramId }, update: { walletAddress: normalized }, create: { telegramId: req.authUser!.telegramId, username: req.authUser!.username, walletAddress: normalized } });
    res.json(jsonSafe(user));
  } catch (error) { next(error); }
});
