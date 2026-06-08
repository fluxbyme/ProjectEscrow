import "dotenv/config";
import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().optional(),
  BOT_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  MINI_APP_URL: z.string().url(),
  CORS_ORIGIN: z.string().min(1),
  DEV_AUTH: booleanString.default("false"),
  DEV_TELEGRAM_ID: z.coerce.bigint().default(100001n),
  DEV_USERNAME: z.string().default("localbuyer"),
  ADMIN_SECRET: z.string().min(24),
  ADMIN_TELEGRAM_IDS: z.string().default(""),
  TON_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  TONCENTER_API_URL: z.string().url(),
  TONCENTER_API_KEY: z.string().optional(),
  DEPLOYER_MNEMONIC: z.string().trim().refine((value) => value.split(/\s+/).length === 24, "DEPLOYER_MNEMONIC must contain 24 words"),
  JETTON_MASTER_ADDRESS: z.string().min(1),
  JETTON_DISPLAY_NAME: z.string().default("USDT Jetton"),
  USDT_DECIMALS: z.coerce.number().int().min(0).max(18).default(6),
  MAX_TON_DEAL_NANO: z.coerce.bigint().default(10000000000n),
  MAX_USDT_DEAL_ATOMIC: z.coerce.bigint().default(1000000000n),
  ACCEPTANCE_TIMEOUT_SECONDS: z.coerce.number().int().min(300).default(86400),
  DEPOSIT_TIMEOUT_SECONDS: z.coerce.number().int().min(300).default(86400),
  DELIVERY_TIMEOUT_SECONDS: z.coerce.number().int().min(3600).default(604800),
  CONFIRMATION_TIMEOUT_SECONDS: z.coerce.number().int().min(3600).default(259200),
  DISPUTE_TIMEOUT_SECONDS: z.coerce.number().int().min(3600).default(259200),
  REMINDER_LEAD_SECONDS: z.coerce.number().int().min(60).default(3600),
  DEPLOYER_LOW_BALANCE_NANO: z.coerce.bigint().default(1000000000n),
  TON_SYNC_INTERVAL_MS: z.coerce.number().int().min(5000).default(15000),
  TON_SYNC_MAX_BACKOFF_MS: z.coerce.number().int().min(15000).default(120000),
  ESCROW_RESERVE_NANO: z.coerce.bigint().default(50000000n),
  LOG_LEVEL: z.string().default("info"),
  EVIDENCE_STORAGE: z.enum(["local", "r2"]).default("local"),
  EVIDENCE_LOCAL_PATH: z.string().default("./storage/evidence"),
  R2_ENDPOINT: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional()
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const adminTelegramIds = new Set(
  env.ADMIN_TELEGRAM_IDS.split(",").map((id) => id.trim()).filter(Boolean).map(BigInt)
);
