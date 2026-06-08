# Telegram TON/USDT Escrow

Testnet-first Telegram bot + Mini App with per-deal TON or Jetton USDT escrow contracts. This is not an audited mainnet product.

## Architecture

- `apps/backend`: Express, TypeScript, Prisma/PostgreSQL, Telegraf, TON sync worker.
- `apps/miniapp`: Vite React, Telegram Mini Apps SDK, official TON Connect UI.
- `contracts/escrow`: separate native TON and Jetton escrow contracts, one instance per deal.
- Blockchain status is authoritative. API action endpoints return TON Connect transactions; only the worker advances cached deal status after reading `get_status` on-chain.

## Requirements

- Node.js 20+
- npm 10+
- Docker with Compose
- Telegram bot token and HTTPS Mini App URL for real Telegram testing

## Local Setup

```bash
npm install
docker compose up -d postgres
cp apps/backend/.env.example apps/backend/.env
cp apps/miniapp/.env.example apps/miniapp/.env
npm run db:generate
npm run prisma:deploy -w @escrow/backend
npm run dev:backend
npm run dev:miniapp
```

Open `http://localhost:5173`. With `DEV_AUTH=true`, Telegram initData is optional. Use a different numeric seller ID when creating a local deal.

## Implemented Features

- Per-deal contract deployment from the backend with `WalletContractV4` and a 24-word `DEPLOYER_MNEMONIC`.
- Currency selection when creating a deal: native TON or the configured Jetton shown as USDT.
- Separate `Escrow` and `JettonEscrow` contracts, with the Jetton master address stored on each USDT deal.
- Seller acceptance before deployment. The buyer cannot deposit until the seller accepts the terms and connects a wallet.
- Buyer and seller wallet snapshots are locked to the deal before the contract is deployed.
- Configurable maximum deal amounts, acceptance period, deposit period, delivery period, confirmation period and dispute period.
- Automatic timeout outcomes: cancel an unfunded deal, refund the buyer after missed delivery, release to the seller after buyer inactivity, and refund the buyer after arbitration inactivity.
- TON sync worker reads on-chain status and deadlines, submits timeout transactions and warns when the deployer balance is low.
- Telegram notifications for new deals, acceptance, status changes and approaching action deadlines.
- Delivery proof and dispute evidence as text, URL or an uploaded file up to 5 MB. Files include a SHA-256 digest and access is restricted to deal participants and configured arbitrators.
- Arbitrator decisions require a written resolution note before release or refund.
- Mini App displays currency, configured Jetton master, amount, current deadline, delivery window, locked wallet, evidence and available actions for the current role and state.
- Prisma migrations add currency, token address, acceptance state, stage deadlines, reminder tracking, evidence records and resolution details.

## Deal Lifecycle

1. The buyer creates a TON or USDT deal, acknowledges the risk notice and selects the seller, amount, terms and delivery window.
2. The seller accepts or declines before the acceptance deadline. Expired unaccepted deals are cancelled automatically.
3. On acceptance, the backend locks both wallet addresses and deploys the matching per-deal escrow contract.
4. The buyer deposits before the deposit deadline. An expired unfunded contract is cancelled.
5. After funding, the seller submits delivery proof before the delivery deadline. Missing the deadline makes the buyer eligible for an automatic refund.
6. After delivery, the buyer releases funds or opens a dispute. Buyer inactivity until the confirmation deadline automatically releases funds to the seller.
7. In a dispute, an arbitrator releases or refunds with a decision rationale. Arbitration timeout automatically refunds the buyer.
8. The worker confirms final state from the blockchain and stores transaction hashes in PostgreSQL.

## Telegram Bot

Set `BOT_TOKEN`, `MINI_APP_URL`, and either:

- leave `BOT_WEBHOOK_URL` empty for long polling; or
- set it to the public HTTPS backend origin for webhook mode.

Commands: `/start`, `/create_deal`, `/my_deals`, `/help`.

## Contract

```bash
npm run build -w @escrow/contract
npm run test -w @escrow/contract
BUYER_ADDRESS=... SELLER_ADDRESS=... ARBITRATOR_ADDRESS=... DEAL_AMOUNT_TON=1 DEAL_ID=1 npm run deploy:testnet -w @escrow/contract
```

The backend automatically deploys one contract per deal. TON deals deploy `Escrow`; USDT deals deploy `JettonEscrow` configured against `JETTON_MASTER_ADDRESS`.

New deals require seller acceptance before deployment or funding. Buyer and seller wallet addresses are then locked to the deal. Delivery and dispute actions require written or uploaded evidence; uploaded files are stored with a SHA-256 digest and are accessible only to deal parties and configured arbitrators.

Each contract stores its current action deadline. The sync worker submits the public `timeout` command after expiry: cancel without deposit, refund after missed delivery, release after buyer confirmation timeout, or refund after arbitration timeout.

## Verification

```bash
npm run typecheck
npm run build
npm test
curl http://localhost:4000/health
```

## Required Production Environment

Backend: `DATABASE_URL`, `BOT_TOKEN`, `MINI_APP_URL`, `CORS_ORIGIN`, `ADMIN_SECRET`, `ADMIN_TELEGRAM_IDS`, `TONCENTER_API_URL`, `DEPLOYER_MNEMONIC`, `JETTON_MASTER_ADDRESS`, and optional `TONCENTER_API_KEY`. Fund the deployer wallet with TON for gas. Set `DEV_AUTH=false`.

Timeouts, reminders, currency display, decimal precision, deal limits and deployer balance warnings are configurable in `apps/backend/.env.example`.

Mini App: `VITE_API_URL`, `VITE_TONCONNECT_MANIFEST_URL`. Update `public/tonconnect-manifest.json` with the real HTTPS domain and icon.

## VPS Notes

Run PostgreSQL with Compose, build both apps, run backend with systemd/PM2/container, and serve `apps/miniapp/dist` through Nginx. TLS is required by Telegram and wallet apps. Restrict PostgreSQL to localhost, rotate `ADMIN_SECRET`, back up the database and evidence directory, and monitor worker RPC failures.

## Security Limits and TODO

- Contract is not audited. Use testnet only until an independent review.
- Worker polls getter state and latest transaction. Production should add a durable indexer cursor, finality policy, address-to-deal uniqueness enforcement, and provider redundancy.
- Evidence upload, download authorization, size limits and SHA-256 integrity metadata are implemented. Production still needs malware/content scanning and the configured R2 adapter; this repository currently supports local evidence storage only.
- Bot conversation drafts are in memory and reset on restart. Move drafts to PostgreSQL/Redis if this becomes operationally important.
- Buyer/seller wallet addresses must be connected before deploying their escrow contract. Never request or store user private keys or seed phrases.
- `DEPLOYER_MNEMONIC` controls the backend deployment wallet and must be stored in a production secret manager, never committed to source control.
- The configured Jetton is a project-provided token address, not an independently verified official USDT asset. Users must verify `JETTON_MASTER_ADDRESS` before funding.
