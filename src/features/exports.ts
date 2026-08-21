import { api, apiUrl, authHeaders } from "../api/client";
import type {
  Aria2ExportResponse,
  RawExportResponse,
  StreamResponse,
  YtdlpExportResponse,
} from "../api/types";
import { getConfig } from "../config";
import { state } from "../state";
import { byId } from "../ui/elements";
import { copyText, fail, showResult } from "../ui/messages";

const PCDN_BLACKLIST = ["mcdn", "pcdn", "szbdyd.com", "mountaintoys.cn"];
const ARIA2_DEFAULT_RPC = "http://localhost:6800/jsonrpc";

type ScriptFormat = "bat" | "sh";
type ExportFormat = ScriptFormat | "raw" | "aria2" | "ytdlp";

function selectedCid(): string | null {
  const video = state.video;
  if (!video) return null;
  return (
    byId<HTMLSelectElement>("page-select").value ||
    String(video.pages[0]?.cid || "") ||
    null
  );
}

function exportParams(format: ExportFormat): string {
  const video = state.video;
  const cid = selectedCid();
  if (!video || !cid) throw new Error("请先解析视频并选择分P");

  const params = new URLSearchParams({
    bvid: video.bvid,
    cid,
    qn: String(state.play?.quality || 127),
    videoId: byId<HTMLSelectElement>("video-track-select").value,
    format,
  });
  const audioId = byId<HTMLSelectElement>("audio-track-select").value;
  if (audioId) params.set("audioId", audioId);
  return params.toString();
}

async function exportScript(format: ScriptFormat): Promise<void> {
  try {
    const response = await fetch(
      apiUrl(`/api/download/export?${exportParams(format)}`),
      { headers: authHeaders() },
    );
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    const contentDisposition =
      response.headers.get("content-disposition") || "";
    const match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/);
    const name = match ? decodeURIComponent(match[1]) : `beyonddown.${format}`;
    const blob = new Blob([await response.text()], {
      type:
        format === "sh"
          ? "text/x-shellscript;charset=utf-8"
          : "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    fail(error);
  }
}

function filterPcdn(urls: string[] | undefined): string[] {
  if (!urls) return [];
  const filtered = urls.filter((url) => {
    try {
      const host = new URL(url).hostname;
      return !PCDN_BLACKLIST.some((domain) => host.includes(domain));
    } catch {
      return true;
    }
  });
  return filtered.length ? filtered : urls;
}

async function exportYtdlp(): Promise<void> {
  try {
    const { direct, pageUrl } = await api<YtdlpExportResponse>(
      `/api/download/export?${exportParams("ytdlp")}`,
    );
    await copyText(
      `直链命令（含所选轨道，需 ffmpeg 合并时自行处理）：\n${direct}\n\n` +
        `或直接用页面地址让 yt-dlp 自行解析（登录态来自你自己的浏览器）：\n${pageUrl}`,
    );
  } catch (error) {
    fail(error);
  }
}

async function exportRaw(): Promise<void> {
  try {
    const { title, headers, video, audio } = await api<RawExportResponse>(
      `/api/download/export?${exportParams("raw")}`,
    );
    const videoBackups = filterPcdn(video.backupUrl);
    const audioBackups = filterPcdn(audio?.backupUrl);
    let text =
      `# ${title}\n# 必须携带的请求头：\n# Referer: ${headers.Referer}\n` +
      `# User-Agent: ${headers["User-Agent"]}\n\n视频轨：\n${video.baseUrl}\n`;
    if (videoBackups.length) text += `备用：\n${videoBackups.join("\n")}\n`;
    if (audio) {
      text += `\n音频轨：\n${audio.baseUrl}\n`;
      if (audioBackups.length) text += `备用：\n${audioBackups.join("\n")}\n`;
    }
    await copyText(text);
  } catch (error) {
    fail(error);
  }
}

interface Aria2Config {
  rpc: string;
  secret: string;
}

function getAria2Config(): Aria2Config {
  const rpc =
    byId<HTMLInputElement>("aria2-rpc").value.trim() ||
    getConfig().aria2_rpc ||
    ARIA2_DEFAULT_RPC;
  const secret = byId<HTMLInputElement>("aria2-secret").value.trim();
  localStorage.setItem("aria2.conf", JSON.stringify({ rpc, secret }));
  return { rpc, secret };
}

function restoreAria2Config(): void {
  try {
    const config = JSON.parse(
      localStorage.getItem("aria2.conf") || "{}",
    ) as Partial<Aria2Config>;
    if (config.rpc) byId<HTMLInputElement>("aria2-rpc").value = config.rpc;
    if (config.secret) {
      byId<HTMLInputElement>("aria2-secret").value = config.secret;
    }
  } catch {
    // Ignore invalid local settings and keep the configured defaults.
  }
}

async function exportAria2(): Promise<void> {
  const { rpc, secret } = getAria2Config();
  try {
    const { title, tasks } = await api<Aria2ExportResponse>(
      `/api/download/export?${exportParams("aria2")}`,
    );
    const batch = tasks.map((task, index) => ({
      jsonrpc: "2.0",
      id: `beyonddown-${Date.now()}-${index}`,
      method: "aria2.addUri",
      params: [
        `token:${secret}`,
        [task.url],
        { out: task.out, header: task.header },
      ],
    }));
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
    });
    const output: unknown = await response.json().catch(() => ({}));
    if (!isSuccessfulAria2Batch(output)) {
      throw new Error(aria2ErrorMessage(output));
    }
    showResult(
      `已发送到 aria2：${title}\n${tasks.map((task) => `· ${task.out}`).join("\n")}\n` +
        "下载完成后请手动执行 ffmpeg 合并（音视频两文件）。",
    );
  } catch (error) {
    showResult(
      `发送到 aria2 失败：${errorMessage(error)}\n` +
        "请确认 aria2 已以 --enable-rpc --rpc-allow-origin-all 启动，且 RPC 地址与 secret 正确。",
    );
  }
}

