import { getConfig } from "../config";
import type { ApiErrorResponse, TokenResponse } from "./types";

const TOKEN_KEY = "bd_token";

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export function apiUrl(path: string): string {
  return (getConfig().api_base || "").replace(/\/+$/, "") + path;
}

export async function api<T extends object>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(apiUrl(path), { ...options, headers });
  const data = (await response.json().catch(() => ({}))) as T &
    TokenResponse &
    ApiErrorResponse;
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  if (data.token) setToken(data.token);
  return data;
}
