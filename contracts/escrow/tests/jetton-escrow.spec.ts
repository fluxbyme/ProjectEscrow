import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { beginCell, toNano } from "@ton/core";
import { findTransaction } from "@ton/test-utils";
import { JettonEscrow } from "../build/JettonEscrow/JettonEscrow_JettonEscrow";

describe("JettonEscrow", () => {
  let blockchain: Blockchain;
  let buyer: SandboxContract<TreasuryContract>;
  let seller: SandboxContract<TreasuryContract>;
  let arbitrator: SandboxContract<TreasuryContract>;
  let jettonMaster: SandboxContract<TreasuryContract>;
  let jettonWallet: SandboxContract<TreasuryContract>;
  let escrow: SandboxContract<JettonEscrow>;
  const now = 1_800_000_000;

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    blockchain.now = now;
    buyer = await blockchain.treasury("buyer");
    seller = await blockchain.treasury("seller");
    arbitrator = await blockchain.treasury("arbitrator");
    jettonMaster = await blockchain.treasury("jetton-master");
    jettonWallet = await blockchain.treasury("escrow-jetton-wallet");
    escrow = blockchain.openContract(await JettonEscrow.fromInit(
      1n,
      buyer.address,
      seller.address,
      arbitrator.address,
      jettonMaster.address,
      1_000_000n,
      BigInt(now + 100),
      100n,
      50n,
      60n
    ));
    await escrow.send(arbitrator.getSender(), { value: toNano("0.1") }, { $$type: "Deploy", queryId: 0n });
    await escrow.send(arbitrator.getSender(), { value: toNano("0.05") }, { $$type: "SetJettonWallet", wallet: jettonWallet.address });
  });

  async function fund() {
    return escrow.send(jettonWallet.getSender(), { value: toNano("0.05") }, {
      $$type: "JettonTransferNotification",
      queryId: 1n,
      amount: 1_000_000n,
      sender: buyer.address,
      forwardPayload: beginCell().endCell().asSlice()
    });
  }

  it("accepts the configured Jetton wallet and releases tokens", async () => {
    await fund();
    expect(await escrow.getGetStatus()).toBe(1n);
    await escrow.send(seller.getSender(), { value: toNano("0.05") }, "mark_delivered");
    const result = await escrow.send(buyer.getSender(), { value: toNano("0.1") }, "release");
    expect(findTransaction(result.transactions, { from: escrow.address, to: jettonWallet.address, success: true })).toBeDefined();
    expect(await escrow.getGetStatus()).toBe(4n);
  });

  it("rejects transfer notifications from an unconfigured wallet", async () => {
    const fakeWallet = await blockchain.treasury("fake-wallet");
    const result = await escrow.send(fakeWallet.getSender(), { value: toNano("0.05") }, {
      $$type: "JettonTransferNotification",
      queryId: 1n,
      amount: 1_000_000n,
      sender: buyer.address,
      forwardPayload: beginCell().endCell().asSlice()
    });
    expect(findTransaction(result.transactions, { from: fakeWallet.address, to: escrow.address, success: false })).toBeDefined();
    expect(await escrow.getGetStatus()).toBe(0n);
  });
});
