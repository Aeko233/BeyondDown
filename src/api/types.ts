export interface ApiErrorResponse {
  error?: string;
}

export interface TokenResponse {
  token?: string;
}

export interface User {
  loggedIn: true;
  uid: number | null;
  uname: string;
  vip: boolean;
}

export interface LoggedOutUser {
  loggedIn: false;
}

export type MeResponse = User | LoggedOutUser;

export interface AuthSuccessResponse extends TokenResponse {
  status: "success";
}

export interface QrCodeResponse extends TokenResponse {
  qrUrl: string;
  expiresIn: number;
}

export interface PollResponse extends TokenResponse {
  status: "waiting" | "scanned" | "expired" | "success" | "unknown";
  message?: string;
}

export interface VideoPage {
  page: number;
  part: string;
  cid: number;
  duration: number;
}

export interface VideoInfo {
  bvid: string;
  aid: number;
  title: string;
  desc: string;
  duration: number;
  owner: { mid?: number; name?: string };
  stat: {
    view?: number;
    danmaku?: number;
    favorite?: number;
    like?: number;
  };
  pages: VideoPage[];
}

export interface VideoResponse extends TokenResponse {
  video: VideoInfo;
  loggedIn: boolean;
}

export interface DashTrack {
  id: number;
  kind: string;
  baseUrl: string;
  backupUrl: string[];
  bandwidth: number;
  codecs: string;
  height: number | null;
  frameRate: string | number | null;
}

export interface PlayurlResponse extends TokenResponse {
  quality: number;
  dash: {
    video: DashTrack[];
    audio?: DashTrack[];
    dolby?: DashTrack[];
    flac?: DashTrack | null;
  } | null;
}

export interface DownloadHeaders {
  Referer: string;
  "User-Agent": string;
}

export interface DownloadTrack {
  baseUrl: string;
  backupUrl?: string[];
}

export interface RawExportResponse extends TokenResponse {
  title: string;
  headers: DownloadHeaders;
  video: DownloadTrack;
  audio: DownloadTrack | null;
}

export interface YtdlpExportResponse extends TokenResponse {
  direct: string;
  pageUrl: string;
}

export interface Aria2Task {
  url: string;
  out: string;
  header: string[];
}

export interface Aria2ExportResponse extends TokenResponse {
  title: string;
  tasks: Aria2Task[];
  mergeCommand: string;
}

export interface StreamResponse extends TokenResponse {
  title: string;
  quality: number;
  headers: DownloadHeaders;
  video: DownloadTrack;
}
