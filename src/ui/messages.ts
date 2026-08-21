import { byId } from "./elements";

export function showLoginError(message: string): void {
  const target = byId<HTMLDivElement>("login-error");
  target.textContent = message;
  target.classList.remove("hidden");
}

export function showResult(text: string): void {
  const target = byId<HTMLDivElement>("export-result");
  target.textContent = text;
  target.classList.remove("hidden");
}

export function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  showResult(`错误：${message}`);
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showResult(`已复制到剪贴板：\n${text}`);
  } catch {
    showResult(`复制失败，请手动复制：\n${text}`);
  }
}
