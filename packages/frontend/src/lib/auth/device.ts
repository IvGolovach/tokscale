export function normalizeDeviceCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export function formatDeviceCode(value: string): string {
  const normalized = normalizeDeviceCode(value);
  if (normalized.length <= 4) {
    return normalized;
  }

  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function buildDeviceVerificationUrl(baseUrl: string, userCode: string): string {
  const url = new URL("/device", baseUrl);
  url.searchParams.set("code", formatDeviceCode(userCode));
  return url.toString();
}

export function buildDeviceReturnPath(userCode: string): string {
  const formatted = formatDeviceCode(userCode);
  if (!formatted) {
    return "/device";
  }

  const params = new URLSearchParams({ code: formatted });
  return `/device?${params.toString()}`;
}
