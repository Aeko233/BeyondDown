import { api, setToken } from "../api/client";
import type {
  AuthSuccessResponse,
  MeResponse,
  PollResponse,
  QrCodeResponse,
} from "../api/types";
import { state } from "../state";
import { byId } from "../ui/elements";
import { showLoginError } from "../ui/messages";

export async function refreshMe(): Promise<void> {
  try {
    const response = await api<MeResponse>("/api/auth/me");
    state.user = response.loggedIn ? response : null;
  } catch {
    state.user = null;
  }
  renderUser();
}

function renderUser(): void {
  byId<HTMLButtonElement>("btn-show-login").classList.toggle(
    "hidden",
    Boolean(state.user),
  );
  byId<HTMLDivElement>("user-chip").classList.toggle("hidden", !state.user);
  if (!state.user) return;
  byId<HTMLSpanElement>("user-name").textContent =
    state.user.uname || `UID ${state.user.uid}`;
  byId<HTMLSpanElement>("user-vip").classList.toggle("hidden", !state.user.vip);
}

async function startQrLogin(): Promise<void> {
  stopPolling();
  const qrCode = byId<HTMLDivElement>("qr-code");
  const qrStatus = byId<HTMLDivElement>("qr-status");
  qrCode.replaceChildren();
  qrStatus.textContent = "正在获取二维码…";

  try {
    const { qrUrl } = await api<QrCodeResponse>("/api/auth/qrcode", {
      method: "POST",
    });
    if (window.QRCode) {
      new window.QRCode(qrCode, { text: qrUrl, width: 180, height: 180 });
    } else {
      const link = document.createElement("a");
      link.href = qrUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.style.color = "#333";
      link.textContent = "二维码加载失败，点此打开登录页";
      qrCode.replaceChildren(link);
    }
    qrStatus.textContent = "请使用 B站 App 扫码";
    syncPanelHeights();
    startPolling();
  } catch (error) {
    qrStatus.textContent = `获取二维码失败：${errorMessage(error)}`;
  }
}

function startPolling(): void {
  state.pollTimer = window.setInterval(async () => {
    try {
      const response = await api<PollResponse>("/api/auth/poll", {
        method: "POST",
      });
      const qrStatus = byId<HTMLDivElement>("qr-status");
      if (response.status === "waiting") return;
      if (response.status === "scanned") {
        qrStatus.textContent = "已扫码，请在手机上确认";
        return;
      }
      if (response.status === "expired") {
        qrStatus.textContent = "二维码已失效，请刷新";
        stopPolling();
        return;
      }
      if (response.status === "success") {
        stopPolling();
        qrStatus.textContent = "登录成功";
        closeLoginModal();
        await refreshMe();
      }
    } catch (error) {
      stopPolling();
      byId<HTMLDivElement>("qr-status").textContent =
        `轮询失败：${errorMessage(error)}`;
    }
  }, 2_000);
}

function stopPolling(): void {
  if (state.pollTimer === null) return;
  window.clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function submitCookieString(cookie: string): Promise<void> {
  const response = await api<AuthSuccessResponse>("/api/auth/cookie", {
    method: "POST",
    body: JSON.stringify({ cookie }),
  });
  if (response.status !== "success") return;
  closeLoginModal();
  await refreshMe();
}

export function parseCookieFile(source: string): string {
  const text = source.trim();
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .filter(isCookieEntry)
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");
    }
    if (isRecord(parsed)) {
      return Object.entries(parsed)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join("; ");
    }
  } catch {
    // Continue with Netscape cookies.txt parsing.
  }

  const pairs: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const columns = line.split("\t");
    if (columns.length >= 6) {
      pairs.push(`${columns.at(-2)}=${columns.at(-1)}`);
    } else if (line.includes("=")) {
      pairs.push(line.trim());
    }
  }
  return pairs.join("; ");
}

function syncPanelHeights(): void {
  const qr = byId<HTMLElement>("tab-qr");
  for (const name of ["qr", "paste", "file"] as const) {
    byId<HTMLElement>(`tab-${name}`).style.height = `${qr.offsetHeight}px`;
  }
}

function openLoginModal(): void {
  const modal = byId<HTMLElement>("login-card");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  byId<HTMLButtonElement>("btn-login-close").focus();
  if (!byId<HTMLDivElement>("qr-code").hasChildNodes()) void startQrLogin();
}

function closeLoginModal(): void {
  stopPolling();
  const modal = byId<HTMLElement>("login-card");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

export function bindAuthEvents(): void {
  byId<HTMLButtonElement>("btn-show-login").addEventListener("click", () => {
    openLoginModal();
  });

  byId<HTMLButtonElement>("btn-login-close").addEventListener("click", () => {
    closeLoginModal();
  });

  byId<HTMLElement>("login-card").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeLoginModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLoginModal();
  });

  byId<HTMLButtonElement>("btn-qr-refresh").addEventListener("click", () => {
    void startQrLogin();
  });

  byId<HTMLButtonElement>("btn-cookie-submit").addEventListener(
    "click",
    async () => {
      const input = byId<HTMLTextAreaElement>("cookie-input");
      const text = input.value.trim();
      if (!text) return showLoginError("请粘贴 Cookie 内容");
      const button = byId<HTMLButtonElement>("btn-cookie-submit");
      button.disabled = true;
      try {
        await submitCookieString(text);
        input.value = "";
      } catch (error) {
        showLoginError(errorMessage(error));
      } finally {
        button.disabled = false;
      }
    },
  );

  byId<HTMLButtonElement>("btn-file-submit").addEventListener(
    "click",
    async () => {
      const file = byId<HTMLInputElement>("cookie-file").files?.[0];
      if (!file) return showLoginError("请先选择文件");
      const button = byId<HTMLButtonElement>("btn-file-submit");
      button.disabled = true;
      try {
        const cookie = parseCookieFile(await file.text());
        if (!cookie) throw new Error("文件中未解析出 Cookie");
        await submitCookieString(cookie);
      } catch (error) {
        showLoginError(errorMessage(error));
      } finally {
        button.disabled = false;
      }
    },
  );

  byId<HTMLButtonElement>("btn-logout").addEventListener("click", async () => {
    setToken(null);
    await refreshMe();
  });

  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document
        .querySelectorAll(".tab")
        .forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      for (const name of ["qr", "paste", "file"]) {
        byId<HTMLElement>(`tab-${name}`).classList.toggle(
          "hidden",
          name !== tab.dataset.tab,
        );
      }
      if (
        tab.dataset.tab === "qr" &&
        !byId<HTMLDivElement>("qr-code").hasChildNodes()
      ) {
        void startQrLogin();
      }
    });
  });
}

function isCookieEntry(
  value: unknown,
): value is { name: string; value: unknown } {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    Object.hasOwn(value, "value")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
