import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: ["req.headers.authorization", "req.headers.x-admin-secret", "BOT_TOKEN", "ADMIN_SECRET"]
});
