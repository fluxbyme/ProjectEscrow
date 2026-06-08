import "@stdlib/deploy";

const WAITING_DEPOSIT: Int = 0;
const FUNDED: Int = 1;
const DELIVERED: Int = 2;
const DISPUTED: Int = 3;
const RELEASED: Int = 4;
const REFUNDED: Int = 5;
const CANCELLED: Int = 6;
const STORAGE_RESERVE: Int = ton("0.05");

struct EscrowParties {
    buyer: Address;
    seller: Address;
    arbitrator: Address;
}

contract Escrow with Deployable {
    dealId: Int as uint64;
    buyer: Address;
    seller: Address;
    arbitrator: Address;
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
        self.amount = amount;
        self.depositDeadline = depositDeadline;
        self.deliveryTimeout = deliveryTimeout;
        self.confirmationTimeout = confirmationTimeout;
        self.disputeTimeout = disputeTimeout;
        self.actionDeadline = depositDeadline;
        self.status = WAITING_DEPOSIT;
    }

    receive("deposit") {
        let ctx: Context = context();
        require(sender() == self.buyer, "buyer only");
        require(self.status == WAITING_DEPOSIT, "already funded");
        require(now() <= self.depositDeadline, "deposit deadline passed");
        require(ctx.value >= self.amount + STORAGE_RESERVE, "insufficient deposit");
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

    receive("release") {
        require(sender() == self.buyer || sender() == self.arbitrator, "buyer or arbitrator only");
        require(self.status == DELIVERED || (self.status == DISPUTED && sender() == self.arbitrator && now() <= self.actionDeadline), "cannot release");
        self.status = RELEASED;
        self.actionDeadline = 0;
        send(SendParameters { to: self.seller, value: self.amount, bounce: true, mode: SendPayGasSeparately });
    }

    receive("refund") {
        require(sender() == self.arbitrator, "arbitrator only");
        require(self.status == DISPUTED, "not disputed");
        require(now() <= self.actionDeadline, "arbitration deadline passed");
        self.status = REFUNDED;
        self.actionDeadline = 0;
        send(SendParameters { to: self.buyer, value: self.amount, bounce: true, mode: SendPayGasSeparately });
    }

    receive("timeout") {
        require(self.actionDeadline > 0 && now() > self.actionDeadline, "deadline not reached");
        if (self.status == WAITING_DEPOSIT) {
            self.status = CANCELLED;
            self.actionDeadline = 0;
        } else if (self.status == FUNDED || self.status == DISPUTED) {
            self.status = REFUNDED;
            self.actionDeadline = 0;
            send(SendParameters { to: self.buyer, value: self.amount, bounce: true, mode: SendPayGasSeparately });
        } else if (self.status == DELIVERED) {
            self.status = RELEASED;
            self.actionDeadline = 0;
            send(SendParameters { to: self.seller, value: self.amount, bounce: true, mode: SendPayGasSeparately });
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
    get fun get_parties(): EscrowParties { return EscrowParties { buyer: self.buyer, seller: self.seller, arbitrator: self.arbitrator }; }
}
