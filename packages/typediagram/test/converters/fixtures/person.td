type Address {
  street: String
  zip: Int
}
type EmailContact {
  addr: String
}
type PhoneContact {
  number: Int
  country: Int
}
union Contact {
  Email(EmailContact)
  Phone(PhoneContact)
}
type Person {
  name: String
  age: Int
  active: Bool
  score: Float
  address: Option<Address>
  nickname: Option<String>
  contact: Contact
}
