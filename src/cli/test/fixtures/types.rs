pub struct User {
    pub name: String,
    pub email: String,
    pub address: Address,
}

pub struct Address {
    pub line1: String,
    pub city: String,
    pub country: String,
}

pub enum Shape {
    Circle,
    Square,
    Triangle,
}
