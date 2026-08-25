import { describe, expect, it } from "vitest";

import { AOP_PROTOCOL_VERSION } from "./index.js";

describe("AOP protocol package", () => {
  it("exports the protocol version", () => {
    expect(AOP_PROTOCOL_VERSION).toBe("0.1.0");
  });
});
