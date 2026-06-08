import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { toNano } from "@ton/core";
import { Escrow } from "../build/Escrow/Escrow_Escrow";
import { findTransaction } from "@ton/test-utils";

describe("Escrow", () => {
  let blockchain: Blockchain;
  let buyer: SandboxContract<TreasuryContract>;
  let seller: SandboxContract<TreasuryContract>;
  let arbitrator: SandboxContract<TreasuryContract>;
  let stranger: SandboxContract<TreasuryContract>;
  let escrow: SandboxContract<Escrow>;
  const now = 1_800_000_000;
  const depositDeadline = now + 100;
  const deliveryDeadline = now + 200;

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    blockchain.now = now;
    buyer = await blockchain.treasury("buyer"); seller = await blockchain.treasury("seller");
    arbitrator = await blockchain.treasury("arbitrator"); stranger = await blockchain.treasury("stranger");
    escrow = blockchain.openContract(await Escrow.fromInit(
      1n,
      buyer.address,
      seller.address,
      arbitrator.address,
      toNano("1"),
      BigInt(depositDeadline),
      100n,
      50n,
      60n
    ));
    await escrow.send(buyer.getSender(), { value: toNano("0.1") }, { $$type: "Deploy", queryId: 0n });
  });

  const fund = () => escrow.send(buyer.getSender(), { value: toNano("1.06") }, "deposit");
  const deliver = () => escrow.send(seller.getSender(), { value: toNano("0.05") }, "mark_delivered");

  it("funds, delivers and releases", async () => {
    await fund(); expect(await escrow.getGetStatus()).toBe(1n);
    await deliver(); expect(await escrow.getGetStatus()).toBe(2n);
    const result = await escrow.send(buyer.getSender(), { value: toNano("0.05") }, "release");
    expect(findTransaction(result.transactions, { from: escrow.address, to: seller.address, success: true })).toBeDefined();
    expect(await escrow.getGetStatus()).toBe(4n);
  });

  it("allows only buyer to release", async () => {
    await fund(); await deliver();
    const result = await escrow.send(stranger.getSender(), { value: toNano("0.05") }, "release");
    expect(findTransaction(result.transactions, { from: stranger.address, to: escrow.address, success: false })).toBeDefined();
    expect(await escrow.getGetStatus()).toBe(2n);
  });

  it("allows only seller to mark delivered", async () => {
    await fund();
    const result = await escrow.send(buyer.getSender(), { value: toNano("0.05") }, "mark_delivered");
    expect(findTransaction(result.transactions, { from: buyer.address, to: escrow.address, success: false })).toBeDefined();
    expect(await escrow.getGetStatus()).toBe(1n);
  });

  it("supports dispute then arbitrator refund", async () => {
    await fund();
    await escrow.send(seller.getSender(), { value: toNano("0.05") }, "open_dispute");
    expect(await escrow.getGetStatus()).toBe(3n);
    const result = await escrow.send(arbitrator.getSender(), { value: toNano("0.05") }, "refund");
    expect(findTransaction(result.transactions, { from: escrow.address, to: buyer.address, success: true })).toBeDefined();
    expect(await escrow.getGetStatus()).toBe(5n);
  });

  it("cannot release twice", async () => {
    await fund(); await deliver();
    await escrow.send(buyer.getSender(), { value: toNano("0.05") }, "release");
    const second = await escrow.send(buyer.getSender(), { value: toNano("0.05") }, "release");
    expect(findTransaction(second.transactions, { from: buyer.address, to: escrow.address, success: false })).toBeDefined();
    expect(await escrow.getGetStatus()).toBe(4n);
  });

  it("cancels an unfunded deal after the deposit deadline", async () => {
    blockchain.now = depositDeadline + 1;
    await escrow.send(stranger.getSender(), { value: toNano("0.05") }, "timeout");
    expect(await escrow.getGetStatus()).toBe(6n);
  });

  it("refunds the buyer when the seller misses delivery", async () => {
    await fund();
    blockchain.now = now + 101;
    const result = await escrow.send(stranger.getSender(), { value: toNano("0.05") }, "timeout");
    expect(findTransaction(result.transactions, { from: escrow.address, to: buyer.address, success: true })).toBeDefined();
    expect(await escrow.getGetStatus()).toBe(5n);
  });

  it("releases to the seller when buyer confirmation times out", async () => {
    await fund();
    await deliver();
    blockchain.now = now + 51;
    const result = await escrow.send(stranger.getSender(), { value: toNano("0.05") }, "timeout");
    expect(findTransaction(result.transactions, { from: escrow.address, to: seller.address, success: true })).toBeDefined();
    expect(await escrow.getGetStatus()).toBe(4n);
  });

  it("refunds the buyer when dispute arbitration times out", async () => {
    await fund();
    await escrow.send(seller.getSender(), { value: toNano("0.05") }, "open_dispute");
    blockchain.now = now + 61;
    const result = await escrow.send(stranger.getSender(), { value: toNano("0.05") }, "timeout");
    expect(findTransaction(result.transactions, { from: escrow.address, to: buyer.address, success: true })).toBeDefined();
    expect(await escrow.getGetStatus()).toBe(5n);
  });
});
