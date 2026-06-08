import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import { adminRouter } from "./admin/routes.js";
import { authRouter } from "./auth/routes.js";
import { startBot } from "./bot/bot.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./db.js";
import { dealsRouter } from "./deals/routes.js";
import { usersRouter } from "./users/routes.js";
import { startTonSyncWorker } from "./worker/ton-sync.js";

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((v) => v.trim()), credentials: false }));
app.use(express.json({ limit: "128kb" }));
app.use(pinoHttp({ logger }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));

app.get("/health", (_req, res) => res.json({ ok: true, network: env.TON_NETWORK }));
app.use("/api/auth", authRouter);
app.use("/api", usersRouter);
app.use("/api/deals", dealsRouter);
app.use("/api/admin", adminRouter);

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) { res.status(400).json({ error: "Invalid input", details: error.flatten() }); return; }
  logger.error({ err: error }, "Request failed");
  const message = error instanceof Error ? error.message : "Internal server error";
  res.status(message.includes("wallet address is required") || message.includes("deadline") || message.includes("Seller") || message.includes("Amount") ? 400 : 500).json({ error: message });
};
app.use(errorHandler);

const server = app.listen(env.PORT, async () => {
  logger.info({ port: env.PORT }, "Backend listening");
  const bot = await startBot();
  if (bot && env.BOT_WEBHOOK_URL) app.post("/telegram/webhook", bot.webhookCallback("/telegram/webhook"));
});
const stopWorker = startTonSyncWorker();

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  stopWorker();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
