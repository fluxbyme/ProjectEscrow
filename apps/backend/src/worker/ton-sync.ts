import { DealStatus } from "@prisma/client";
import { notifyDeadline, notifyStatusChange } from "../bot/notifications.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../db.js";
import { getDeployerBalance, sendEscrowCommand } from "../ton/deploy.js";

const chainStatuses: Record<number, DealStatus> = {
  0: "WAITING_DEPOSIT",
  1: "FUNDED",
  2: "DELIVERED",
  3: "DISPUTED",
  4: "RELEASED",
  5: "REFUNDED",
  6: "CANCELLED"
};

async function toncenter<T>(method: string, query: Record<string, string>): Promise<T> {
  const url = new URL(`${env.TONCENTER_API_URL}/${method}`);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: env.TONCENTER_API_KEY ? { "X-API-Key": env.TONCENTER_API_KEY } : {} });
  if (!response.ok) throw new Error(`TON API ${response.status}`);
  const body = await response.json() as { ok: boolean; result: T; error?: string };
  if (!body.ok) throw new Error(body.error ?? "TON API error");
  return body.result;
}

function stackInt(stack: Array<[string, string]>, index = 0): bigint {
  const raw = stack[index]?.[1];
  if (!raw) throw new Error("TON getter returned an empty stack");
  return BigInt(raw);
}

async function getMethod(address: string, method: string): Promise<bigint> {
  const result = await toncenter<{ stack: Array<[string, string]> }>("runGetMethod", { address, method });
  return stackInt(result.stack);
}

type SyncDeal = Awaited<ReturnType<typeof prisma.deal.findFirstOrThrow>>;

async function syncDeal(deal: SyncDeal): Promise<void> {
  if (!deal.escrowAddress) return;
  const [statusNumber, deadlineUnix] = await Promise.all([
    getMethod(deal.escrowAddress, "get_status"),
    getMethod(deal.escrowAddress, "get_deadline")
  ]);
  const status = chainStatuses[Number(statusNumber)];
  if (!status) throw new Error(`Unknown contract status ${statusNumber}`);
  const actionDeadlineAt = deadlineUnix > 0n ? new Date(Number(deadlineUnix) * 1000) : null;
  let current = deal;

  if (status !== deal.status) {
    const transactions = await toncenter<Array<{ transaction_id: { hash: string; lt: string } }>>("getTransactions", { address: deal.escrowAddress, limit: "1" });
    const latest = transactions[0]?.transaction_id;
    const txField = status === "FUNDED" ? { txHashDeposit: latest?.hash } : status === "RELEASED" ? { txHashRelease: latest?.hash } : status === "REFUNDED" ? { txHashRefund: latest?.hash } : {};
    current = await prisma.deal.update({
      where: { id: deal.id },
      data: {
        status,
        actionDeadlineAt,
        deliveryDeadlineAt: status === "FUNDED" ? actionDeadlineAt : deal.deliveryDeadlineAt,
        chainLt: latest ? BigInt(latest.lt) : deal.chainLt,
        lastReminderKey: null,
        timeoutRequestedAt: null,
        ...txField
      }
    });
    logger.info({ dealId: deal.id, status, txHash: latest?.hash }, "Deal synchronized from TON");
    await notifyStatusChange(current);
  } else if (deal.actionDeadlineAt?.getTime() !== actionDeadlineAt?.getTime()) {
    current = await prisma.deal.update({ where: { id: deal.id }, data: { actionDeadlineAt } });
  }

  if (!current.actionDeadlineAt || !["WAITING_DEPOSIT", "FUNDED", "DELIVERED", "DISPUTED"].includes(current.status)) return;
  const remainingMs = current.actionDeadlineAt.getTime() - Date.now();
  const reminderKey = `${current.status}:${current.actionDeadlineAt.getTime()}`;
  if (remainingMs > 0 && remainingMs <= env.REMINDER_LEAD_SECONDS * 1000 && current.lastReminderKey !== reminderKey) {
    await notifyDeadline(current);
    await prisma.deal.update({ where: { id: current.id }, data: { lastReminderKey: reminderKey } });
  }
  if (remainingMs <= 0 && (!current.timeoutRequestedAt || Date.now() - current.timeoutRequestedAt.getTime() > 60_000)) {
    await sendEscrowCommand(current.escrowAddress!, current.currency, "timeout");
    await prisma.deal.update({ where: { id: current.id }, data: { timeoutRequestedAt: new Date() } });
    logger.info({ dealId: current.id, status: current.status }, "Escrow timeout submitted");
  }
}

export function startTonSyncWorker() {
  let stopped = false;
  let backoff = env.TON_SYNC_INTERVAL_MS;
  const loop = async () => {
    while (!stopped) {
      try {
        const now = new Date();
        const pendingDeals = await prisma.deal.findMany({ where: { status: "CREATED" } });
        for (const deal of pendingDeals) {
          const remainingMs = deal.acceptanceDeadlineAt.getTime() - now.getTime();
          const reminderKey = `CREATED:${deal.acceptanceDeadlineAt.getTime()}`;
          if (remainingMs <= 0) {
            const cancelled = await prisma.deal.update({ where: { id: deal.id }, data: { status: "CANCELLED", actionDeadlineAt: null } });
            await notifyStatusChange(cancelled);
          } else if (remainingMs <= env.REMINDER_LEAD_SECONDS * 1000 && deal.lastReminderKey !== reminderKey) {
            await notifyDeadline(deal);
            await prisma.deal.update({ where: { id: deal.id }, data: { lastReminderKey: reminderKey } });
          }
        }
        const deployerBalance = await getDeployerBalance();
        if (deployerBalance < env.DEPLOYER_LOW_BALANCE_NANO) {
          logger.error({ deployerBalance: deployerBalance.toString() }, "Deployer balance is too low for reliable escrow automation");
        }
        const deals = await prisma.deal.findMany({
          where: { escrowAddress: { not: null }, status: { in: ["WAITING_DEPOSIT", "FUNDED", "DELIVERED", "DISPUTED"] } }
        });
        for (const deal of deals) await syncDeal(deal);
        backoff = env.TON_SYNC_INTERVAL_MS;
      } catch (error) {
        logger.error({ err: error, retryInMs: backoff }, "TON sync failed; application remains available");
        backoff = Math.min(backoff * 2, env.TON_SYNC_MAX_BACKOFF_MS);
      }
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  };
  void loop();
  return () => { stopped = true; };
}
