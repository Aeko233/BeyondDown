import { api } from "../api/client";
import type { DashTrack, PlayurlResponse, VideoResponse } from "../api/types";
import { state } from "../state";
import { byId } from "../ui/elements";
import { fail } from "../ui/messages";

const HTTPS_SCHEME = "https://";
const BVID_PATTERN = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;

const QUALITY_LABELS: Record<number, string> = {
  127: "8K 超高清",
  126: "杜比视界",
  125: "HDR 真彩",
  120: "4K 超清",
  116: "1080P 60帧",
  112: "1080P 高码率",
  100: "智能修复",
  80: "1080P 高清",
  74: "720P 60帧",
  64: "720P 高清",
  32: "480P 清晰",
  16: "360P 流畅",
};

export function qualityLabel(id: number): string {
  return QUALITY_LABELS[id] || `品质 ${id}`;
}

export async function parseVideo(): Promise<void> {
  const input = normalizeVideoInput(
    byId<HTMLInputElement>("video-input").value.trim(),
  );
  if (!input) return;

  const button = byId<HTMLButtonElement>("btn-parse");
  button.disabled = true;
  try {
    const query = input.startsWith("http")
      ? `url=${encodeURIComponent(input)}`
      : `bvid=${encodeURIComponent(input)}`;
    const response = await api<VideoResponse>(`/api/video?${query}`);
    state.video = response.video;
    state.play = null;
    renderVideo(response.loggedIn);
  } catch (error) {
    fail(error);
  } finally {
    button.disabled = false;
  }
}

function normalizeVideoInput(input: string): string {
  if (
    input &&
    !BVID_PATTERN.test(input) &&
    /bilibili\.com|b23\.tv/.test(input) &&
    !/^https?:\/\//.test(input)
  ) {
    return HTTPS_SCHEME + input;
  }
  return input;
}

function renderVideo(loggedIn: boolean): void {
  const video = state.video;
  if (!video) return;

  byId<HTMLElement>("video-card").classList.remove("hidden");
  byId<HTMLElement>("tracks-card").classList.add("hidden");
  byId<HTMLHeadingElement>("v-title").textContent = video.title;
  byId<HTMLDivElement>("v-owner").textContent = `UP主：${video.owner.name || "-"}`;
  byId<HTMLDivElement>("v-stat").textContent =
    `播放 ${formatCount(video.stat.view)} · 弹幕 ${formatCount(video.stat.danmaku)} · ` +
    `点赞 ${formatCount(video.stat.like)} · 收藏 ${formatCount(video.stat.favorite)} · ` +
    `时长 ${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, "0")}`;
  byId<HTMLDivElement>("v-desc").textContent = video.desc || "";

  const pageSelect = byId<HTMLSelectElement>("page-select");
  pageSelect.replaceChildren();
  for (const page of video.pages) {
    const option = document.createElement("option");
    option.value = String(page.cid);
    option.textContent =
      video.pages.length > 1 ? `P${page.page} ${page.part}` : "P1";
    pageSelect.append(option);
  }
  byId<HTMLDivElement>("page-row").classList.toggle(
    "hidden",
    video.pages.length <= 1,
  );
  byId<HTMLSpanElement>("login-note").textContent = loggedIn
    ? "已登录：将获取账号权限内的最高清晰度"
    : "未登录：清晰度受限，登录后可获取更高清晰度";
}

export async function loadPlayurl(): Promise<void> {
  const video = state.video;
  if (!video) return;

  const cid = byId<HTMLSelectElement>("page-select").value || video.pages[0]?.cid;
  if (!cid) return fail("视频没有可用分P");
  const button = byId<HTMLButtonElement>("btn-playurl");
  button.disabled = true;
  button.textContent = "获取中…";
  try {
    const play = await api<PlayurlResponse>(
      `/api/playurl?bvid=${video.bvid}&cid=${cid}&qn=127`,
    );
    if (!play.dash) throw new Error("该视频未返回 DASH 轨道");
    state.play = play;
    renderTracks(play.dash);
    byId<HTMLElement>("tracks-card").classList.remove("hidden");
  } catch (error) {
    fail(error);
  } finally {
    button.disabled = false;
    button.textContent = "获取播放地址";
  }
}

function renderTracks(dash: NonNullable<PlayurlResponse["dash"]>): void {
  const videoSelect = byId<HTMLSelectElement>("video-track-select");
  videoSelect.replaceChildren();
  const seen = new Set<string>();
  for (const track of dash.video) {
    const duplicateKey = `${track.id}-${track.codecs}`;
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);

    const option = document.createElement("option");
    option.value = String(track.id);
    option.dataset.codecs = track.codecs;
    option.textContent = videoTrackLabel(track);
    videoSelect.append(option);
  }
  videoSelect.value = String(dash.video[0]?.id || "");

  const audioSelect = byId<HTMLSelectElement>("audio-track-select");
  audioSelect.replaceChildren();
  const audioTracks = [
    ...(dash.audio || []),
    ...(dash.dolby || []),
    ...(dash.flac ? [dash.flac] : []),
  ];
  for (const track of audioTracks) {
    const option = document.createElement("option");
    option.value = String(track.id);
    option.textContent = audioTrackLabel(track);
    audioSelect.append(option);
  }

  const bestAudio = [...(dash.audio || [])].sort(
    (left, right) => right.bandwidth - left.bandwidth,
  )[0];
  if (bestAudio) audioSelect.value = String(bestAudio.id);
}

function videoTrackLabel(track: DashTrack): string {
  const codec = codecName(track.codecs);
  const height = track.height ? ` · ${track.height}p` : "";
  const frameRate = track.frameRate ? `@${track.frameRate}` : "";
  return `${qualityLabel(track.id)} · ${codec} · ${Math.round(track.bandwidth / 1_000)}kbps${height}${frameRate}`;
}

function codecName(codecs: string): string {
  if (codecs.includes("avc")) return "H.264";
  if (codecs.includes("hvc") || codecs.includes("hev")) return "H.265";
  if (codecs.includes("av01")) return "AV1";
  return codecs;
}

function audioTrackLabel(track: DashTrack): string {
  const names: Record<number, string> = {
    30216: "64kbps",
    30280: "132kbps",
    30232: "192kbps",
    30250: "杜比全景声",
    30251: "Hi-Res 无损",
  };
  return `${names[track.id] || `音轨 ${track.id}`} · ${Math.round(track.bandwidth / 1_000)}kbps`;
}

function formatCount(value?: number): string {
  if (value == null) return "-";
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(1)}万`;
  return String(value);
}

export function bindVideoEvents(): void {
  byId<HTMLButtonElement>("btn-parse").addEventListener("click", () => {
    void parseVideo();
  });
  byId<HTMLInputElement>("video-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") void parseVideo();
  });
  byId<HTMLButtonElement>("btn-playurl").addEventListener("click", () => {
    void loadPlayurl();
  });
}
