import { json, apiError, checkRateLimit, readJsonBody } from "../../../lib/http.js";
import { newSession, readToken, issueToken, ensureSessionReady } from "../../../lib/session.js";
import { parseCookieText, nav, navToUser, navToWbi, passportCookieInfo, setBiliProxy } from "../../../lib/bili.js";

// 手动导入 Cookie：解析 → nav 校验（api 域被风控时走 passport 域备用校验）→ 通过才签发令牌
export async function onRequestPost(context) {
  const { request, env } = context;

  setBiliProxy(env.BILI_PROXY);
  if (!(await checkRateLimit(env, request))) return apiError("请求过于频繁", 429);

  const body = await readJsonBody(request);
  const text = body?.cookie;
  if (!text || typeof text !== "string") return apiError("缺少 cookie 字段");

  const cookies = parseCookieText(text);
  if (!Object.keys(cookies).length) return apiError("无法解析 Cookie 内容");
  if (!cookies.SESSDATA) return apiError("缺少 SESSDATA，请复制完整 Cookie");

  try {
    const session = (await readToken(request, env)) || newSession();
    await ensureSessionReady(session);

    const login = {};
    const keyMap = { SESSDATA: "sessdata", bili_jct: "bili_jct", DedeUserID: "dedeuserid", "DedeUserID__ckMd5": "ckmd5" };
    for (const [k, field] of Object.entries(keyMap)) {
      if (cookies[k]) login[field] = cookies[k];
    }

    const probe = { ...session, login };
    let navData = null;
    try {
      navData = await nav(probe);
    } catch (e) {
      const info = await passportCookieInfo(probe).catch(() => null);
      if (info?.code === 0) {
        navData = { isLogin: true, mid: Number(cookies.DedeUserID) || null, uname: "", face: "", vipStatus: 0 };
      } else if (info && info.code === -101) {
        return apiError("Cookie 无效或已过期，请重新获取", 401);
      } else {
        return apiError(`校验通道不可用（服务器出口被风控）：${e.message}`, 502);
      }
    }
    if (!navData.isLogin) return apiError("Cookie 无效或已过期，请重新获取", 401);

    const user = navToUser(navData);
    session.login = {
      ...login,
      uid: user.uid ?? Number(cookies.DedeUserID) ?? null,
      uname: user.uname || "",
      face: user.face || "",
      vip: Boolean(user.vipStatus),
    };
    const wbi = navToWbi(navData);
    if (wbi) session.wbi = wbi;

    return json({
      status: "success",
      user: { uid: session.login.uid, uname: session.login.uname, face: session.login.face, vip: session.login.vip },
      token: await issueToken(session, env),
    });
  } catch (e) {
    return apiError(e.message || "Cookie 校验失败", 502);
  }
}
