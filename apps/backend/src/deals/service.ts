import crypto from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { parseCurrencyAmount } from "../ton/actions.js";

export const createDealSchema = z.object({
  sellerTelegramId: z.coerce.bigint().optional(),
  sellerUsername: z.string().trim().min(2).max(32).transform((v) => v.replace(/^@/, "")).optional(),
  currency: z.enum(["TON", "USDT"]).default("TON"),
  amount: z.string().trim(),
  description: z.string().trim().min(3).max(500),
  deliveryDeadlineAt: z.coerce.date().optional(),
  acknowledgeRisk: z.literal(true)
}).refine((v) => v.sellerTelegramId || v.sellerUsername, "Seller Telegram ID or username is required");

export async function createDeal(input: z.infer<typeof createDealSchema>, buyer: { telegramId: bigint; username?: string }) {
  const seller = input.sellerTelegramId
    ? await prisma.user.upsert({ where: { telegramId: input.sellerTelegramId }, update: {}, create: { telegramId: input.sellerTelegramId, username: input.sellerUsername } })
    : await prisma.user.findFirst({ where: { username: { equals: input.sellerUsername, mode: "insensitive" } } });
  if (!seller) throw new Error("Seller has not started the bot. Use their numeric Telegram ID.");
  if (seller.telegramId === buyer.telegramId) throw new Error("Buyer and seller must be different users");
  const buyerRecord = await prisma.user.upsert({ where: { telegramId: buyer.telegramId }, update: { username: buyer.username }, create: { telegramId: buyer.telegramId, username: buyer.username } });
  if (!buyerRecord.walletAddress) throw new Error("Buyer wallet address is required");
  const now = new Date();
  const acceptanceDeadlineAt = new Date(now.getTime() + env.ACCEPTANCE_TIMEOUT_SECONDS * 1000);
  const requestedDeliveryDeadline = input.deliveryDeadlineAt
    ?? new Date(now.getTime() + env.DELIVERY_TIMEOUT_SECONDS * 1000);
  const deliveryTimeoutSeconds = Math.floor((requestedDeliveryDeadline.getTime() - now.getTime()) / 1000);
  if (deliveryTimeoutSeconds < 3600) throw new Error("Delivery window must be at least one hour");
  const amountNano = parseCurrencyAmount(input.amount, input.currency);
  const maximum = input.currency === "TON" ? env.MAX_TON_DEAL_NANO : env.MAX_USDT_DEAL_ATOMIC;
  if (amountNano > maximum) throw new Error(`Amount exceeds the configured ${input.currency} deal limit`);

  const deal = await prisma.deal.create({
    data: {
      dealCode: crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase(),
      buyerTelegramId: buyer.telegramId,
      sellerTelegramId: seller.telegramId,
      buyerWallet: buyerRecord.walletAddress,
      sellerWallet: seller.walletAddress,
      amountNano,
      currency: input.currency,
      tokenAddress: input.currency === "USDT" ? env.JETTON_MASTER_ADDRESS : null,
      description: input.description,
      status: "CREATED",
      acceptanceDeadlineAt,
      deliveryTimeoutSeconds,
      actionDeadlineAt: acceptanceDeadlineAt
    },
    include: { buyer: true, seller: true, evidences: true }
  });

  return deal;
}

export function findUserDeal(id: string, telegramId: bigint) {
  return prisma.deal.findFirst({ where: { id, OR: [{ buyerTelegramId: telegramId }, { sellerTelegramId: telegramId }] }, include: { buyer: true, seller: true, evidences: true } });
}
