import { Router } from "express";
import { Address } from "@ton/core";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth/auth.js";
import { prisma } from "../db.js";
import { sendEscrowCommand } from "../ton/deploy.js";

export const adminRouter = Router();
adminRouter.use((req, res, next) => req.headers["x-admin-secret"] ? next() : requireAuth(req, res, next));
adminRouter.use(requireAdmin);

adminRouter.post("/deals/:id/escrow", async (req, res, next) => {
  try {
    const { address } = z.object({ address: z.string() }).parse(req.body);
    const escrowAddress = Address.parse(address).toString({ bounceable: true });
    const deal = await prisma.deal.update({ where: { id: req.params.id }, data: { escrowAddress } });
    res.json({ id: deal.id, escrowAddress });
  } catch (error) { next(error); }
});

for (const action of ["release", "refund"] as const) {
  adminRouter.post(`/deals/:id/${action}`, async (req, res, next) => {
    try {
      const { resolutionNote } = z.object({ resolutionNote: z.string().trim().min(20).max(2000) }).parse(req.body);
      const deal = await prisma.deal.findUnique({ where: { id: req.params.id } });
      if (!deal) return void res.status(404).json({ error: "Deal not found" });
      if (deal.status !== "DISPUTED") return void res.status(409).json({ error: "Deal is not disputed" });
      if (!deal.escrowAddress) return void res.status(409).json({ error: "Escrow contract is not assigned" });
      if (!deal.disputeReason) return void res.status(409).json({ error: "Dispute evidence is missing" });
      await prisma.deal.update({ where: { id: deal.id }, data: { resolutionNote } });
      await sendEscrowCommand(deal.escrowAddress, deal.currency, action);
      res.json({ submitted: true });
    } catch (error) { next(error); }
  });
}
