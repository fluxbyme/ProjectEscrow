import { Address, beginCell, toNano } from "@ton/core";
import { env } from "../config/env.js";
import { getJettonWalletAddress } from "./deploy.js";

export type TonTransaction = { validUntil: number; messages: Array<{ address: string; amount: string; payload: string }> };
type Currency = "TON" | "USDT";

export function commentPayload(command: string): string {
  return beginCell().storeUint(0, 32).storeStringTail(command).endCell().toBoc().toString("base64");
}

export function contractAction(address: string, command: string, amountNano = 50_000_000n): TonTransaction {
  return { validUntil: Math.floor(Date.now() / 1000) + 300, messages: [{ address, amount: amountNano.toString(), payload: commentPayload(command) }] };
}

export async function fundAction(
  escrowAddress: string,
  buyerAddress: string,
  amountNano: bigint,
  currency: Currency
): Promise<TonTransaction> {
  if (currency === "TON") return contractAction(escrowAddress, "deposit", amountNano + env.ESCROW_RESERVE_NANO);

  const buyerJettonWallet = await getJettonWalletAddress(buyerAddress);
  const payload = beginCell()
    .storeUint(0xf8a7ea5, 32)
    .storeUint(0, 64)
    .storeCoins(amountNano)
    .storeAddress(Address.parse(escrowAddress))
    .storeAddress(Address.parse(buyerAddress))
    .storeBit(false)
    .storeCoins(50_000_000n)
    .storeBit(false)
    .endCell()
    .toBoc()
    .toString("base64");
  return {
    validUntil: Math.floor(Date.now() / 1000) + 300,
    messages: [{ address: buyerJettonWallet, amount: toNano("0.12").toString(), payload }]
  };
}

export function parseCurrencyAmount(value: string, currency: Currency): bigint {
  if (currency === "TON") {
    try {
      const amount = toNano(value);
      if (amount <= 0n) throw new Error();
      return amount;
    } catch { throw new Error("Amount must be a positive TON value with up to 9 decimals"); }
  }

  const match = value.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match || (match[2]?.length ?? 0) > env.USDT_DECIMALS) {
    throw new Error(`Amount must be a positive USDT value with up to ${env.USDT_DECIMALS} decimals`);
  }
  const amount = BigInt(match[1]!) * 10n ** BigInt(env.USDT_DECIMALS)
    + BigInt((match[2] ?? "").padEnd(env.USDT_DECIMALS, "0") || "0");
  if (amount <= 0n) throw new Error("Amount must be positive");
  return amount;
}
