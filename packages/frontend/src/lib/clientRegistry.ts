import { z } from "zod";

import clientRegistryData from "./clientRegistry.json";

export const CLIENT_ID_VALUES = [
  "opencode",
  "claude",
  "codex",
  "copilot",
  "gemini",
  "cursor",
  "amp",
  "codebuff",
  "droid",
  "openclaw",
  "hermes",
  "pi",
  "kimi",
  "qwen",
  "roocode",
  "kilo",
  "mux",
  "crush",
  "goose",
  "antigravity",
  "zed",
  "kiro",
  "synthetic",
] as const;

const LEGACY_CLIENT_ID_VALUES = ["kilocode"] as const;
const DISPLAY_CLIENT_ID_VALUES = [
  ...CLIENT_ID_VALUES,
  ...LEGACY_CLIENT_ID_VALUES,
] as const;

type ClientType = (typeof CLIENT_ID_VALUES)[number];
type LegacyClientId = (typeof LEGACY_CLIENT_ID_VALUES)[number];
type DisplayClientId = (typeof DISPLAY_CLIENT_ID_VALUES)[number];

function literalTuple<const T extends readonly [string, ...string[]]>(
  values: T
): [z.ZodLiteral<T[0]>, ...Array<z.ZodLiteral<T[number]>>] {
  return values.map((value) => z.literal(value)) as [
    z.ZodLiteral<T[0]>,
    ...Array<z.ZodLiteral<T[number]>>
  ];
}

function stringRecordShape<const T extends readonly [string, ...string[]]>(keys: T) {
  return Object.fromEntries(keys.map((key) => [key, z.string()])) as {
    [K in T[number]]: z.ZodString;
  };
}

function stringRecord<const T extends readonly [string, ...string[]]>(keys: T) {
  return z.object(stringRecordShape(keys)).strict();
}

const ClientRegistrySchema = z.object({
  clientIds: z.tuple(literalTuple(CLIENT_ID_VALUES)),
  legacyClientAliases: z.object({
    kilocode: z.literal("kilo"),
  }).strict(),
  sourceDisplayNames: stringRecord(DISPLAY_CLIENT_ID_VALUES),
  sourceLogos: stringRecord(DISPLAY_CLIENT_ID_VALUES),
  localSourceLogos: stringRecord(DISPLAY_CLIENT_ID_VALUES).partial(),
  sourceColors: stringRecord(DISPLAY_CLIENT_ID_VALUES),
  sourceTextColors: stringRecord(DISPLAY_CLIENT_ID_VALUES).partial(),
}).strict();

const registryData = ClientRegistrySchema.parse(clientRegistryData);

export const CLIENT_IDS = registryData.clientIds;
export { type ClientType };
export { type LegacyClientId };
export type { DisplayClientId };

export const LEGACY_CLIENT_ALIASES = registryData.legacyClientAliases;

export function normalizeClientId(id: string): string {
  return LEGACY_CLIENT_ALIASES[id as LegacyClientId] ?? id;
}

export const SOURCE_DISPLAY_NAMES = registryData.sourceDisplayNames;
export const SOURCE_LOGOS = registryData.sourceLogos;
export const LOCAL_SOURCE_LOGOS = registryData.localSourceLogos;
export const SOURCE_COLORS = registryData.sourceColors;
export const SOURCE_TEXT_COLORS = registryData.sourceTextColors;
