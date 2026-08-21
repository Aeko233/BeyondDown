import type { PlayurlResponse, User, VideoInfo } from "./api/types";

export interface AppState {
  user: User | null;
  video: VideoInfo | null;
  play: PlayurlResponse | null;
  pollTimer: number | null;
}

export const state: AppState = {
  user: null,
  video: null,
  play: null,
  pollTimer: null,
};
