import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const values = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values }));
  const generateDeviceCode = vi.fn(() => "device-code-123");
  const generateUserCode = vi.fn(() => "ABCD-EFGH");

  return {
    values,
    insert,
    generateDeviceCode,
    generateUserCode,
    reset() {
      values.mockClear();
      insert.mockClear();
      generateDeviceCode.mockClear();
      generateUserCode.mockClear();
    },
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    insert: mockState.insert,
  },
  deviceCodes: {},
}));

vi.mock("@/lib/auth/utils", () => ({
  generateDeviceCode: mockState.generateDeviceCode,
  generateUserCode: mockState.generateUserCode,
}));

vi.mock("@/lib/auth/device", async () => {
  return await import("../../src/lib/auth/device");
});

type ModuleExports = typeof import("../../src/app/api/auth/device/route");

let POST: ModuleExports["POST"];
let originalBaseUrl: string | undefined;

beforeAll(async () => {
  ({ POST } = await import("../../src/app/api/auth/device/route"));
});

beforeEach(() => {
  mockState.reset();
  originalBaseUrl = process.env.NEXT_PUBLIC_URL;
  process.env.NEXT_PUBLIC_URL = "https://tokscale.ai";
});

afterEach(() => {
  if (originalBaseUrl === undefined) {
    delete process.env.NEXT_PUBLIC_URL;
  } else {
    process.env.NEXT_PUBLIC_URL = originalBaseUrl;
  }
});

describe("POST /api/auth/device", () => {
  it("returns a complete verification URL with the user code prefilled", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceName: "CLI on test-host" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mockState.values).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceCode: "device-code-123",
        userCode: "ABCD-EFGH",
        deviceName: "CLI on test-host",
      })
    );

    await expect(response.json()).resolves.toMatchObject({
      deviceCode: "device-code-123",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://tokscale.ai/device",
      verificationUrlComplete: "https://tokscale.ai/device?code=ABCD-EFGH",
      expiresIn: 900,
      interval: 5,
    });
  });

  it("uses the default device name when none is provided", async () => {
    await POST(
      new Request("http://localhost/api/auth/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );

    expect(mockState.values).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceName: "Unknown Device",
      })
    );
  });
});
