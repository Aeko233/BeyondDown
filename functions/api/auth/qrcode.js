import { json, apiError, checkRateLimit } from "../../../lib/http.js";
import { newSession, readToken, issueToken, ensureSessionReady } from "../../../lib/session.js";
import { qrcodeGenerate, setBiliProxy } from "../../../lib/bili.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  setBiliProxy(env.BILI_PROXY);
  if (!(await checkRateLimit(env, request))) return apiError("请求过于频繁，请稍后再试", 429);

  try {
    const session = (await readToken(request, env)) || newSession();
    await ensureSessionReady(session);

    const data = await qrcodeGenerate(session);
    session.qrcode = { key: data.qrcode_key, ts: Date.now() };

    return json({ qrUrl: data.url, expiresIn: 180, token: await issueToken(session, env) });
  } catch (e) {
    return apiError(e.message || "生成二维码失败", 502);
  }
}

export const onRequestGet = onRequestPost;
