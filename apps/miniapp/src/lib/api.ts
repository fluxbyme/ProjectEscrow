import type { Deal, ProductConfig, TonTransaction, User } from "../types";

const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
let token = localStorage.getItem("escrow_session");

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body as T;
}

export async function authenticate(initData: string) {
  const result = await request<{ token: string }>("/api/auth/telegram", { method: "POST", body: JSON.stringify({ initData }) });
  token = result.token; localStorage.setItem("escrow_session", token); return result;
}
export const api = {
  me: () => request<User>("/api/me"),
  config: () => request<ProductConfig>("/api/config"),
  connectWallet: (address: string) => request<User>("/api/wallet/connect", { method: "POST", body: JSON.stringify({ address }) }),
  deals: () => request<Deal[]>("/api/deals"),
  deal: (id: string) => request<Deal>(`/api/deals/${id}`),
  uploadEvidence: async (id: string, kind: "DELIVERY" | "DISPUTE", file: File) => {
    const response = await fetch(`${baseUrl}/api/deals/${id}/evidence?kind=${kind}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": file.name,
        "X-File-Type": file.type || "application/octet-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: file
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Evidence upload failed");
    return body;
  },
  downloadEvidence: async (dealId: string, evidenceId: string, filename: string) => {
    const response = await fetch(`${baseUrl}/api/deals/${dealId}/evidence/${evidenceId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!response.ok) throw new Error("Evidence download failed");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.click();
    URL.revokeObjectURL(url);
  },
  createDeal: (input: { sellerUsername?: string; sellerTelegramId?: string; currency: "TON" | "USDT"; amount: string; description: string; deliveryDeadlineAt?: string; acknowledgeRisk: true }) => request<Deal>("/api/deals", { method: "POST", body: JSON.stringify(input) }),
  action: (id: string, action: string, body: Record<string, unknown> = {}, admin = false) => request<{ transaction?: TonTransaction; submitted?: boolean }>(admin ? `/api/admin/deals/${id}/${action}` : `/api/deals/${id}/${action}`, { method: "POST", body: JSON.stringify(body) })
};
