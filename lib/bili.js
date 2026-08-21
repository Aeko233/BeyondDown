// B站上游客户端：统一请求头、风控 Cookie 激活链、登录/API 封装
// 行为依据：PLAN.md v3（bilibili-API-collect 文档 + Bili23-Downloader-main 源码实证 + 本机 curl 实测）

import { buvidFP } from "./murmur3.js";
import { wbiSign } from "./wbi.js";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const BILI_RETRYABLE_CODES = new Set([-352, -412, -500, -504, -509]);

export function baseHeaders() {
  return {
    "user-agent": UA,
    "referer": "https://www.bilibili.com/",
  };
}

// session 形状：{ risk: {...}, login: {...}|null, wbi: {img_key, sub_key}|null }
export function buildCookieHeader(session) {
  const parts = [];
  const r = session?.risk || {};
  if (r.buvid3) parts.push(`buvid3=${r.buvid3}`);
  if (r.buvid4) parts.push(`buvid4=${r.buvid4}`);
  if (r.buvid_fp) parts.push(`buvid_fp=${r.buvid_fp}`);
  if (r._uuid) parts.push(`_uuid=${r._uuid}`);
  if (r.b_lsid) parts.push(`b_lsid=${r.b_lsid}`);
  if (r.b_nut) parts.push(`b_nut=${r.b_nut}`);
  if (r.bili_ticket) parts.push(`bili_ticket=${r.bili_ticket}`);
  parts.push("CURRENT_FNVAL=4048", "CURRENT_QUALITY=0");
  const l = session?.login;
  if (l) {
    if (l.dedeuserid) parts.push(`DedeUserID=${l.dedeuserid}`);
    if (l.ckmd5) parts.push(`DedeUserID__ckMd5=${l.ckmd5}`);
    if (l.sessdata) parts.push(`SESSDATA=${l.sessdata}`);
    if (l.bili_jct) parts.push(`bili_jct=${l.bili_jct}`);
  }
  return parts.join("; ");
}

// B站反向代理前缀（自部署选项）：设置后所有 B站上游请求改走 `${BILI_PROXY}/<host>/<path>`，
// 用于把出口 IP 换成国内云函数等未被风控的环境。契约见 README。
let BILI_PROXY = "";

export function setBiliProxy(prefix) {
  BILI_PROXY = prefix ? String(prefix).replace(/\/+$/, "") : "";
}

