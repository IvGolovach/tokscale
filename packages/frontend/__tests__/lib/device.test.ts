import { describe, expect, it } from "vitest";
import {
  buildDeviceReturnPath,
  buildDeviceVerificationUrl,
  formatDeviceCode,
  normalizeDeviceCode,
} from "../../src/lib/auth/device";

describe("device auth helpers", () => {
  it("normalizes device codes to uppercase alphanumeric", () => {
    expect(normalizeDeviceCode("ab-cd 1234!!")).toBe("ABCD1234");
  });

  it("formats normalized device codes with a dash", () => {
    expect(formatDeviceCode("abcd1234")).toBe("ABCD-1234");
    expect(formatDeviceCode("abcd")).toBe("ABCD");
  });

  it("truncates device codes to eight characters", () => {
    expect(formatDeviceCode("abcd1234wxyz")).toBe("ABCD-1234");
  });

  it("builds a return path with a formatted code", () => {
    expect(buildDeviceReturnPath("abcd1234")).toBe("/device?code=ABCD-1234");
    expect(buildDeviceReturnPath("")).toBe("/device");
  });

  it("builds a complete verification URL with the code prefilled", () => {
    expect(buildDeviceVerificationUrl("https://tokscale.ai", "abcd1234")).toBe(
      "https://tokscale.ai/device?code=ABCD-1234"
    );
  });
});
