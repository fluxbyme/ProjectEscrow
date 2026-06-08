import { Address } from "@ton/core";
import express, { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.js";
import { notifyDealCreated, notifyStatusChange } from "../bot/notifications.js";
import { adminTelegramIds, env } from "../config/env.js";
import { prisma } from "../db.js";
import { contractAction, fundAction } from "../ton/actions.js";
import { deployEscrowContract, getDeployerAddress } from "../ton/deploy.js";
import { evidenceStorage } from "../storage/evidence.js";
import { jsonSafe } from "../utils/json.js";
import { createDeal, createDealSchema, findUserDeal } from "./service.js";

export const dealsRouter = Router();
dealsRouter.use(requireAuth);

function sameWallet(current: string | null | undefined, locked: string | null | undefined): boolean {
  if (!current || !locked) return false;
  try { return Address.parse(current).equals(Address.parse(locked)); } catch { return false; }
}

function findAccessibleDeal(id: string, telegramId: bigint) {
  if (adminTelegramIds.has(telegramId)) {
    return prisma.deal.findUnique({ where: { id }, include: { buyer: true, seller: true, evidences: true } });
  }
  return findUserDeal(id, telegramId);
}

dealsRouter.post("/", async (req, res, next) => {
  try {
    const deal = await createDeal(createDealSchema.parse(req.body), req.authUser!);
    await notifyDealCreated(deal);
    res.status(201).json(jsonSafe(deal));
  }
  catch (error) { next(error); }
});
dealsRouter.get("/", async (req, res, next) => {
  try {
    const deals = await prisma.deal.findMany({ where: { OR: [{ buyerTelegramId: req.authUser!.telegramId }, { sellerTelegramId: req.authUser!.telegramId }] }, include: { buyer: true, seller: true, evidences: true }, orderBy: { createdAt: "desc" } });
    res.json(jsonSafe(deals));
  } catch (error) { next(error); }
});
dealsRouter.get("/:id", async (req, res, next) => {
  try {
    const deal = await findAccessibleDeal(req.params.id, req.authUser!.telegramId);
    if (!deal) return void res.status(404).json({ error: "Deal not found" });
    res.json(jsonSafe(deal));
  } catch (error) { next(error); }
});

dealsRouter.post("/:id/evidence", express.raw({ type: "application/octet-stream", limit: "5mb" }), async (req, res, next) => {
  try {
    const deal = await findUserDeal(req.params.id, req.authUser!.telegramId);
    if (!deal) return void res.status(404).json({ error: "Deal not found" });
    const kind = z.enum(["DELIVERY", "DISPUTE"]).parse(req.query.kind);
    if (kind === "DELIVERY" && deal.sellerTelegramId !== req.authUser!.telegramId) return void res.status(403).json({ error: "Only the seller can upload delivery evidence" });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return void res.status(400).json({ error: "Evidence file is empty" });
    const filename = z.string().trim().min(1).max(200).parse(req.headers["x-file-name"]);
    const mimeType = z.string().trim().min(1).max(100).parse(req.headers["x-file-type"] ?? "application/octet-stream");
    const stored = await evidenceStorage().put(deal.id, req.body);
    const evidence = await prisma.dealEvidence.create({
      data: { dealId: deal.id, uploaderTelegramId: req.authUser!.telegramId, kind, filename, mimeType, storageKey: stored.key, sha256: stored.sha256 }
    });
    res.status(201).json(jsonSafe(evidence));
  } catch (error) { next(error); }
});

dealsRouter.get("/:id/evidence/:evidenceId", async (req, res, next) => {
  try {
    const deal = await findAccessibleDeal(req.params.id, req.authUser!.telegramId);
    if (!deal) return void res.status(404).json({ error: "Deal not found" });
    const evidence = deal.evidences.find((item) => item.id === req.params.evidenceId);
    if (!evidence) return void res.status(404).json({ error: "Evidence not found" });
    const data = await evidenceStorage().get(evidence.storageKey);
    res.setHeader("Content-Type", evidence.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(evidence.filename)}`);
    res.send(data);
  } catch (error) { next(error); }
});

dealsRouter.post("/:id/accept", async (req, res, next) => {
  try {
    z.object({ confirm: z.literal(true) }).parse(req.body);
    const deal = await findUserDeal(req.params.id, req.authUser!.telegramId);
    if (!deal || deal.sellerTelegramId !== req.authUser!.telegramId) return void res.status(403).json({ error: "Seller access required" });
    if (deal.status !== "CREATED") return void res.status(409).json({ error: "Deal is no longer awaiting seller acceptance" });
    if (deal.acceptanceDeadlineAt <= new Date()) return void res.status(409).json({ error: "Acceptance deadline has passed" });
    if (!deal.seller.walletAddress) return void res.status(409).json({ error: "Connect the seller wallet before accepting" });
    if (!deal.buyerWallet) return void res.status(409).json({ error: "Buyer wallet is missing" });

    const acceptedAt = new Date();
    const depositDeadlineAt = new Date(acceptedAt.getTime() + env.DEPOSIT_TIMEOUT_SECONDS * 1000);
    const escrowAddress = await deployEscrowContract(
      deal.id,
      deal.buyerWallet,
      deal.seller.walletAddress,
      await getDeployerAddress(),
      deal.amountNano,
      deal.currency,
      {
        depositDeadline: depositDeadlineAt,
        deliveryTimeoutSeconds: deal.deliveryTimeoutSeconds,
        confirmationTimeoutSeconds: env.CONFIRMATION_TIMEOUT_SECONDS,
        disputeTimeoutSeconds: env.DISPUTE_TIMEOUT_SECONDS
      }
    );
    const accepted = await prisma.deal.update({
      where: { id: deal.id },
      data: {
        status: "WAITING_DEPOSIT",
        sellerWallet: deal.seller.walletAddress,
        escrowAddress,
        acceptedAt,
        depositDeadlineAt,
        actionDeadlineAt: depositDeadlineAt,
        lastReminderKey: null
      },
      include: { buyer: true, seller: true, evidences: true }
    });
    await notifyStatusChange(accepted);
    res.json(jsonSafe(accepted));
  } catch (error) { next(error); }
});

dealsRouter.post("/:id/cancel", async (req, res, next) => {
  try {
    const deal = await findUserDeal(req.params.id, req.authUser!.telegramId);
    if (!deal || ![deal.buyerTelegramId, deal.sellerTelegramId].includes(req.authUser!.telegramId)) return void res.status(403).json({ error: "Deal party access required" });
    if (deal.status !== "CREATED") return void res.status(409).json({ error: "Only an unaccepted deal can be cancelled" });
    const cancelled = await prisma.deal.update({ where: { id: deal.id }, data: { status: "CANCELLED", actionDeadlineAt: null }, include: { buyer: true, seller: true, evidences: true } });
    res.json(jsonSafe(cancelled));
  } catch (error) { next(error); }
});

dealsRouter.post("/:id/fund", async (req, res, next) => {
  try {
    const deal = await findUserDeal(req.params.id, req.authUser!.telegramId);
    if (!deal || deal.buyerTelegramId !== req.authUser!.telegramId) return void res.status(403).json({ error: "Buyer access required" });
    if (deal.status !== "WAITING_DEPOSIT") return void res.status(409).json({ error: "Deal is not waiting for deposit" });
    if (!deal.escrowAddress) return void res.status(409).json({ error: "Escrow contract is not assigned yet" });
    if (!deal.buyerWallet) return void res.status(409).json({ error: "Buyer wallet is not connected" });
    if (!sameWallet(deal.buyer.walletAddress, deal.buyerWallet)) return void res.status(409).json({ error: "Reconnect the buyer wallet locked to this deal" });
    res.json({ transaction: await fundAction(deal.escrowAddress, deal.buyerWallet, deal.amountNano, deal.currency) });
  } catch (error) { next(error); }
});
dealsRouter.post("/:id/mark-delivered", async (req, res, next) => {
  try {
    const { deliveryProof } = z.object({ deliveryProof: z.string().trim().max(2000).default("") }).parse(req.body);
    const deal = await findUserDeal(req.params.id, req.authUser!.telegramId);
    if (!deal || deal.sellerTelegramId !== req.authUser!.telegramId) return void res.status(403).json({ error: "Seller access required" });
    if (deal.status !== "FUNDED") return void res.status(409).json({ error: "Deal is not funded" });
    if (!deal.escrowAddress) return void res.status(409).json({ error: "Escrow contract is not assigned" });
    if (!sameWallet(deal.seller.walletAddress, deal.sellerWallet)) return void res.status(409).json({ error: "Reconnect the seller wallet locked to this deal" });
    const hasDeliveryFile = deal.evidences.some((evidence) => evidence.kind === "DELIVERY");
    if (deliveryProof.length < 10 && !hasDeliveryFile) return void res.status(400).json({ error: "Delivery proof text or file is required" });
    await prisma.deal.update({ where: { id: deal.id }, data: { deliveryProof: deliveryProof || null } });
    res.json({ transaction: contractAction(deal.escrowAddress, "mark_delivered") });
  } catch (error) { next(error); }
});
dealsRouter.post("/:id/release", async (req, res, next) => {
  try {
    z.object({ confirm: z.literal(true) }).parse(req.body);
    const deal = await findUserDeal(req.params.id, req.authUser!.telegramId);
    if (!deal || deal.buyerTelegramId !== req.authUser!.telegramId) return void res.status(403).json({ error: "Buyer access required" });
    if (deal.status !== "DELIVERED") return void res.status(409).json({ error: "Deal is not delivered" });
    if (!deal.escrowAddress) return void res.status(409).json({ error: "Escrow contract is not assigned" });
    if (!sameWallet(deal.buyer.walletAddress, deal.buyerWallet)) return void res.status(409).json({ error: "Reconnect the buyer wallet locked to this deal" });
    res.json({ transaction: contractAction(deal.escrowAddress, "release") });
  } catch (error) { next(error); }
});
dealsRouter.post("/:id/open-dispute", async (req, res, next) => {
  try {
    const body = z.object({
      reason: z.string().trim().min(10).max(2000),
      evidence: z.string().trim().url().max(2000).optional().or(z.literal(""))
    }).parse(req.body ?? {});
    const deal = await findUserDeal(req.params.id, req.authUser!.telegramId);
    if (!deal || !["FUNDED", "DELIVERED"].includes(deal.status)) return void res.status(409).json({ error: "Deal cannot be disputed" });
    if (!deal.escrowAddress) return void res.status(409).json({ error: "Escrow contract is not assigned" });
    const lockedWallet = deal.buyerTelegramId === req.authUser!.telegramId ? deal.buyerWallet : deal.sellerWallet;
    const currentWallet = deal.buyerTelegramId === req.authUser!.telegramId ? deal.buyer.walletAddress : deal.seller.walletAddress;
    if (!sameWallet(currentWallet, lockedWallet)) return void res.status(409).json({ error: "Reconnect the wallet locked to this deal" });
    const hasDisputeFile = deal.evidences.some((evidence) => evidence.kind === "DISPUTE");
    if (!body.evidence && !hasDisputeFile) return void res.status(400).json({ error: "A dispute evidence URL or file is required" });
    await prisma.deal.update({ where: { id: deal.id }, data: { disputeReason: body.reason, disputeEvidence: body.evidence || null } });
    res.json({ transaction: contractAction(deal.escrowAddress, "open_dispute") });
  } catch (error) { next(error); }
});
dealsRouter.post("/:id/timeout", async (req, res, next) => {
  try {
    const deal = await findUserDeal(req.params.id, req.authUser!.telegramId);
    if (!deal?.escrowAddress || !deal.actionDeadlineAt) return void res.status(409).json({ error: "Deal has no active timeout" });
    if (deal.actionDeadlineAt >= new Date()) return void res.status(409).json({ error: "Deal deadline has not been reached" });
    res.json({ transaction: contractAction(deal.escrowAddress, "timeout") });
  } catch (error) { next(error); }
});
