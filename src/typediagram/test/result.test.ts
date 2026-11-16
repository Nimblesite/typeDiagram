// [RESULT-TEST] Tests for result.ts utility functions.
import { describe, expect, it } from "vitest";
import { ok, err, isOk, isErr, map, mapErr, andThen, andThenAsync, unwrap } from "../src/result.js";

describe("[RESULT] ok/err constructors", () => {
  it("ok creates a result with ok: true", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toBe(42);
  });

  it("err creates a result with ok: false", () => {
    const r = err("fail");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("fail");
  });
});

describe("[RESULT-ISOK] isOk", () => {
  it("returns true for ok", () => {
    expect(isOk(ok(1))).toBe(true);
  });
  it("returns false for err", () => {
    expect(isOk(err("x"))).toBe(false);
  });
});

describe("[RESULT-ISERR] isErr", () => {
  it("returns true for err", () => {
    expect(isErr(err("x"))).toBe(true);
  });
  it("returns false for ok", () => {
    expect(isErr(ok(1))).toBe(false);
  });
});

describe("[RESULT-MAP] map", () => {
  it("transforms the value of an ok result", () => {
    const r = map(ok(2), (n) => n * 3);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toBe(6);
  });
  it("passes through an err result unchanged", () => {
    const r = map(err("oops"), (n: number) => n * 3);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("oops");
  });
});

describe("[RESULT-MAPERR] mapErr", () => {
  it("transforms the error of an err result", () => {
    const r = mapErr(err("bad"), (e) => e.toUpperCase());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("BAD");
  });
  it("passes through an ok result unchanged", () => {
    const r = mapErr(ok(42), (e: string) => e.toUpperCase());
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toBe(42);
  });
});

describe("[RESULT-ANDTHEN] andThen", () => {
  it("chains ok results", () => {
    const r = andThen(ok(2), (n) => ok(n + 10));
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toBe(12);
  });
  it("short-circuits on err", () => {
    const r = andThen(err("fail"), (_n: number) => ok(99));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("fail");
  });
  it("propagates error from chained function", () => {
    const r = andThen(ok(2), (_n) => err("chained-fail"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("chained-fail");
  });
});

describe("[RESULT-ANDTHENASYNC] andThenAsync", () => {
  it("chains async ok results", async () => {
    const r = await andThenAsync(ok(5), (n) => Promise.resolve(ok(n * 2)));
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toBe(10);
  });
  it("short-circuits on err", async () => {
    const r = await andThenAsync(err("nope"), (_n: number) => Promise.resolve(ok(99)));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("nope");
  });
});

describe("[RESULT-UNWRAP] unwrap", () => {
  it("returns the value for ok", () => {
    expect(unwrap(ok(42))).toBe(42);
  });
  it("throws for err", () => {
    expect(() => unwrap(err("boom"))).toThrow("unwrap on err");
  });
});
