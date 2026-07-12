import { describe, expect, it } from "vitest";
import { ok, type Result } from "../../src/result.js";
import * as tdbin from "../../src/tdbin/index.js";
import type { Reader, StructCodec, TdbinError, Writer } from "../../src/tdbin/index.js";
import { expectOk } from "./helpers.js";

interface Address {
  readonly street: string;
  readonly zip: number;
}

interface EmailContact {
  readonly addr: string;
}

interface PhoneContact {
  readonly number: number;
  readonly country: number;
}

type Contact =
  { readonly kind: "Email"; readonly _0: EmailContact } | { readonly kind: "Phone"; readonly _0: PhoneContact };

interface Person {
  readonly name: string;
  readonly age: number;
  readonly active: boolean;
  readonly score: number;
  readonly address: Address | undefined;
  readonly nickname: string | undefined;
  readonly contact: Contact;
}

const writeInt = (writer: Writer, at: number, slot: number, value: number): Result<void, TdbinError> => {
  const bits = tdbin.scalar.i64Bits(value);
  return bits.ok ? tdbin.writer.scalar(writer, at, slot, bits.value) : bits;
};

const readRequired = <T>(value: Result<T | null, TdbinError>): Result<T, TdbinError> =>
  value.ok && value.value !== null ? ok(value.value) : value.ok ? tdbin.readerError("UnexpectedNull") : value;

const AddressCodec: StructCodec<Address> = {
  dataWords: 1,
  ptrWords: 1,
  write: (writer, at, value) => {
    const street = tdbin.writer.string(writer, at, AddressCodec.dataWords, 0, value.street);
    return street.ok ? writeInt(writer, at, 0, value.zip) : street;
  },
  read: (reader, at) => {
    const street = readRequired(tdbin.reader.string(reader, at, AddressCodec.dataWords, 0));
    const zip = street.ok ? tdbin.reader.scalar(reader, at, 0) : street;
    return street.ok && zip.ok
      ? ok({ street: street.value, zip: tdbin.scalar.i64From(zip.value) })
      : street.ok
        ? zip
        : street;
  },
};

const EmailContactCodec: StructCodec<EmailContact> = {
  dataWords: 0,
  ptrWords: 1,
  write: (writer, at, value) => tdbin.writer.string(writer, at, EmailContactCodec.dataWords, 0, value.addr),
  read: (reader, at) => {
    const addr = readRequired(tdbin.reader.string(reader, at, EmailContactCodec.dataWords, 0));
    return addr.ok ? ok({ addr: addr.value }) : addr;
  },
};

const PhoneContactCodec: StructCodec<PhoneContact> = {
  dataWords: 2,
  ptrWords: 0,
  write: (writer, at, value) => {
    const number = writeInt(writer, at, 0, value.number);
    return number.ok ? writeInt(writer, at, 1, value.country) : number;
  },
  read: (reader, at) => {
    const number = tdbin.reader.scalar(reader, at, 0);
    const country = number.ok ? tdbin.reader.scalar(reader, at, 1) : number;
    return number.ok && country.ok
      ? ok({ number: tdbin.scalar.i64From(number.value), country: tdbin.scalar.i64From(country.value) })
      : number.ok
        ? country
        : number;
  },
};

const ContactCodec: StructCodec<Contact> = {
  dataWords: 1,
  ptrWords: 1,
  write: (writer, at, value) =>
    value.kind === "Email"
      ? writeContactArm(writer, at, 0, EmailContactCodec, value._0)
      : writeContactArm(writer, at, 1, PhoneContactCodec, value._0),
  read: (reader, at) => {
    const ordinal = tdbin.reader.scalar(reader, at, 0);
    return ordinal.ok ? readContactArm(reader, at, ordinal.value) : ordinal;
  },
};

const PersonCodec: StructCodec<Person> = {
  dataWords: 3,
  ptrWords: 4,
  write: (writer, at, value) => {
    const name = tdbin.writer.string(writer, at, PersonCodec.dataWords, 0, value.name);
    const age = name.ok ? writeInt(writer, at, 0, value.age) : name;
    const active = age.ok ? tdbin.writer.boolBit(writer, at, 1, 0, value.active) : age;
    const score = active.ok ? tdbin.writer.scalar(writer, at, 2, tdbin.scalar.f64Bits(value.score)) : active;
    const address = score.ok
      ? tdbin.writer.child(writer, at, PersonCodec.dataWords, 1, AddressCodec, value.address ?? null)
      : score;
    const nickname = address.ok
      ? tdbin.writer.string(writer, at, PersonCodec.dataWords, 2, value.nickname ?? null)
      : address;
    return nickname.ok
      ? tdbin.writer.child(writer, at, PersonCodec.dataWords, 3, ContactCodec, value.contact)
      : nickname;
  },
  read: (reader, at) => {
    const name = readRequired(tdbin.reader.string(reader, at, PersonCodec.dataWords, 0));
    const age = name.ok ? tdbin.reader.scalar(reader, at, 0) : name;
    const active = age.ok ? tdbin.reader.boolBit(reader, at, 1, 0) : age;
    const score = active.ok ? tdbin.reader.scalar(reader, at, 2) : active;
    const address = score.ok ? tdbin.reader.child(reader, at, PersonCodec.dataWords, 1, AddressCodec) : score;
    const nickname = address.ok ? tdbin.reader.string(reader, at, PersonCodec.dataWords, 2) : address;
    const contact = nickname.ok
      ? readRequired(tdbin.reader.child(reader, at, PersonCodec.dataWords, 3, ContactCodec))
      : nickname;
    return name.ok && age.ok && active.ok && score.ok && address.ok && nickname.ok && contact.ok
      ? ok(
          personFromParts(
            name.value,
            age.value,
            active.value,
            score.value,
            address.value,
            nickname.value,
            contact.value
          )
        )
      : contact.ok
        ? readError()
        : contact;
  },
};

