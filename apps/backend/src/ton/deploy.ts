import crypto from "node:crypto";
import { Address, beginCell, toNano } from "@ton/core";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { TonClient, WalletContractV4 } from "@ton/ton";
import { Escrow } from "../../../../contracts/escrow/build/Escrow/Escrow_Escrow.js";
import { JettonEscrow } from "../../../../contracts/escrow/build/JettonEscrow/JettonEscrow_JettonEscrow.js";
import { env } from "../config/env.js";

const DEPLOY_VALUE = toNano("0.1");
const COMMAND_VALUE = toNano("0.1");
const DEPLOY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

type Currency = "TON" | "USDT";
type Deadlines = {
  depositDeadline: Date;
  deliveryTimeoutSeconds: number;
  confirmationTimeoutSeconds: number;
  disputeTimeoutSeconds: number;
};

let deployerPromise: ReturnType<typeof createDeployer> | undefined;
let deploymentQueue: Promise<void> = Promise.resolve();

async function createDeployer() {
  const keyPair = await mnemonicToPrivateKey(env.DEPLOYER_MNEMONIC.split(/\s+/));
  const endpoint = env.TONCENTER_API_URL.endsWith("/jsonRPC")
    ? env.TONCENTER_API_URL
    : `${env.TONCENTER_API_URL.replace(/\/$/, "")}/jsonRPC`;
  const client = new TonClient({ endpoint, apiKey: env.TONCENTER_API_KEY || undefined });
  const wallet = client.open(WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey }));
  return { client, keyPair, wallet };
}

function getDeployer() {
  deployerPromise ??= createDeployer();
  return deployerPromise;
}

function queued<T>(operation: () => Promise<T>): Promise<T> {
  const result = deploymentQueue.then(operation);
  deploymentQueue = result.then(() => undefined, () => undefined);
  return result;
}

function contractDealId(dealId: string): bigint {
  return crypto.createHash("sha256").update(dealId).digest().readBigUInt64BE(0);
}

function unix(date: Date): bigint {
  return BigInt(Math.floor(date.getTime() / 1000));
}

function formatAddress(address: Address): string {
  return address.toString({ bounceable: true, testOnly: env.TON_NETWORK === "testnet" });
}

async function waitForDeployment(client: TonClient, address: Address): Promise<void> {
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await client.getContractState(address)).state === "active") return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for escrow contract ${formatAddress(address)} to deploy`);
}

export async function getDeployerAddress(): Promise<string> {
  return formatAddress((await getDeployer()).wallet.address);
}

export async function getDeployerBalance(): Promise<bigint> {
  return (await getDeployer()).wallet.getBalance();
}

export async function getJettonWalletAddress(ownerAddress: string): Promise<string> {
  const { client } = await getDeployer();
  const result = await client.runMethod(Address.parse(env.JETTON_MASTER_ADDRESS), "get_wallet_address", [{
    type: "slice",
    cell: beginCell().storeAddress(Address.parse(ownerAddress)).endCell()
  }]);
  return formatAddress(result.stack.readAddress());
}

async function deploy(
  dealId: string,
  buyerAddress: string,
  sellerAddress: string,
  arbitratorAddress: string,
  amountNano: bigint,
  currency: Currency,
  deadlines: Deadlines
): Promise<string> {
  const { client, keyPair, wallet } = await getDeployer();
  const sender = wallet.sender(keyPair.secretKey);
  const common = [
    contractDealId(dealId),
    Address.parse(buyerAddress),
    Address.parse(sellerAddress),
    Address.parse(arbitratorAddress)
  ] as const;
  const timing = [
    amountNano,
    unix(deadlines.depositDeadline),
    BigInt(deadlines.deliveryTimeoutSeconds),
    BigInt(deadlines.confirmationTimeoutSeconds),
    BigInt(deadlines.disputeTimeoutSeconds)
  ] as const;

  if (currency === "TON") {
    const escrow = client.open(await Escrow.fromInit(...common, ...timing));
    if ((await client.getContractState(escrow.address)).state !== "active") {
      await escrow.send(sender, { value: DEPLOY_VALUE }, { $$type: "Deploy", queryId: 0n });
      await waitForDeployment(client, escrow.address);
    }
    return formatAddress(escrow.address);
  }

  const escrow = client.open(await JettonEscrow.fromInit(
    ...common,
    Address.parse(env.JETTON_MASTER_ADDRESS),
    ...timing
  ));
  if ((await client.getContractState(escrow.address)).state !== "active") {
    await escrow.send(sender, { value: DEPLOY_VALUE }, { $$type: "Deploy", queryId: 0n });
    await waitForDeployment(client, escrow.address);
  }
  if (await escrow.getGetJettonWallet() === null) {
    const jettonWallet = Address.parse(await getJettonWalletAddress(formatAddress(escrow.address)));
    await escrow.send(sender, { value: COMMAND_VALUE }, { $$type: "SetJettonWallet", wallet: jettonWallet });
    const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await escrow.getGetJettonWallet() !== null) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    if (await escrow.getGetJettonWallet() === null) throw new Error("Timed out configuring escrow Jetton wallet");
  }
  return formatAddress(escrow.address);
}

export function deployEscrowContract(
  dealId: string,
  buyerAddress: string,
  sellerAddress: string,
  arbitratorAddress: string,
  amountNano: bigint,
  currency: Currency,
  deadlines: Deadlines
): Promise<string> {
  return queued(() => deploy(dealId, buyerAddress, sellerAddress, arbitratorAddress, amountNano, currency, deadlines));
}

export function sendEscrowCommand(address: string, currency: Currency, command: "timeout" | "release" | "refund"): Promise<void> {
  return queued(async () => {
    const { client, keyPair, wallet } = await getDeployer();
    const sender = wallet.sender(keyPair.secretKey);
    if (currency === "TON") {
      await client.open(Escrow.fromAddress(Address.parse(address))).send(sender, { value: COMMAND_VALUE }, command);
    } else {
      await client.open(JettonEscrow.fromAddress(Address.parse(address))).send(sender, { value: COMMAND_VALUE }, command);
    }
  });
}