export function upstreamUrl(url) {
  if (!BILI_PROXY) return url;
  try {
    const u = new URL(url);
    return `${BILI_PROXY}/${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

async function biliFetch(url, session, init = {}) {
  const doFetch = () =>
    fetch(upstreamUrl(url), {
      ...init,
      headers: {
        "user-agent": UA,
        "referer": "https://www.bilibili.com/",
        "accept": "application/json, text/plain, */*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        cookie: buildCookieHeader(session),
        ...(init.headers || {}),
      },
    });

  let res = await doFetch();
  // 412 风控偶发时重试一次可能通过；持续 412 则为出口 IP 被封
  if (res.status === 412 && !init._retried412) {
    await new Promise((r) => setTimeout(r, 600));
    const retryInit = { ...init, _retried412: true };
    return biliFetch(url, session, retryInit);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // 风控页/挑战页/空响应：带上诊断信息，便于判断是哪类拦截
    const preview = text.slice(0, 120).replace(/\s+/g, " ");
    json = { code: -1, message: `HTTP ${res.status} 非 JSON 响应（${res.headers.get("content-type") || "无类型"}）${preview ? `: ${preview}` : "（空正文）"}` };
  }
  return { json, res };
}

// ---------- Set-Cookie / Cookie 文本解析 ----------

export function parseSetCookies(headers) {
  const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const out = {};
  for (const raw of list) {
    const pair = raw.split(";")[0];
    const idx = pair.indexOf("=");
    if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return out;
}

// 移植自 Bili23 src/util/auth/cookie_login.py parse_cookies：
// 支持 "k=v; k=v"、"Cookie:" 前缀、JSON 对象、换行分隔、引号值
export function parseCookieText(text) {
  if (typeof text !== "string") return {};
  text = text.trim();
  if (text.toLowerCase().startsWith("cookie:")) text = text.slice("cookie:".length);

  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const cookies = {};
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === "string") cookies[k] = v;
      }
      return cookies;
    }
  } catch {
    // 不是 JSON，继续按分号解析
  }

  const cookies = {};
  for (const part of text.replace(/\n/g, ";").split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim().replace(/^"(.*)"$/, "$1");
    if (key && !/\s/.test(key)) cookies[key] = value;
  }
  return cookies;
}

// ---------- 风控 Cookie 激活链 ----------

function randomUpperHex(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += "0123456789ABCDEF"[Math.floor(Math.random() * 16)];
  return s;
}

function genUuid() {
  const t = String(Math.floor(Date.now() / 1000) % 100000).padStart(5, "0");
  return `${randomUpperHex(8)}-${randomUpperHex(4)}-${randomUpperHex(4)}-${randomUpperHex(4)}-${randomUpperHex(12)}${t}infoc`;
}

function genBLsid() {
  return `${randomUpperHex(8)}_${Math.floor(Date.now() / 1000).toString(16).toUpperCase()}`;
}

// 本地生成 buvid3/4（finger/spi 被风控时的降级路径），格式仿 B站实际下发样式
function genBuvid3() {
  const t = String(Math.floor(Date.now() / 1000) % 100000).padStart(5, "0");
  return `${randomUpperHex(8)}-${randomUpperHex(4)}-${randomUpperHex(4)}-${randomUpperHex(4)}-${randomUpperHex(12)}${t}infoc`;
}

function genBuvid4() {
  const tail = randomUpperHex(16) + Array.from({ length: 16 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)]).join("");
  return `${randomUpperHex(8)}-${randomUpperHex(4)}-${randomUpperHex(4)}-${randomUpperHex(4)}-${tail}==`;
}

function urlStem(u) {
  if (!u) return "";
  const m = String(u).match(/([^/.]+)\.\w+$/);
  return m ? m[1] : "";
}

async function fetchFingerSpi() {
  const { json } = await biliFetch("https://api.bilibili.com/x/frontend/finger/spi", null);
  if (json.code !== 0 || !json.data?.b_3) throw new Error(`finger/spi 失败: ${json.message || json.code}`);
  return { buvid3: json.data.b_3, buvid4: json.data.b_4 || "" };
}

async function fetchBiliTicket(risk) {
  const ts = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("XgwSnGZ1p"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`ts${ts}`));
  const hexsign = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");

  let url =
    `https://api.bilibili.com/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket` +
    `?key_id=ec02&hexsign=${hexsign}&context%5Bts%5D=${ts}`;

  const { json } = await biliFetch(url, { risk }, { method: "POST" });
  if (json.code !== 0 || !json.data?.ticket) throw new Error(`GenWebTicket 失败: ${json.message || json.code}`);
  return { ticket: json.data.ticket, ttl: json.data.ttl || 259200, nav: json.data.nav || null };
}

// 移植自 Bili23 src/util/common/data/exclimbwuzhi.py（payload 为固定浏览器指纹模板）
function buildExPayload(userAgent, uuid) {
  const payload = {
    "3064": 1,
    "5062": String(Date.now()),
    "03bf": "https%3A%2F%2Fwww.bilibili.com%2F",
    "39c8": "333.1007.fp.risk",
    "34f1": "",
    "d402": "",
    "654a": "",
    "6e7c": "1699x794",
    "3c43": {
      "2673": 0,
      "5766": 32,
      "6527": 0,
      "7003": 1,
      "807e": 1,
      "b8ce": userAgent,
      "641c": 0,
      "07a4": "zh-CN",
      "1c57": 32,
      "0bd0": 20,
      "748e": [960, 1707],
      "d61f": [912, 1707],
      "fc9d": -480,
      "6aa9": "Asia/Shanghai",
      "75b8": 1,
      "3b21": 1,
      "8a1c": 0,
      "d52f": "not available",
      "adca": "Win32",
      "80c9": [
        ["PDF Viewer", "Portable Document Format", [["application/pdf", "pdf"], ["text/pdf", "pdf"]]],
        ["Chrome PDF Viewer", "Portable Document Format", [["application/pdf", "pdf"], ["text/pdf", "pdf"]]],
        ["Chromium PDF Viewer", "Portable Document Format", [["application/pdf", "pdf"], ["text/pdf", "pdf"]]],
        ["Microsoft Edge PDF Viewer", "Portable Document Format", [["application/pdf", "pdf"], ["text/pdf", "pdf"]]],
        ["WebKit built-in PDF", "Portable Document Format", [["application/pdf", "pdf"], ["text/pdf", "pdf"]]],
      ],
      "13ab": "EPQAAAAASUVORK5CYII=",
      "bfe9": "//TgNIfAAAAAZJREFUAwBde+3wgcxEHQAAAABJRU5ErkJggg==",
      "a3c1": [
        "extensions:ANGLE_instanced_arrays;EXT_blend_minmax;EXT_clip_control;EXT_color_buffer_half_float;EXT_depth_clamp;EXT_disjoint_timer_query;EXT_float_blend;EXT_frag_depth;EXT_polygon_offset_clamp;EXT_shader_texture_lod;EXT_texture_compression_bptc;EXT_texture_compression_rgtc;EXT_texture_filter_anisotropic;EXT_texture_mirror_clamp_to_edge;EXT_sRGB;KHR_parallel_shader_compile;OES_element_index_uint;OES_fbo_render_mipmap;OES_standard_derivatives;OES_texture_float;OES_texture_float_linear;OES_texture_half_float;OES_texture_half_float_linear;OES_vertex_array_object;WEBGL_blend_func_extended;WEBGL_color_buffer_float;WEBGL_compressed_texture_s3tc;WEBGL_compressed_texture_s3tc_srgb;WEBGL_debug_renderer_info;WEBGL_debug_shaders;WEBGL_depth_texture;WEBGL_draw_buffers;WEBGL_lose_context;WEBGL_multi_draw;WEBGL_polygon_mode",
        "webgl aliased line width range:[1, 1]",
        "webgl aliased point size range:[1, 1024]",
        "webgl alpha bits:8",
        "webgl antialiasing:yes",
        "webgl blue bits:8",
        "webgl depth bits:24",
        "webgl green bits:8",
        "webgl max anisotropy:16",
        "webgl max combined texture image units:32",
        "webgl max cube map texture size:16384",
        "webgl max fragment uniform vectors:1024",
        "webgl max render buffer size:16384",
        "webgl max texture image units:16",
        "webgl max texture size:16384",
        "webgl max varying vectors:30",
        "webgl max vertex attribs:16",
        "webgl max vertex texture image units:16",
        "webgl max vertex uniform vectors:4095",
        "webgl max viewport dims:[32767, 32767]",
        "webgl red bits:8",
        "webgl renderer:WebKit WebGL",
        "webgl shading language version:WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)",
        "webgl stencil bits:0",
        "webgl vendor:WebKit",
        "webgl version:WebGL 1.0 (OpenGL 2.0 Chromium)",
        "webgl unmasked vendor:Google Inc. (NVIDIA)",
        "webgl unmasked renderer:ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028E0) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      ],
      "6bc5": "Google Inc. (NVIDIA)~ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028E0) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "ed31": 0,
      "72bd": 0,
      "097b": 0,
      "52cd": [0, 0, 0],
      "a658": [
        "Arial", "Arial Black", "Arial Narrow", "Book Antiqua", "Bookman Old Style", "Calibri",
        "Cambria", "Cambria Math", "Century", "Century Gothic", "Century Schoolbook", "Comic Sans MS",
        "Consolas", "Courier", "Courier New", "Georgia", "Helvetica", "Impact", "Lucida Bright",
        "Lucida Calligraphy", "Lucida Console", "Lucida Fax", "Lucida Handwriting", "Lucida Sans",
        "Lucida Sans Typewriter", "Lucida Sans Unicode", "Microsoft Sans Serif", "Monotype Corsiva",
        "MS Gothic", "MS PGothic", "MS Reference Sans Serif", "MS Sans Serif", "MS Serif",
        "Palatino Linotype", "Segoe Print", "Segoe Script", "Segoe UI", "Segoe UI Light",
        "Segoe UI Semibold", "Segoe UI Symbol", "Tahoma", "Times", "Times New Roman", "Trebuchet MS",
        "Verdana", "Wingdings", "Wingdings 2", "Wingdings 3",
      ],
      "d02f": "124.04347527516074",
    },
    "54ef":
      '{"b_ut":"","home_version":"V8","in_new_ab":true,"ab_version":{"for_ai_home_version":"V8","in_theme_version":"OPEN","enable_web_push":"DISABLE","enable_ai_floor_api":"ENABLE","enable_shortcut_key":"DISABLE","rcmd_timeout_config":"550","home_performance_opt":"ssr_fetch_opt","infra_projection":"OFF"},"ab_split_num":{"for_ai_home_version":54,"in_theme_version":30,"enable_web_push":10,"enable_ai_floor_api":137,"enable_shortcut_key":54,"rcmd_timeout_config":49,"home_performance_opt":49,"infra_projection":49},"uniq_page_id":"1671272756362","is_modern":true}',
    "8b94": "",
    "df35": uuid,
    "07a4": "zh-CN",
    "5f45": null,
    "db46": 0,
  };
  return JSON.stringify({ payload: JSON.stringify(payload) });
}

async function exClimbWuzhi(risk) {
  const uuid = risk._uuid || genUuid();
  const body = buildExPayload(UA, uuid);
  const res = await fetch(upstreamUrl("https://api.bilibili.com/x/internal/gaia-gateway/ExClimbWuzhi"), {
    method: "POST",
    headers: {
      ...baseHeaders(),
      "content-type": "application/json",
      cookie: `buvid3=${risk.buvid3}${risk.buvid4 ? `; buvid4=${risk.buvid4}` : ""}`,
    },
    body,
  });
  const json = await res.json().catch(() => ({ code: -1 }));
  return json.code === 0;
}

// 完整激活链：finger/spi → 本地生成 → GenWebTicket → ExClimbWuzhi
// 各环独立降级：finger/spi 被风控（如数据中心 IP）时本地自生成 buvid，
// bili_ticket / ExClimbWuzhi 失败时跳过——激活链尽力而为，不阻断登录/解析
export async function activateRisk(existing = {}) {
  const now = Math.floor(Date.now() / 1000);
  const risk = { ...existing };

  if (!risk.buvid3 || (risk.buvid_expires || 0) < now) {
    try {
      const spi = await fetchFingerSpi();
      risk.buvid3 = spi.buvid3;
      risk.buvid4 = spi.buvid4;
    } catch {
      // buvid3/4 只是客户端指纹标识，自生成同格式值同样被接受
      risk.buvid3 = genBuvid3();
      risk.buvid4 = genBuvid4();
    }
    risk.buvid_expires = now + 86400;
    risk._uuid = genUuid();
    risk.b_lsid = genBLsid();
    risk.b_nut = String(now);
    risk.buvid_fp = buvidFP(UA);
  }

  let wbi = null;
  if (!risk.bili_ticket || (risk.bili_ticket_expires || 0) < now + 60) {
    try {
      const t = await fetchBiliTicket(risk);
      risk.bili_ticket = t.ticket;
      risk.bili_ticket_expires = now + t.ttl;
      if (t.nav?.img && t.nav?.sub) {
        wbi = { img_key: urlStem(t.nav.img), sub_key: urlStem(t.nav.sub) };
      }
    } catch {
      // 无 bili_ticket 继续（部分接口不强制）
    }
  }

  if (!risk.ex_activated) {
    try {
      risk.ex_activated = await exClimbWuzhi(risk);
    } catch {
      risk.ex_activated = false;
    }
  }

  return { risk, wbi };
}

// ---------- 登录 / API 封装 ----------

export async function qrcodeGenerate(session) {
  const params = new URLSearchParams({
    source: "main-fe-header",
    go_url: "https://www.bilibili.com/",
    web_location: "333.1007",
  });
  const { json } = await biliFetch(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/generate?${params}`,
    session,
  );
  if (json.code !== 0 || !json.data?.qrcode_key) {
    throw new Error(`生成二维码失败: ${json.message || json.code}`);
  }
  return json.data; // { url, qrcode_key }
}

export async function qrcodePoll(qrcodeKey, session) {
  const { json, res } = await biliFetch(
    `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`,
    session,
  );
  if (json.code !== 0) throw new Error(`轮询失败: ${json.message || json.code}`);
  return { data: json.data, res };
}

export async function nav(session) {
  const { json } = await biliFetch("https://api.bilibili.com/x/web-interface/nav", session);
  // 未登录时 nav 顶层 code 为 -101 但 data 完整（isLogin:false + wbi_img），只有其他错误码才异常
  if (json.code !== 0 && json.code !== -101) throw new Error(`nav 失败: ${json.message || json.code}`);
  if (!json.data) throw new Error("nav 未返回数据");
  return json.data;
}

// passport 域的 Cookie 有效性校验（api 域被风控时的备用通道）
// SESSDATA 有效返回 code 0（附 csrf），无效返回 -101
export async function passportCookieInfo(session) {
  const { json } = await biliFetch("https://passport.bilibili.com/x/passport-login/web/cookie/info", session);
  return json;
}

export function navToUser(data) {
  return {
    uid: data.mid ?? null,
    uname: data.uname || "",
    face: data.face || "",
    vip: Boolean(data.vipStatus),
    isLogin: Boolean(data.isLogin),
  };
}

export function navToWbi(data) {
  const img = urlStem(data?.wbi_img?.img_url);
  const sub = urlStem(data?.wbi_img?.sub_url);
  return img && sub ? { img_key: img, sub_key: sub } : null;
}

export async function resolveB23Url(url) {
  const res = await fetch(url, { headers: baseHeaders(), redirect: "follow" });
  return res.url || url;
}

export function extractBvId(input) {
  const m = String(input || "").match(/BV[1-9A-HJ-NP-Za-km-z]{10}/);
  return m ? m[0] : null;
}

export async function viewInfo(bvid, session) {
  const { json } = await biliFetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    session,
  );
  if (json.code !== 0) throw new Error(`获取视频信息失败: ${json.message || json.code}`);
  return json.data;
}

export function simplifyView(d) {
  return {
    bvid: d.bvid,
    aid: d.aid,
    title: d.title,
    desc: d.desc || "",
    pic: d.pic,
    duration: d.duration,
    pubdate: d.pubdate,
    owner: { mid: d.owner?.mid, name: d.owner?.name, face: d.owner?.face },
    stat: {
      view: d.stat?.view,
      danmaku: d.stat?.danmaku,
      reply: d.stat?.reply,
      favorite: d.stat?.favorite,
      coin: d.stat?.coin,
      share: d.stat?.share,
      like: d.stat?.like,
    },
    pages: (d.pages || []).map((p) => ({
      page: p.page,
      part: p.part,
      cid: p.cid,
      duration: p.duration,
    })),
  };
}

function mapTrack(t, kind) {
  if (!t) return null;
  return {
    id: t.id,
    kind,
    baseUrl: t.baseUrl || t.base_url || "",
    backupUrl: t.backupUrl || t.backup_url || [],
    bandwidth: t.bandwidth,
    codecs: t.codecs || "",
    mimeType: t.mimeType || t.mime_type || "",
    width: t.width || null,
    height: t.height || null,
    frameRate: t.frameRate || t.frame_rate || null,
    segmentBase: t.segmentBase || t.SegmentBase || null,
  };
}

// playurl：WBI 签名 + 风控/登录 Cookie，风控错误码自动重激活并重试一次
// opts.fnval：4048（默认，DASH 音视频分离）；0（旧版单文件 durl，B站已混流好，清晰度受限）
export async function playurl(client, { bvid, cid, qn = 127, fnval = 4048 }, onRiskRefresh = null) {
  const params = { bvid, cid, qn, fnver: 0, fnval, fourk: 1 };

  for (let attempt = 0; attempt < 2; attempt++) {
    let wbi = client.wbi;
    if (!wbi) {
      const navData = await nav(client.session || null);
      wbi = navToWbi(navData);
      if (!wbi) throw new Error("无法获取 WBI key");
      client.wbi = wbi;
      if (onRiskRefresh) onRiskRefresh(wbi);
    }

    const query = wbiSign(params, wbi.img_key, wbi.sub_key);
    const { json } = await biliFetch(`https://api.bilibili.com/x/player/wbi/playurl?${query}`, client.session);

    if (json.code === 0) {
      const d = json.data;
      return {
        quality: d.quality,
        accept_quality: d.accept_quality || [],
        accept_format: d.accept_format || "",
        format: d.format || "",
        timelength: d.timelength,
        dash: d.dash
          ? {
              video: (d.dash.video || []).map((t) => mapTrack(t, "video")),
              audio: (d.dash.audio || []).map((t) => mapTrack(t, "audio")),
              dolby: (d.dash.dolby?.audio || []).map((t) => mapTrack(t, "dolby")),
              flac: d.dash.flac ? mapTrack(d.dash.flac.audio || d.dash.flac, "flac") : null,
            }
          : null,
        durl: d.durl
          ? d.durl.map((u) => ({ order: u.order, length: u.length, size: u.size, url: u.url, backupUrl: u.backup_url || [] }))
          : null,
      };
    }

    if (!BILI_RETRYABLE_CODES.has(json.code) || attempt > 0) {
      const e = new Error(json.message || `playurl 错误码 ${json.code}`);
      e.code = json.code;
      throw e;
    }

    // 风控类错误：重新激活后重试
    const refreshed = await activateRisk(client.session?.risk || {});
    client.session = { ...client.session, risk: refreshed.risk };
    if (refreshed.wbi) {
      client.wbi = refreshed.wbi;
      if (onRiskRefresh) onRiskRefresh(refreshed.wbi);
    }
  }
  throw new Error("playurl 重试后仍失败");
}