const writeContactArm = <T>(writer: Writer, at: number, ordinal: number, codec: StructCodec<T>, value: T) => {
  const disc = tdbin.writer.scalar(writer, at, 0, BigInt(ordinal));
  return disc.ok ? tdbin.writer.child(writer, at, ContactCodec.dataWords, 0, codec, value) : disc;
};

const readContactArm = (reader: Reader, at: number, ordinal: bigint): Result<Contact, TdbinError> =>
  ordinal === 0n
    ? readContactPayload(reader, at, "Email", EmailContactCodec)
    : ordinal === 1n
      ? readContactPayload(reader, at, "Phone", PhoneContactCodec)
      : tdbin.readerError("UnknownVariant", { ordinal });

const readContactPayload = <K extends Contact["kind"], T>(
  reader: Reader,
  at: number,
  kind: K,
  codec: StructCodec<T>
): Result<{ readonly kind: K; readonly _0: T }, TdbinError> => {
  const payload = readRequired(tdbin.reader.child(reader, at, ContactCodec.dataWords, 0, codec));
  return payload.ok ? ok({ kind, _0: payload.value }) : payload;
};

const personFromParts = (
  name: string,
  ageWord: bigint,
  active: boolean,
  scoreWord: bigint,
  address: Address | null,
  nickname: string | null,
  contact: Contact
): Person => ({
  name,
  age: tdbin.scalar.i64From(ageWord),
  active,
  score: tdbin.scalar.f64From(scoreWord),
  address: address ?? undefined,
  nickname: nickname ?? undefined,
  contact,
});

const readError = (): Result<never, TdbinError> => tdbin.readerError("LimitExceeded");

const PERSON_FULL = {
  value: {
    name: "Grace Hopper",
    age: 85,
    active: true,
    score: 12.5,
    address: { street: "1 Compiler Rd", zip: 1906 },
    nickname: "Amazing Grace",
    contact: { kind: "Email", _0: { addr: "grace@navy.mil" } },
  } satisfies Person,
  hex: "00000000030004005500000000000000010000000000000000000000000029400d0000006200000010000000010001001d0000006a0000002000000001000100477261636520486f70706572000000007207000000000000010000006a0000003120436f6d70696c6572205264000000416d617a696e672047726163650000000000000000000000000000000000010001000000720000006772616365406e6176792e6d696c0000",
};

const PERSON_MINIMAL = {
  value: {
    name: "Edsger Dijkstra",
    age: 72,
    active: false,
    score: -3.0,
    address: undefined,
    nickname: undefined,
    contact: { kind: "Phone", _0: { number: 1930, country: 31 } },
  } satisfies Person,
  hex: "00000000030004004800000000000000000000000000000000000000000008c00d0000007a0000000000000000000000000000000000000008000000010001004564736765722044696a6b7374726100010000000000000000000000020000008a070000000000001f00000000000000",
};

const CONTACT_EMAIL = {
  value: { kind: "Email", _0: { addr: "ada@analytical.uk" } } satisfies Contact,
  hex: "000000000100010000000000000000000000000000000100010000008a00000061646140616e616c79746963616c2e756b00000000000000",
};

const CONTACT_PHONE = {
  value: { kind: "Phone", _0: { number: 1815, country: 44 } } satisfies Contact,
  hex: "00000000010001000100000000000000000000000200000017070000000000002c00000000000000",
};

const assertGolden = <T>(codec: StructCodec<T>, value: T, hex: string) => {
  const bytes = expectOk(tdbin.encode(codec, value));
  expect(tdbin.toHex(bytes)).toBe(hex);
  expect(expectOk(tdbin.decode(codec, expectOk(tdbin.fromHex(hex))))).toEqual(value);
};

describe("[TDBIN-FUTURE-TS] TypeScript runtime golden conformance", () => {
  it("matches the Rust Person and Contact frozen golden vectors byte-for-byte", () => {
    assertGolden(PersonCodec, PERSON_FULL.value, PERSON_FULL.hex);
    assertGolden(PersonCodec, PERSON_MINIMAL.value, PERSON_MINIMAL.hex);
    assertGolden(ContactCodec, CONTACT_EMAIL.value, CONTACT_EMAIL.hex);
    assertGolden(ContactCodec, CONTACT_PHONE.value, CONTACT_PHONE.hex);
  });

  it("decodes framed and packed framed messages from the bytes", () => {
    const framed = expectOk(tdbin.encodeFramed(PersonCodec, PERSON_FULL.value, 0xdecafn));
    const packed = expectOk(tdbin.encodePackedFramed(PersonCodec, PERSON_FULL.value, 0xdecafn));
    expect(expectOk(tdbin.decodeAuto(PersonCodec, framed))).toEqual(PERSON_FULL.value);
    expect(expectOk(tdbin.decodeAuto(PersonCodec, packed))).toEqual(PERSON_FULL.value);
  });
});
