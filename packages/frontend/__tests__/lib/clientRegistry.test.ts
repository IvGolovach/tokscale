import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CLIENT_IDS,
  LEGACY_CLIENT_ALIASES,
  LOCAL_SOURCE_LOGOS,
  normalizeClientId,
} from "../../src/lib/clientRegistry";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_PUBLIC_DIR = path.resolve(TEST_DIR, "../../public");

describe("clientRegistry", () => {
  it("normalizes legacy client ids to canonical ids", () => {
    expect(LEGACY_CLIENT_ALIASES.kilocode).toBe("kilo");
    expect(normalizeClientId("kilocode")).toBe("kilo");
    expect(normalizeClientId("kilo")).toBe("kilo");
  });

  it("exports unique canonical client ids", () => {
    expect(new Set(CLIENT_IDS).size).toBe(CLIENT_IDS.length);
  });

  it("points local logo entries to files that exist under public/assets", () => {
    for (const assetPath of Object.values(LOCAL_SOURCE_LOGOS)) {
      const absolutePath = path.join(
        FRONTEND_PUBLIC_DIR,
        assetPath.replace(/^\//, "")
      );
      expect(
        existsSync(absolutePath),
        `missing local logo asset: ${absolutePath}`
      ).toBe(true);
    }
  });
});
