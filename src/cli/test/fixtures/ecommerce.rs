pub struct Customer {
    pub id: String,
    pub name: String,
    pub email: String,
    pub addresses: Vec<Address>,
    pub payment_methods: Vec<PaymentMethod>,
    pub loyalty_tier: LoyaltyTier,
}

pub struct Address {
    pub line1: String,
    pub line2: Option<String>,
    pub city: String,
    pub state: String,
    pub zip: String,
    pub country: String,
}

pub struct Product {
    pub sku: String,
    pub name: String,
    pub description: String,
    pub price: Money,
    pub category: Category,
    pub inventory: InventoryStatus,
    pub tags: Vec<String>,
}

pub struct Money {
    pub amount: f64,
    pub currency: String,
}

pub struct Order {
    pub id: String,
    pub customer: Customer,
    pub items: Vec<LineItem>,
    pub shipping: Address,
    pub billing: Address,
    pub payment: PaymentMethod,
    pub status: OrderStatus,
    pub total: Money,
    pub discount: Option<Discount>,
}

pub struct LineItem {
    pub product: Product,
    pub quantity: u32,
    pub unit_price: Money,
    pub subtotal: Money,
}

pub struct Discount {
    pub code: String,
    pub kind: DiscountKind,
    pub amount: Money,
}

pub enum DiscountKind {
    Percentage(f64),
    FixedAmount(Money),
    BuyOneGetOne,
    FreeShipping,
}

pub struct CreditCard {
    pub last_four: String,
    pub brand: String,
    pub expiry: String,
}

pub struct BankTransfer {
    pub iban: String,
    pub bic: String,
}

pub enum PaymentMethod {
    Credit(CreditCard),
    Bank(BankTransfer),
    Wallet(String),
    CashOnDelivery,
}

pub struct ShipmentInfo {
    pub tracking_id: String,
    pub carrier: String,
}

pub struct RefundInfo {
    pub refund_id: String,
    pub amount: Money,
}

pub enum OrderStatus {
    Pending,
    Confirmed,
    Processing,
    Shipped(ShipmentInfo),
    Delivered,
    Cancelled(String),
    Refunded(RefundInfo),
}

pub enum Category {
    Electronics,
    Clothing,
    Food,
    Books,
    Home,
    Sports,
}

pub enum InventoryStatus {
    InStock(u32),
    LowStock(u32),
    OutOfStock,
    Discontinued,
}

pub enum LoyaltyTier {
    Bronze,
    Silver,
    Gold,
    Platinum,
}
