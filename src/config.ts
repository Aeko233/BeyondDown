export interface AppConfig {
  api_base?: string;
  aria2_rpc?: string;
}

let config: AppConfig = {};

export function parseSimpleToml(text: string): AppConfig {
  const parsed: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const source = line.trim();
    if (!source || source.startsWith("#")) continue;
    const match = source.match(
      /^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))$/,
    );
    if (match) parsed[match[1]] = match[2] ?? match[3] ?? match[4];
  }
  return parsed;
}

export async function loadConfig(): Promise<void> {
  if (import.meta.env.DEV) {
    config = { api_base: "" };
    return;
  }

  try {
    const response = await fetch("/config.toml", { cache: "no-store" });
    if (!response.ok) return;
    config = parseSimpleToml(await response.text());
  } catch {
    // 配置不可用时走默认同源 API，仍可正常使用。
  }
}

export function getConfig(): Readonly<AppConfig> {
  return config;
}
