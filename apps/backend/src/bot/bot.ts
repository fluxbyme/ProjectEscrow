import { Telegraf, Markup } from "telegraf";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../db.js";
import { createDeal } from "../deals/service.js";

type Draft = { step: "seller" | "currency" | "amount" | "description"; sellerTelegramId?: bigint; sellerUsername?: string; currency?: "TON" | "USDT"; amount?: string };
const drafts = new Map<number, Draft>();

export async function startBot() {
  if (!env.BOT_TOKEN) { logger.warn("BOT_TOKEN is empty; Telegram bot is disabled"); return undefined; }
  const bot = new Telegraf(env.BOT_TOKEN);
  const menu = Markup.inlineKeyboard([
    [Markup.button.webApp("Open App", env.MINI_APP_URL)],
    [Markup.button.callback("Create Deal", "create_deal"), Markup.button.webApp("My Deals", `${env.MINI_APP_URL}/deals`)]
  ]);

  bot.start(async (ctx) => {
    await prisma.user.upsert({ where: { telegramId: BigInt(ctx.from.id) }, update: { username: ctx.from.username }, create: { telegramId: BigInt(ctx.from.id), username: ctx.from.username } });
    await ctx.reply("Create a safe deal. Funds stay locked until the buyer confirms.\n\nNever share your seed phrase.", menu);
  });
  const begin = async (ctx: { from?: { id: number }; reply: (text: string) => Promise<unknown> }) => {
    if (!ctx.from) return;
    drafts.set(ctx.from.id, { step: "seller" });
    await ctx.reply("Send the seller's @username or numeric Telegram ID.");
  };
  bot.command("create_deal", begin);
  bot.action("create_deal", async (ctx) => { await ctx.answerCbQuery(); await begin(ctx); });
  bot.command("my_deals", (ctx) => ctx.reply("Open your deals:", Markup.inlineKeyboard([Markup.button.webApp("My Deals", `${env.MINI_APP_URL}/deals`)])));
  bot.help((ctx) => ctx.reply("/create_deal - Create a deal\n/my_deals - View deals\n\nYou need a little TON for network fees."));

  bot.on("text", async (ctx) => {
    const draft = drafts.get(ctx.from.id);
    if (!draft || ctx.message.text.startsWith("/")) return;
    const text = ctx.message.text.trim();
    if (draft.step === "seller") {
      if (/^\d+$/.test(text)) draft.sellerTelegramId = BigInt(text); else draft.sellerUsername = text.replace(/^@/, "");
      draft.step = "currency";
      await ctx.reply("Payment currency? Reply TON or USDT.");
      return;
    }
    if (draft.step === "currency") {
      const currency = text.toUpperCase();
      if (currency !== "TON" && currency !== "USDT") { await ctx.reply("Reply TON or USDT."); return; }
      draft.currency = currency;
      draft.step = "amount";
      await ctx.reply(`Amount in ${currency}? Example: 1.5`);
      return;
    }
    if (draft.step === "amount") { draft.amount = text; draft.step = "description"; await ctx.reply("Short deal description?"); return; }
    try {
      const deal = await createDeal({ sellerTelegramId: draft.sellerTelegramId, sellerUsername: draft.sellerUsername, currency: draft.currency!, amount: draft.amount!, description: text, acknowledgeRisk: true }, { telegramId: BigInt(ctx.from.id), username: ctx.from.username });
      drafts.delete(ctx.from.id);
      const detailUrl = `${env.MINI_APP_URL}/deals/${deal.id}`;
      const decimals = deal.currency === "TON" ? 9 : env.USDT_DECIMALS;
      const amount = Number(deal.amountNano) / 10 ** decimals;
      const message = `Deal #${deal.dealCode} created\nAmount: ${amount} ${deal.currency}\nAcceptance deadline: ${deal.acceptanceDeadlineAt.toISOString()}\nStatus: Waiting for seller acceptance`;
      await ctx.reply(message, Markup.inlineKeyboard([[Markup.button.webApp("Open Deal", detailUrl)], [Markup.button.webApp("My Deals", `${env.MINI_APP_URL}/deals`)]]));
      try { await bot.telegram.sendMessage(Number(deal.sellerTelegramId), `New deal #${deal.dealCode}\nAmount: ${amount} ${deal.currency}\nReview and accept before any funds can be deposited.`, Markup.inlineKeyboard([Markup.button.webApp("Review Deal", detailUrl)])); }
      catch { logger.info({ dealId: deal.id }, "Seller notification skipped; seller may not have started bot"); }
    } catch (error) { drafts.delete(ctx.from.id); await ctx.reply(error instanceof Error ? error.message : "Could not create deal"); }
  });

  if (env.BOT_WEBHOOK_URL) await bot.telegram.setWebhook(`${env.BOT_WEBHOOK_URL}/telegram/webhook`);
  else await bot.launch();
  logger.info("Telegram bot started");
  return bot;
}
