export type User = { telegramId: string; username?: string; walletAddress?: string; isAdmin?: boolean };
export type ProductConfig = {
  network: "testnet" | "mainnet";
  jetton: { name: string; masterAddress: string; decimals: number };
  limits: { tonNano: string; jettonAtomic: string };
  funding: { tonStorageReserveNano: string; jettonGasNano: string };
  warning: string;
};
export type DealEvidence = { id: string; kind: "DELIVERY" | "DISPUTE"; filename: string; mimeType: string; sha256: string; uploaderTelegramId: string; createdAt: string };
export type DealStatus = "CREATED" | "WAITING_DEPOSIT" | "FUNDED" | "DELIVERED" | "DISPUTED" | "RELEASED" | "REFUNDED" | "EXPIRED" | "CANCELLED";
export type Deal = {
  id: string; dealCode: string; buyerTelegramId: string; sellerTelegramId: string; buyerWallet?: string; sellerWallet?: string;
  escrowAddress?: string; amountNano: string; currency: "TON" | "USDT"; description: string; status: DealStatus; evidenceHash?: string;
  tokenAddress?: string; deliveryProof?: string; disputeReason?: string; disputeEvidence?: string; resolutionNote?: string;
  buyer: User; seller: User; createdAt: string; acceptanceDeadlineAt: string; acceptedAt?: string;
  depositDeadlineAt?: string; deliveryDeadlineAt?: string; deliveryTimeoutSeconds: number; actionDeadlineAt?: string;
  evidences: DealEvidence[];
};
export type TonTransaction = { validUntil: number; messages: Array<{ address: string; amount: string; payload: string }> };
