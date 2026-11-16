// [CONV-RUST-TDBIN] [CONV-TS-TDBIN] Shared TDBIN record-layout allocator
// ([TDBIN-REC-ALLOC], [TDBIN-PRIM-OPTION]): the Rust and TypeScript codec
// generators MUST produce identical slot/bit numbers, so the cursor and every
// allocation rule live here and nowhere else. Bits are allocated first-fit
// into a shared bool bitset word ([TDBIN-WIRE-WORD]); words are the next free
// 64-bit data slot; Option<Uuid|Decimal> values take the next 128-bit-ALIGNED
// pair.

/** Mutable allocation state for one record's data and pointer sections. */
export interface LayoutCursor {
  dataSlot: number;
  ptrSlot: number;
  boolSlot: number | null;
  nextBoolBit: number;
}

/** A 1-bit allocation inside the shared bool bitset word. */
export interface BitSlot {
  slot: number;
  bit: number;
}

const BOOL_BITS_PER_WORD = 64;

export const newLayoutCursor = (): LayoutCursor => ({ dataSlot: 0, ptrSlot: 0, boolSlot: null, nextBoolBit: 0 });

/** First-fit 1-bit allocation: reuse the open bitset word, else open a new one. */
export const allocateBit = (cursor: LayoutCursor): BitSlot => {
  let slot = cursor.boolSlot;
  if (slot === null || cursor.nextBoolBit >= BOOL_BITS_PER_WORD) {
    slot = cursor.dataSlot;
    cursor.boolSlot = slot;
    cursor.dataSlot = cursor.dataSlot + 1;
    cursor.nextBoolBit = 0;
  }
  const bit = cursor.nextBoolBit;
  cursor.nextBoolBit = bit + 1;
  return { slot, bit };
};

/** The next free 64-bit data word. */
export const allocateWord = (cursor: LayoutCursor): number => {
  const slot = cursor.dataSlot;
  cursor.dataSlot = slot + 1;
  return slot;
};

/** The next 16-byte pair at the current cursor (required semantic scalars). */
export const allocatePair = (cursor: LayoutCursor): number => {
  const slot = cursor.dataSlot;
  cursor.dataSlot = slot + 2;
  return slot;
};

/** The next free 128-bit-ALIGNED pair (`Option<Uuid|Decimal>` values). */
export const allocateAlignedPair = (cursor: LayoutCursor): number => {
  cursor.dataSlot = cursor.dataSlot + (cursor.dataSlot % 2);
  return allocatePair(cursor);
};

/** The next free pointer slot. */
export const allocatePtr = (cursor: LayoutCursor): number => {
  const slot = cursor.ptrSlot;
  cursor.ptrSlot = slot + 1;
  return slot;
};
