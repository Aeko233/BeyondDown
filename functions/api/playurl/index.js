import { json, apiError, checkRateLimit } from "../../../lib/http.js";
import { resolveClient, getGuestBundle, issueToken } from "../../../lib/session.js";
import { playurl, setBiliProxy } from "../../../lib/bili.js";

// fnval=0 返回旧版单文件 durl（≤720P，无需合并）；默认 4048 返回 DASH
export async function onRequestGet(context) {
  const { request, env } = context;

  setBiliProxy(env.BILI_PROXY);
  if (!(await checkRateLimit(env, request))) return apiError("请求过于频繁", 429);

  const url = new URL(request.url);
  const bvid = url.searchParams.get("bvid");
  const cid = url.searchParams.get("cid");
  const qn = Number(url.searchParams.get("qn") || 127);
  const fnval = url.searchParams.get("fnval") === "0" ? 0 : 4048;

  if (!bvid || !cid) return apiError("缺少 bvid 或 cid 参数");

  try {
    const client = await resolveClient(request, env);
    const session = client.guest ? null : client.session;

    // 登录态失效（-101）：清除后按匿名重试一次，并回传降级后的令牌
    try {
      const result = await playurl(client, { bvid, cid, qn, fnval });
      if (session) return json({ ...result, token: await issueToken(session, env) });
      return json(result);
    } catch (e) {
      if (e.code === -101 && session?.login) {
        session.login = null;
        const guest = await getGuestBundle();
        const anonClient = { session: { risk: guest.risk }, wbi: guest.wbi, guest: true };
        const result = await playurl(anonClient, { bvid, cid, qn, fnval });
        return json({ ...result, token: await issueToken(session, env) });
      }
      throw e;
    }
  } catch (e) {
    return apiError(e.message || "获取播放地址失败", e.code ? 502 : 500, e.code ? { biliCode: e.code } : {});
  }
}
