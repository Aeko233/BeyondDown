// Functions 通用 HTTP 辅助。
// 跨域形态（静态站与 API 分属不同域名）由路由层统一注入 CORS 头，认证走 Bearer 令牌（无 Cookie）。

export function corsHeaders(env) {
  let origin = (env?.SITE_ORIGIN || "*").trim();
  if (origin !== "*") {
    origin = origin.replace(/\/+$/, "");
  }
  const h = {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
  if (origin !== "*") h.vary = "Origin";
  return h;
}

export function withCors(response, env) {
  for (const [k, v] of Object.entries(corsHeaders(env))) {
    if (!response.headers.has(k)) response.headers.set(k, v);
  }
  return response;
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });
}

export function apiError(message, status = 400, extra = {}) {
  return json({ error: message, ...extra }, { status });
}

export function getClientIp(request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "local";
}

// 简单限流：每 IP 每分钟 N 次。依赖可选的 KV（env.SESSION），无 KV 时放行（无状态部署）。
export async function checkRateLimit(env, request, limit = 60) {
  if (!env?.SESSION?.get) return true;
  const ip = getClientIp(request);
  const minute = Math.floor(Date.now() / 60000);
  const key = `rl:${ip}:${minute}`;
  try {
    const current = Number((await env.SESSION.get(key)) || 0);
    if (current >= limit) return false;
    await env.SESSION.put(key, String(current + 1), { expirationTtl: 120 });
    return true;
  } catch {
    return true;
  }
}

export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
