typeDiagram

  type User {
    id: Uuid
    name: String
    email: Option<Email>
    roles: List<Role>
    address: Address
  }

  type Address {
    line1: String
    city: String
    country: CountryCode
  }

  union Shape {
    Circle   { radius: Float }
    Square   { side: Float }
    Triangle { a: Float, b: Float, c: Float }
  }

  union Role {
    Admin
    Member
  }

  union Option<T> {
    Some { value: T }
    None
  }

  alias Email = String
  alias CountryCode = String
