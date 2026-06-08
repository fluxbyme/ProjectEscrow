import crypto from "node:crypto";

export type TelegramUser = { id: number; username?: string; first_name?: string; last_name?: string };

export function verifyTelegramInitData(initData: string, botToken: string, maxAgeSeconds = 3600): TelegramUser {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) throw new Error("Missing Telegram hash");
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = crypto.createHmac("sha256", secret).update(check).digest("hex");
  if (receivedHash.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedHash))) {
    throw new Error("Invalid Telegram signature");
  }
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > maxAgeSeconds) throw new Error("Telegram initData expired");
  const rawUser = params.get("user");
  if (!rawUser) throw new Error("Missing Telegram user");
  return JSON.parse(rawUser) as TelegramUser;
}
