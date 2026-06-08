# TON and Jetton Escrow

One contract instance represents one deal:

- `Escrow` holds native TON.
- `JettonEscrow` holds the Jetton configured by the backend through `JETTON_MASTER_ADDRESS`.

Both contracts support `mark_delivered`, `open_dispute`, `release`, `refund`, and the public `timeout` command. Native TON funding uses `deposit`; Jetton funding uses the standard `transfer_notification` flow.

```bash
npm run build -w @escrow/contract
npm run test -w @escrow/contract
```

Contracts are deployed automatically by the backend. The deployer wallet is also the arbitrator and pays deployment and automation gas.
