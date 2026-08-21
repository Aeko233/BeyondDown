import { json, apiError, checkRateLimit } from "../../../lib/http.js";
import { resolveClient } from "../../../lib/session.js";
import {
  extractBvId,
  resolveB23Url,
  viewInfo,
  simplifyView,
  setBiliProxy,
} from "../../../lib/bili.js";

export async function onRequestGet(context) {
  const { request, env } = context;

  setBiliProxy(env.BILI_PROXY);
  if (!(await checkRateLimit(env, request)))
    return apiError("请求过于频繁", 429);

  const url = new URL(request.url);
  // bvid / url 两参数都收：直接 BV、完整链接、无协议链接（bilibili.com/...、b23.tv/...）一律先提取 BV；
  // 提取不到且是 b23 短链才做跳转解析（完整链接本身含 BV，无需解析）。
  const input = (
    url.searchParams.get("bvid") ||
    url.searchParams.get("url") ||
    ""
  ).trim();
  let bvid = extractBvId(input);
  if (!bvid && /b23\.tv/.test(input)) {
    try {
      const resolved = await resolveB23Url(
        /^https?:\/\//.test(input) ? input : "https://" + input,
      );
      bvid = extractBvId(resolved);
    } catch {
      return apiError("无法解析短链", 502);
    }
  }
  if (!bvid) return apiError("请提供 BV 号或视频链接");

  try {
    const client = await resolveClient(request, env);
    const data = await viewInfo(bvid, client.session);
    return json({
      video: simplifyView(data),
      loggedIn: Boolean(client.session?.login?.sessdata),
    });
  } catch (e) {
    return apiError(e.message || "获取视频信息失败", 502);
  }
}
