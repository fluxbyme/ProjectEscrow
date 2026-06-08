import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

type ReminderDeal = {
  id: string;
  dealCode: string;
  status: string;
  currency: string;
  buyerTelegramId: bigint;
  sellerTelegramId: bigint;
  actionDeadlineAt: Date | null;
};

async function send(chatId: bigint, text: string, dealId: string): Promise<void> {
  if (!env.BOT_TOKEN) return;
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId.toString(),
      text,
      reply_markup: { inline_keyboard: [[{ text: "Open Deal", web_app: { url: `${env.MINI_APP_URL}/deals/${dealId}` } }]] }
    })
  });
  if (!response.ok) logger.warn({ dealId, chatId: chatId.toString(), status: response.status }, "Telegram reminder failed");
}

function deadlineText(deadline: Date | null): string {
  return deadline ? deadline.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "soon";
}

export async function notifyDeadline(deal: ReminderDeal): Promise<void> {
  const deadline = deadlineText(deal.actionDeadlineAt);
  if (deal.status === "CREATED") {
    await send(deal.sellerTelegramId, `Deal #${deal.dealCode}: accept or decline before ${deadline}. The buyer cannot fund it until you accept.`, deal.id);
  } else if (deal.status === "WAITING_DEPOSIT") {
    await send(deal.buyerTelegramId, `Deal #${deal.dealCode}: deposit ${deal.currency} before ${deadline} or the deal will be cancelled.`, deal.id);
  } else if (deal.status === "FUNDED") {
    await send(deal.sellerTelegramId, `Deal #${deal.dealCode}: mark the order delivered before ${deadline} or the buyer will be refunded.`, deal.id);
  } else if (deal.status === "DELIVERED") {
    await send(deal.buyerTelegramId, `Deal #${deal.dealCode}: confirm delivery or open a dispute before ${deadline}. After that, funds release automatically.`, deal.id);
  } else if (deal.status === "DISPUTED") {
    const admins = env.ADMIN_TELEGRAM_IDS.split(",").map((id) => id.trim()).filter(Boolean).map(BigInt);
    await Promise.all(admins.map((id) => send(id, `Deal #${deal.dealCode}: resolve this dispute before ${deadline} or the buyer will be refunded automatically.`, deal.id)));
  }
}

export async function notifyStatusChange(deal: ReminderDeal): Promise<void> {
  if (deal.status === "WAITING_DEPOSIT") {
    await send(deal.buyerTelegramId, `Deal #${deal.dealCode} was accepted. You can now fund it before ${deadlineText(deal.actionDeadlineAt)}.`, deal.id);
  } else if (deal.status === "FUNDED") {
    await send(deal.sellerTelegramId, `Deal #${deal.dealCode} is funded. Delivery is now required.`, deal.id);
  } else if (deal.status === "DELIVERED") {
    await send(deal.buyerTelegramId, `Deal #${deal.dealCode} was marked delivered. Confirm release or open a dispute.`, deal.id);
  } else if (deal.status === "DISPUTED") {
    await notifyDeadline(deal);
  } else if (deal.status === "RELEASED") {
    await Promise.all([
      send(deal.buyerTelegramId, `Deal #${deal.dealCode} completed. Funds were released to the seller.`, deal.id),
      send(deal.sellerTelegramId, `Deal #${deal.dealCode} completed. Funds were released to you.`, deal.id)
    ]);
  } else if (deal.status === "REFUNDED" || deal.status === "CANCELLED") {
    await send(deal.buyerTelegramId, `Deal #${deal.dealCode} is ${deal.status.toLowerCase()}. Funds are not locked anymore.`, deal.id);
  }
}

export async function notifyDealCreated(deal: ReminderDeal): Promise<void> {
  await send(deal.sellerTelegramId, `New deal #${deal.dealCode} requires your acceptance before any funds can be deposited.`, deal.id);
}
