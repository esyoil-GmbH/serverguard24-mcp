export type Config = { token: string; checkIds: number[] };

export function loadConfig(env: Record<string, string | undefined>): Config {
  const token = (env.SG24_API_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("SG24_API_TOKEN is not set. Set it to your ServerGuard24 API token.");
  }

  const checkIds: number[] = [];
  for (const part of (env.SG24_CHECK_IDS ?? "").split(",")) {
    const value = part.trim();
    if (value === "") continue;
    if (!/^\d+$/.test(value)) {
      throw new Error(
        `SG24_CHECK_IDS contains "${value}", which is not a check ID. Use comma-separated numbers, e.g. 123456,123457.`,
      );
    }
    const id = Number(value);
    if (!checkIds.includes(id)) checkIds.push(id);
  }

  return { token, checkIds };
}
