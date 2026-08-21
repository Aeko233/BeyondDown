// 在线直存（实验性）：免登录取 B站旧版单文件 MP4（fnval=0，B站已混流，档位 64/16 ≤720P）的
// 直链 + 请求头，交给用户自己的下载器（aria2/IDM/curl）——字节不经过函数，零服务器流量。
//
// 边界：
// * 浏览器无法直连 B站 CDN（Referer 强校验 + CORS，见 AGENTS.md 事实 #2），直链需带 Referer 头
// * 清晰度：durl 只有 64/16 两档；未登录会话约 360P，登录后 720P（B站侧限制，非本站）
// * durl 多分段（长视频）不支持，返回错误引导走脚本
// * 版权面：直链仅限自用
import { json, apiError, checkRateLimit } from "../../../lib/http.js";
import { resolveClient } from "../../../lib/session.js";
import { playurl, viewInfo, UA, setBiliProxy } from "../../../lib/bili.js";

export async function onRequestGet(context) {
  const { request, env } = context;

  setBiliProxy(env.BILI_PROXY);
  if (!(await checkRateLimit(env, request, 30)))
    return apiError("请求过于频繁", 429);

  const url = new URL(request.url);
  const bvid = url.searchParams.get("bvid");
  const cid = url.searchParams.get("cid");
  const qn = Math.max(
    16,
    Math.min(Number(url.searchParams.get("qn") || 64) || 64, 64),
  ); // durl 只有 64/16

  if (!bvid || !cid) return apiError("缺少 bvid 或 cid 参数");

  try {
    const client = await resolveClient(request, env);
    const play = await playurl(client, { bvid, cid, qn, fnval: 0 });

    const segs = play.durl || [];
    if (!segs.length)
      return apiError("B站未返回单文件地址（该视频不支持在线直存）", 404);
    if (segs.length > 1) {
      return apiError(`该视频被分为 ${segs.length} 段，请改用下载脚本`, 400);
    }

    const view = await viewInfo(bvid, client.session);
    const page = (view.pages || []).find((p) => String(p.cid) === String(cid));
    const multiPage = (view.pages || []).length > 1;
    const title =
      multiPage && page?.part && page.part !== view.title
        ? `${view.title} - ${page.part}`
        : view.title;

    return json({
      title,
      quality: play.quality,
      headers: { Referer: "https://www.bilibili.com/", "User-Agent": UA },
      video: { baseUrl: segs[0].url, backupUrl: segs[0].backup_url },
    });
  } catch (e) {
    return apiError(
      e.message || "在线直存失败",
      502,
      e.code ? { biliCode: e.code } : {},
    );
  }
}
