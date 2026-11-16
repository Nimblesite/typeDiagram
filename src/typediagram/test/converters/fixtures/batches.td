type Person {
  name: String
  age: Int
  active: Bool
  score: Float
  address: Option<Address>
  nickname: Option<String>
  contact: Contact
}

type Address {
  street: String
  zip: Int
}

union Contact {
  Email(EmailContact)
  Phone(PhoneContact)
}

type EmailContact {
  addr: String
}

type PhoneContact {
  number: Int
  country: Int
}

type PersonBatch {
  people: List<Person>
}

type ContactBatch {
  contacts: List<Contact>
}
