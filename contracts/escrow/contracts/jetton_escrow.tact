import "@stdlib/deploy";

const WAITING_DEPOSIT: Int = 0;
const FUNDED: Int = 1;
const DELIVERED: Int = 2;
const DISPUTED: Int = 3;
const RELEASED: Int = 4;
const REFUNDED: Int = 5;
const CANCELLED: Int = 6;
const JETTON_TRANSFER: Int = 0xf8a7ea5;

message SetJettonWallet {
    wallet: Address;
}

message(0x7362d09c) JettonTransferNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    forwardPayload: Slice as remaining;
}

struct EscrowParties {
    buyer: Address;
    seller: Address;
    arbitrator: Address;
}

contract JettonEscrow with Deployable {
    dealId: Int as uint64;
    buyer: Address;
    seller: Address;
    arbitrator: Address;
    jettonMaster: Address;
    jettonWallet: Address?;
    amount: Int as coins;
    depositDeadline: Int as uint32;
    deliveryTimeout: Int as uint32;
    confirmationTimeout: Int as uint32;
    disputeTimeout: Int as uint32;
    actionDeadline: Int as uint32;
    status: Int as uint8;

    init(
        dealId: Int,
        buyer: Address,
        seller: Address,
        arbitrator: Address,
        jettonMaster: Address,
        amount: Int,
        depositDeadline: Int,
        deliveryTimeout: Int,
        confirmationTimeout: Int,
        disputeTimeout: Int
    ) {
        require(amount > 0, "invalid amount");
        require(buyer != seller, "same party");
        require(depositDeadline > now(), "deposit deadline passed");
        require(deliveryTimeout > 0, "invalid delivery timeout");
        self.dealId = dealId;
        self.buyer = buyer;
        self.seller = seller;
        self.arbitrator = arbitrator;
        self.jettonMaster = jettonMaster;
        self.jettonWallet = null;
        self.amount = amount;
        self.depositDeadline = depositDeadline;
        self.deliveryTimeout = deliveryTimeout;
        self.confirmationTimeout = confirmationTimeout;
        self.disputeTimeout = disputeTimeout;
        self.actionDeadline = depositDeadline;
        self.status = WAITING_DEPOSIT;
    }

    receive(msg: SetJettonWallet) {
        require(sender() == self.arbitrator, "arbitrator only");
        require(self.jettonWallet == null, "wallet already set");
        self.jettonWallet = msg.wallet;
    }

    receive(msg: JettonTransferNotification) {
        require(self.jettonWallet != null && sender() == self.jettonWallet!!, "invalid jetton wallet");
        require(msg.sender == self.buyer, "buyer only");
        require(self.status == WAITING_DEPOSIT, "already funded");
        require(now() <= self.depositDeadline, "deposit deadline passed");
        require(msg.amount == self.amount, "incorrect deposit amount");
        self.status = FUNDED;
        self.actionDeadline = now() + self.deliveryTimeout;
    }

    receive("mark_delivered") {
        require(sender() == self.seller, "seller only");
        require(self.status == FUNDED, "not funded");
        require(now() <= self.actionDeadline, "delivery deadline passed");
        self.status = DELIVERED;
        self.actionDeadline = now() + self.confirmationTimeout;
    }

    receive("open_dispute") {
        require(sender() == self.buyer || sender() == self.seller, "party only");
        require(self.status == FUNDED || self.status == DELIVERED, "cannot dispute");
        require(now() <= self.actionDeadline, "action deadline passed");
        self.status = DISPUTED;
        self.actionDeadline = now() + self.disputeTimeout;
    }

    fun sendJettons(destination: Address) {
        require(self.jettonWallet != null, "jetton wallet not set");
        let body: Cell = beginCell()
            .storeUint(JETTON_TRANSFER, 32)
            .storeUint(0, 64)
            .storeCoins(self.amount)
            .storeAddress(destination)
            .storeAddress(myAddress())
            .storeMaybeRef(null)
            .storeCoins(1)
            .storeBit(false)
            .endCell();
        send(SendParameters {
            to: self.jettonWallet!!,
            value: ton("0.08"),
            body: body,
            bounce: true,
            mode: SendPayGasSeparately
        });
    }

    receive("release") {
        require(sender() == self.buyer || sender() == self.arbitrator, "buyer or arbitrator only");
        require(self.status == DELIVERED || (self.status == DISPUTED && sender() == self.arbitrator && now() <= self.actionDeadline), "cannot release");
        self.status = RELEASED;
        self.actionDeadline = 0;
        self.sendJettons(self.seller);
    }

    receive("refund") {
        require(sender() == self.arbitrator, "arbitrator only");
        require(self.status == DISPUTED, "not disputed");
        require(now() <= self.actionDeadline, "arbitration deadline passed");
        self.status = REFUNDED;
        self.actionDeadline = 0;
        self.sendJettons(self.buyer);
    }

    receive("timeout") {
        require(self.actionDeadline > 0 && now() > self.actionDeadline, "deadline not reached");
        if (self.status == WAITING_DEPOSIT) {
            self.status = CANCELLED;
            self.actionDeadline = 0;
        } else if (self.status == FUNDED || self.status == DISPUTED) {
            self.status = REFUNDED;
            self.actionDeadline = 0;
            self.sendJettons(self.buyer);
        } else if (self.status == DELIVERED) {
            self.status = RELEASED;
            self.actionDeadline = 0;
            self.sendJettons(self.seller);
        } else {
            require(false, "no timeout action");
        }
    }

    bounced(msg: Slice) {
        if (self.status == RELEASED) {
            self.status = DELIVERED;
            self.actionDeadline = now() + self.confirmationTimeout;
        }
        if (self.status == REFUNDED) {
            self.status = DISPUTED;
            self.actionDeadline = now() + self.disputeTimeout;
        }
    }

    get fun get_status(): Int { return self.status; }
    get fun get_deal_id(): Int { return self.dealId; }
    get fun get_deadline(): Int { return self.actionDeadline; }
    get fun get_jetton_master(): Address { return self.jettonMaster; }
    get fun get_jetton_wallet(): Address? { return self.jettonWallet; }
    get fun get_parties(): EscrowParties { return EscrowParties { buyer: self.buyer, seller: self.seller, arbitrator: self.arbitrator }; }
}
