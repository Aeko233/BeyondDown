// 无状态会话：AES-GCM 加密的 Bearer 令牌。
// 令牌负载 = 完整 session JSON（登录态 + 风控 Cookie + WBI key + 扫码中间态），
// 服务端零存储（无 KV 依赖），适配任何 Serverless 平台。
// 生产必须设置环境变量 SESSION_SECRET（否则使用开发密钥）。
import { activateRisk, nav, navToUser, navToWbi } from "./bili.js";

const SESSION_TTL_MS = 7 * 86400 * 1000;
const DEV_SECRET = "beyonddown-dev-secret-change-me";

const keyCache = new Map();
async function aesKey(secret) {
  let k = keyCache.get(secret);
  if (!k) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    k = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
    keyCache.set(secret, k);
  }
  return k;
}

const b64u = {
  enc(buf) {
    let s = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(str) {
    let s = str.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export function newSession() {
  return { created_at: Date.now(), risk: {}, wbi: null, login: null, qrcode: null };
}

// 签发令牌（GCM 自带完整性校验，无需额外 HMAC）
export async function issueToken(session, env) {
  const secret = env?.SESSION_SECRET || DEV_SECRET;
  const payload = { ...session, exp: Date.now() + SESSION_TTL_MS };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(secret),
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return "v1." + b64u.enc(out);
}

// 解析请求头里的令牌；无效/过期返回 null
export async function readToken(request, env) {
  const h = request.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(v1\.[A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    const raw = b64u.dec(m[1].slice(3));
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, 12) },
      await aesKey(env?.SESSION_SECRET || DEV_SECRET),
      raw.slice(12),
    );
    const session = JSON.parse(new TextDecoder().decode(pt));
    if (!session.exp || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

// 确保会话完成风控激活与 WBI 获取（原地修改；调用方在响应中回传新令牌）
export async function ensureSessionReady(session) {
  const now = Math.floor(Date.now() / 1000);
  const r = session.risk || {};
  const needsRisk = !r.buvid3 || !r.bili_ticket || (r.bili_ticket_expires || 0) < now + 60;

  if (needsRisk) {
    const { risk, wbi } = await activateRisk(r);
    session.risk = risk;
    if (wbi && !session.wbi) session.wbi = wbi;
  }

  if (!session.wbi) {
    // nav 失败（出口被风控）不再阻断流程：wbi 留空，playurl 时会再尝试
    try {
      const navData = await nav(session.login ? session : null);
      const wbi = navToWbi(navData);
      if (wbi) session.wbi = wbi;
      if (session.login && navData.isLogin) {
        const u = navToUser(navData);
        session.login.uid = u.uid ?? session.login.uid;
        session.login.uname = u.uname;
        session.login.face = u.face;
        session.login.vip = u.vip;
      }
    } catch {
      // 环境受限时跳过
    }
  }
  return session;
}

// 匿名请求共用的 guest 风控包：模块级缓存（每实例独立，6 小时）
let guestCache = null;
export async function getGuestBundle() {
  const now = Math.floor(Date.now() / 1000);
  if (guestCache && guestCache.expires > now + 300) return guestCache;
  const { risk, wbi } = await activateRisk({});
  guestCache = { risk, wbi, expires: now + 6 * 3600 };
  return guestCache;
}

// 解析请求对应的客户端（令牌会话优先，匿名走 guest 风控包），供 playurl/export/stream 共用
export async function resolveClient(request, env) {
  const session = await readToken(request, env);
  if (session && (session.login || Object.keys(session.risk || {}).length)) {
    await ensureSessionReady(session);
    return { session, wbi: session.wbi, guest: false };
  }
  const guest = await getGuestBundle();
  return { session: { risk: guest.risk }, wbi: guest.wbi, guest: true };
}
