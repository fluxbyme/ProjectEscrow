import { TonConnectButton, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api, authenticate } from "./lib/api";
import type { Deal, ProductConfig, TonTransaction, User } from "./types";

declare global { interface Window { Telegram?: { WebApp?: { initData?: string; ready?: () => void; expand?: () => void } } } }

const amount = (atomic: string, currency: Deal["currency"]) =>
  (Number(atomic) / 10 ** (currency === "TON" ? 9 : 6)).toLocaleString(undefined, { maximumFractionDigits: currency === "TON" ? 9 : 6 });
const dateTime = (value?: string) => value ? new Date(value).toLocaleString() : "Completed";

export function App() {
  const [me, setMe] = useState<User>();
  const [config, setConfig] = useState<ProductConfig>();
  const [ready, setReady] = useState(false);
  const wallet = useTonWallet();
  useEffect(() => {
    void (async () => {
      try {
        window.Telegram?.WebApp?.ready?.(); window.Telegram?.WebApp?.expand?.();
        await authenticate(window.Telegram?.WebApp?.initData ?? "");
        const [user, productConfig] = await Promise.all([api.me(), api.config()]);
        setMe(user); setConfig(productConfig);
      } finally { setReady(true); }
    })();
  }, []);
  useEffect(() => { if (wallet) void api.connectWallet(wallet.account.address).then(setMe); }, [wallet?.account.address]);
  if (!ready) return <main className="shell"><p>Loading...</p></main>;
  return <main className="shell"><Routes>
    <Route path="/" element={<Home config={config} />} />
    <Route path="/create" element={<CreateDeal config={config} />} />
    <Route path="/deals" element={<MyDeals />} />
    <Route path="/deals/:id" element={<DealDetail me={me} />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></main>;
}

function Header({ title }: { title: string }) { return <header><Link to="/" className="back">Escrow</Link><h1>{title}</h1></header>; }
function Home({ config }: { config?: ProductConfig }) { return <><Header title="Create a safe deal"/><p className="lead">TON or a configured Jetton stays locked until the deal resolves.</p>{config && <p className="warning">{config.warning}</p>}<TonConnectButton/><div className="actions"><Link className="button primary" to="/create">Create Deal</Link><Link className="button" to="/deals">My Deals</Link></div><p className="notice">Never share your seed phrase. Every transaction requires a little TON for network fees.</p></>; }

function CreateDeal({ config }: { config?: ProductConfig }) {
  const navigate = useNavigate(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget); const seller = String(data.get("seller") ?? "").trim();
    const deliveryDeadlineAt = String(data.get("deliveryDeadlineAt") ?? "");
    const currency = String(data.get("currency")) as Deal["currency"];
    const dealAmount = String(data.get("amount"));
    const description = String(data.get("description"));
    try {
      const tokenLine = currency === "USDT" ? `\nJetton master: ${config?.jetton.masterAddress ?? "Unavailable"}` : "";
      if (!window.confirm(`Review deal\nSeller: ${seller}\nAmount: ${dealAmount} ${currency}${tokenLine}\nTerms: ${description}\n\nCreate this deal?`)) return;
      const deal = await api.createDeal({
        ...(/^\d+$/.test(seller) ? { sellerTelegramId: seller } : { sellerUsername: seller.replace(/^@/, "") }),
        currency,
        amount: dealAmount,
        description,
        acknowledgeRisk: true,
        ...(deliveryDeadlineAt ? { deliveryDeadlineAt: new Date(deliveryDeadlineAt).toISOString() } : {})
      });
      navigate(`/deals/${deal.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create deal"); } finally { setBusy(false); }
  }
  return <><Header title="Create Deal"/><form onSubmit={submit}><label>Seller username or Telegram ID<input name="seller" required placeholder="@seller or 123456789"/></label><label>Payment currency<select name="currency" defaultValue="TON"><option value="TON">TON</option><option value="USDT">{config?.jetton.name ?? "Configured Jetton"}</option></select></label>{config && <p className="warning">Jetton master: {config.jetton.masterAddress}. Verify this address before creating the deal. TON funding adds {amount(config.funding.tonStorageReserveNano, "TON")} TON storage reserve; Jetton funding requires about {amount(config.funding.jettonGasNano, "TON")} TON for gas.</p>}<label>Amount<input name="amount" required inputMode="decimal" placeholder="1.5"/></label><label>Delivery window end (used as duration after funding)<input name="deliveryDeadlineAt" type="datetime-local"/></label><label>Description<textarea name="description" required minLength={3} maxLength={500} placeholder="Include exact deliverables and acceptance criteria."/></label><label className="check"><input name="risk" type="checkbox" required/>I verified the seller, currency, token address, amount and terms. I understand the contracts are not audited.</label>{error && <p className="error">{error}</p>}<button className="button primary" disabled={busy}>{busy ? "Creating..." : "Create Deal"}</button></form></>;
}

function MyDeals() {
  const [deals, setDeals] = useState<Deal[]>(); const [error, setError] = useState("");
  useEffect(() => { void api.deals().then(setDeals).catch((e) => setError(e.message)); }, []);
  return <><Header title="My Deals"/>{error && <p className="error">{error}</p>}<div className="deal-list">{deals?.map((deal) => <Link className="deal-card" to={`/deals/${deal.id}`} key={deal.id}><span><strong>#{deal.dealCode}</strong><small>{deal.description}</small></span><span><strong>{amount(deal.amountNano, deal.currency)} {deal.currency}</strong><small>{deal.status.replaceAll("_", " ")}</small></span></Link>)}{deals?.length === 0 && <p>No deals yet.</p>}</div></>;
}

function DealDetail({ me }: { me?: User }) {
  const { id = "" } = useParams(); const [deal, setDeal] = useState<Deal>(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [deliveryProof, setDeliveryProof] = useState(""); const [deliveryFile, setDeliveryFile] = useState<File>(); const [disputeReason, setDisputeReason] = useState(""); const [disputeEvidence, setDisputeEvidence] = useState(""); const [disputeFile, setDisputeFile] = useState<File>(); const [resolutionNote, setResolutionNote] = useState(""); const [tonConnect] = useTonConnectUI(); const wallet = useTonWallet();
  const load = () => api.deal(id).then(setDeal).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, [id]);
  async function act(action: string, body: Record<string, unknown> = {}, admin = false) {
    setBusy(true); setError("");
    try {
      const result = await api.action(id, action, body, admin);
      if (result.transaction) await tonConnect.sendTransaction(result.transaction as TonTransaction);
      setTimeout(() => void load(), 5000);
    } catch (e) { setError(e instanceof Error ? e.message : "Transaction failed"); } finally { setBusy(false); }
  }
  async function submitDelivery() {
    if (deliveryFile) await api.uploadEvidence(id, "DELIVERY", deliveryFile);
    await act("mark-delivered", { deliveryProof });
  }
  async function submitDispute() {
    if (disputeFile) await api.uploadEvidence(id, "DISPUTE", disputeFile);
    await act("open-dispute", { reason: disputeReason, evidence: disputeEvidence });
  }
  if (!deal) return <><Header title="Deal"/><p>{error || "Loading..."}</p></>;
  const buyer = me?.telegramId === deal.buyerTelegramId; const seller = me?.telegramId === deal.sellerTelegramId;
  const lockedWallet = buyer ? deal.buyerWallet : seller ? deal.sellerWallet : undefined;
  const wrongWallet = Boolean(lockedWallet && me?.walletAddress && me.walletAddress !== lockedWallet);
  const expired = deal.actionDeadlineAt ? new Date(deal.actionDeadlineAt).getTime() <= Date.now() : false;
  return <><Header title={`Deal #${deal.dealCode}`}/><section className="summary"><Status value={deal.status}/><Row label="Currency" value={deal.currency === "USDT" ? "USDT (configured Jetton)" : "TON"}/>{deal.tokenAddress && <Row label="Jetton master" value={deal.tokenAddress}/>}<Row label="Amount" value={`${amount(deal.amountNano, deal.currency)} ${deal.currency}`}/><Row label={deal.status === "CREATED" ? "Acceptance deadline" : "Current deadline"} value={dateTime(deal.actionDeadlineAt)}/><Row label="Delivery deadline" value={deal.deliveryDeadlineAt ? dateTime(deal.deliveryDeadlineAt) : `${Math.ceil(deal.deliveryTimeoutSeconds / 86400)} day(s) after funding`}/><Row label="Buyer" value={deal.buyer.username ? `@${deal.buyer.username}` : deal.buyerTelegramId}/><Row label="Seller" value={deal.seller.username ? `@${deal.seller.username}` : deal.sellerTelegramId}/><Row label="Description and acceptance criteria" value={deal.description}/>{deal.deliveryProof && <Row label="Delivery proof" value={deal.deliveryProof}/>} {deal.evidences.map((evidence) => <div className="row" key={evidence.id}><span>{evidence.kind} file</span><strong>{evidence.filename}</strong><small>SHA-256 {evidence.sha256}</small><button className="button" onClick={() => void api.downloadEvidence(deal.id, evidence.id, evidence.filename)}>Download evidence</button></div>) } {deal.disputeReason && <Row label="Dispute reason" value={deal.disputeReason}/>} {deal.disputeEvidence && <Row label="Dispute evidence" value={deal.disputeEvidence}/>} {deal.resolutionNote && <Row label="Arbitrator decision" value={deal.resolutionNote}/>}<Row label="Wallet locked to this deal" value={lockedWallet ?? (seller && deal.status === "CREATED" ? "Set when seller accepts" : "Unavailable")}/><Row label="Connected wallet" value={wallet ? `${wallet.account.address.slice(0, 8)}...${wallet.account.address.slice(-6)}` : "Not connected"}/></section><TonConnectButton/>{wrongWallet && <p className="warning">Wrong wallet connected. Reconnect the wallet locked to this deal before taking action.</p>}{error && <p className="error">{error}</p>}<div className="actions">
    {deal.status === "CREATED" && seller && <><button className="button primary" disabled={busy || !wallet} onClick={() => void act("accept", { confirm: true })}>Accept Terms And Lock Wallet</button><button className="button danger" disabled={busy} onClick={() => void act("cancel")}>Decline Deal</button></>}
    {deal.status === "CREATED" && buyer && <button className="button danger" disabled={busy} onClick={() => void act("cancel")}>Cancel Deal</button>}
    {deal.status === "WAITING_DEPOSIT" && buyer && <button className="button primary" disabled={busy || !wallet || wrongWallet} onClick={() => void act("fund")}>Fund {deal.currency} Deal</button>}
    {deal.status === "FUNDED" && seller && <><label>Delivery proof<textarea value={deliveryProof} onChange={(event) => setDeliveryProof(event.target.value)} maxLength={2000} placeholder="Tracking number, signed receipt, delivery link, or verifiable completion details."/></label><label>Delivery evidence file (max 5MB)<input type="file" onChange={(event) => setDeliveryFile(event.target.files?.[0])}/></label><button className="button primary" disabled={busy || !wallet || wrongWallet || (deliveryProof.trim().length < 10 && !deliveryFile)} onClick={() => void submitDelivery()}>Submit Proof And Mark Delivered</button></>}
    {deal.status === "DELIVERED" && buyer && <button className="button primary" disabled={busy || !wallet || wrongWallet} onClick={() => { if (window.confirm(`Release ${amount(deal.amountNano, deal.currency)} ${deal.currency} to the seller? This cannot be reversed.`)) void act("release", { confirm: true }); }}>Release Funds</button>}
    {["FUNDED", "DELIVERED"].includes(deal.status) && <><label>Dispute reason<textarea value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} minLength={10} maxLength={2000} placeholder="Explain what happened and the outcome you request."/></label><label>Evidence URL<input value={disputeEvidence} onChange={(event) => setDisputeEvidence(event.target.value)} type="url" placeholder="https://..."/></label><label>Or upload evidence (max 5MB)<input type="file" onChange={(event) => setDisputeFile(event.target.files?.[0])}/></label><button className="button danger" disabled={busy || !wallet || wrongWallet || disputeReason.trim().length < 10 || (!disputeEvidence && !disputeFile)} onClick={() => void submitDispute()}>Open Dispute With Evidence</button></>}
    {expired && deal.status !== "CREATED" && <button className="button" disabled={busy || !wallet} onClick={() => void act("timeout")}>Process Timeout</button>}
    {deal.status === "DISPUTED" && me?.isAdmin && <><label>Decision rationale<textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} minLength={20} maxLength={2000} placeholder="Summarize the evidence reviewed and why this outcome is fair."/></label><button className="button primary" disabled={busy || resolutionNote.trim().length < 20} onClick={() => void act("release", { resolutionNote }, true)}>Release To Seller</button><button className="button danger" disabled={busy || resolutionNote.trim().length < 20} onClick={() => void act("refund", { resolutionNote }, true)}>Refund Buyer</button></>}
  </div><p className="notice">Status and deadlines update after on-chain confirmation. Jetton actions still require TON for network fees.</p></>;
}
function Row({ label, value }: { label: string; value: string }) { return <div className="row"><span>{label}</span><strong>{value}</strong></div>; }
function Status({ value }: { value: string }) { return <span className={`status status-${value.toLowerCase()}`}>{value.replaceAll("_", " ")}</span>; }