async function exportStream(): Promise<void> {
  const video = state.video;
  const cid = selectedCid();
  if (!video || !cid) return;

  const button = byId<HTMLButtonElement>("btn-export-stream");
  button.disabled = true;
  try {
    const response = await api<StreamResponse>(
      `/api/download/stream?bvid=${video.bvid}&cid=${cid}&qn=${state.play?.quality || 64}`,
    );
    const backups = filterPcdn(response.video.backupUrl);
    let text =
      `# ${response.title}（清晰度 ${response.quality}）\n# 必须携带的请求头：\n` +
      `# Referer: ${response.headers.Referer}\n# User-Agent: ${response.headers["User-Agent"]}\n\n` +
      `直链：\n${response.video.baseUrl}\n`;
    if (backups.length) text += `\n备用：\n${backups.join("\n")}\n`;
    await copyText(text);
  } catch (error) {
    fail(error);
  } finally {
    button.disabled = false;
  }
}

export function bindExportEvents(): void {
  restoreAria2Config();
  byId<HTMLButtonElement>("btn-export-bat").addEventListener("click", () => {
    void exportScript("bat");
  });
  byId<HTMLButtonElement>("btn-export-sh").addEventListener("click", () => {
    void exportScript("sh");
  });
  byId<HTMLButtonElement>("btn-export-stream").addEventListener("click", () => {
    void exportStream();
  });
  byId<HTMLButtonElement>("btn-export-ytdlp").addEventListener("click", () => {
    void exportYtdlp();
  });
  byId<HTMLButtonElement>("btn-export-raw").addEventListener("click", () => {
    void exportRaw();
  });
  byId<HTMLButtonElement>("btn-export-aria2").addEventListener("click", () => {
    void exportAria2();
  });
  byId<HTMLButtonElement>("btn-more-options").addEventListener("click", () => {
    const panel = byId<HTMLDivElement>("more-options");
    const hidden = panel.classList.toggle("hidden");
    byId<HTMLButtonElement>("btn-more-options").textContent = hidden
      ? "更多选项"
      : "收起";
    if (hidden) {
      byId<HTMLDivElement>("export-result").classList.add("hidden");
    }
  });
}

function isSuccessfulAria2Batch(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => !hasError(item));
}

function hasError(value: unknown): boolean {
  return typeof value === "object" && value !== null && "error" in value;
}

function aria2ErrorMessage(value: unknown): string {
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0] as { error?: { message?: string } };
    if (first.error?.message) return first.error.message;
  }
  return JSON.stringify(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
