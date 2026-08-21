import { json, apiError, checkRateLimit } from "../../../lib/http.js";
import { newSession, readToken, issueToken, ensureSessionReady } from "../../../lib/session.js";
import { qrcodePoll, parseSetCookies, nav, navToUser, navToWbi, setBiliProxy } from "../../../lib/bili.js";

// 二维码状态：86101 未扫码 / 86090 已扫码未确认 / 86038 已失效 / 0 成功
export async function onRequestPost(context) {
  const { request, env } = context;

  setBiliProxy(env.BILI_PROXY);
  if (!(await checkRateLimit(env, request))) return apiError("请求过于频繁", 429);

  try {
    const session = (await readToken(request, env)) || newSession();

    if (!session.qrcode?.key) return apiError("请先生成二维码", 400);
    if (Date.now() - session.qrcode.ts > 200_000) return json({ status: "expired" });

    await ensureSessionReady(session);
    const { data, res } = await qrcodePoll(session.qrcode.key, session);

    if (data.code !== 0) {
      const status = data.code === 86090 ? "scanned" : data.code === 86101 ? "waiting" : data.code === 86038 ? "expired" : "unknown";
      return json({ status, message: data.message || "", token: await issueToken(session, env) });
    }

    // 登录成功：从 Set-Cookie 提取凭据（Workers/Node 需用 getSetCookie，get 会合并无法解析）
    const sc = parseSetCookies(res.headers);
    if (!sc.SESSDATA) return apiError("登录成功但未收到 Cookie，接口行为可能已变化", 502);

    session.login = {
      sessdata: sc.SESSDATA,
      bili_jct: sc.bili_jct || "",
      dedeuserid: sc.DedeUserID || "",
      ckmd5: sc["DedeUserID__ckMd5"] || "",
      refresh_token: data.refresh_token || "",
      uid: Number(sc.DedeUserID) || null,
      uname: "",
      face: "",
      vip: false,
    };
    session.qrcode = null;

    // 用户信息尽力获取：api 域被风控时跳过（uid 已从 Cookie 拿到）
    try {
      const navData = await nav(session);
      if (navData.isLogin) {
        const user = navToUser(navData);
        session.login.uid = user.uid ?? session.login.uid;
        session.login.uname = user.uname;
        session.login.face = user.face;
        session.login.vip = user.vip;
      }
      const wbi = navToWbi(navData);
      if (wbi) session.wbi = wbi;
    } catch {
      // 环境受限时跳过
    }

    return json({
      status: "success",
      user: { uid: session.login.uid, uname: session.login.uname, face: session.login.face, vip: session.login.vip },
      token: await issueToken(session, env),
    });
  } catch (e) {
    return apiError(e.message || "轮询失败", 502);
  }
}

export const onRequestGet = onRequestPost;
