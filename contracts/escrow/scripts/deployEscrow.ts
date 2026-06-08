import { Address, toNano } from "@ton/core";
import type { NetworkProvider } from "@ton/blueprint";
import { Escrow } from "../build/Escrow/Escrow_Escrow";

export async function run(provider: NetworkProvider) {
  const buyer = Address.parse(required("BUYER_ADDRESS"));
  const seller = Address.parse(required("SELLER_ADDRESS"));
  const arbitrator = Address.parse(required("ARBITRATOR_ADDRESS"));
  const dealId = BigInt(process.env.DEAL_ID ?? "1");
  const now = Math.floor(Date.now() / 1000);
  const escrow = provider.open(await Escrow.fromInit(
    dealId,
    buyer,
    seller,
    arbitrator,
    toNano(required("DEAL_AMOUNT_TON")),
    BigInt(now + 86400),
    604800n,
    259200n,
    259200n
  ));
  await escrow.send(provider.sender(), { value: toNano("0.1") }, { $$type: "Deploy", queryId: 0n });
  await provider.waitForDeploy(escrow.address);
  console.log("Escrow address:", escrow.address.toString());
}

function required(name: string): string {
  const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value;
}
