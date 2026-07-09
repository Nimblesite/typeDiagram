// [CLI-IO] Stdin read paths are Result-returning and never throw.
import { describe, expect, it, vi } from "vitest";
import { readSource } from "../src/io.js";

describe("[CLI-IO] readSource", () => {
  it("returns stdin stream errors as Result errors", async () => {
    const on = vi.spyOn(process.stdin, "on").mockImplementation((eventName, listener) => {
      if (eventName === "error") {
        listener(new Error("broken pipe"));
      }
      return process.stdin;
    });

    const result = await readSource(null);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toBe("stdin error: broken pipe");
    expect(on).toHaveBeenCalledWith("data", expect.any(Function));
    expect(on).toHaveBeenCalledWith("end", expect.any(Function));
    expect(on).toHaveBeenCalledWith("error", expect.any(Function));
    on.mockRestore();
  });
});
