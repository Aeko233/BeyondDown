// 统一 Worker 入口：显式挂载 functions/ 下的处理器，静态资源交给 assets 绑定。
// 被 Cloudflare Workers、server.mjs（独立部署）、adapters/alipay.js（小程序云）共用。
import * as authQrcode from "./functions/api/auth/qrcode.js";
import * as authPoll from "./functions/api/auth/poll.js";
import * as authCookie from "./functions/api/auth/cookie.js";
import * as authMe from "./functions/api/auth/me.js";
import * as authLogout from "./functions/api/auth/logout.js";
import * as videoIndex from "./functions/api/video/index.js";
import * as playurlIndex from "./functions/api/playurl/index.js";
import * as downloadExport from "./functions/api/download/export.js";
import * as downloadStream from "./functions/api/download/stream.js";
import * as siteConfig from "./functions/api/config.js";
import { corsHeaders } from "./lib/http.js";

const routes = {
  "/api/auth/qrcode": authQrcode,
  "/api/auth/poll": authPoll,
  "/api/auth/cookie": authCookie,
  "/api/auth/me": authMe,
  "/api/auth/logout": authLogout,
  "/api/video": videoIndex,
  "/api/playurl": playurlIndex,
  "/api/download/export": downloadExport,
  "/api/download/stream": downloadStream,
  "/api/config": siteConfig,
};

function withCors(response, env) {
  for (const [k, v] of Object.entries(corsHeaders(env))) {
    if (!response.headers.has(k)) response.headers.set(k, v);
  }
  return response;
}

export default {
  async fetch(request, env, ctx) {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // API_PROXY：把 /api/* 转发到上游（国内云函数等），解决 CF 出口被 B站风控 + 平台网关吞 OPTIONS 预检的问题。
    // 服务器对服务器转发无浏览器预检；前端保持同源 /api/*，CORS 由本层统一注入。
    const apiProxy = env.API_PROXY;
    if (apiProxy && path.startsWith("/api/")) {
      const res = await fetch(apiProxy + url.pathname + url.search, request);
      return withCors(
        new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        }),
        env,
      );
    }

    if (path.startsWith("/api/")) {
      // CORS 预检（静态站与 API 分域部署时的生命线）
      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }), env);
      }

      const mod = routes[path];
      if (!mod)
        return withCors(
          new Response(JSON.stringify({ error: "Not Found" }), {
            status: 404,
            headers: { "content-type": "application/json; charset=utf-8" },
          }),
          env,
        );

      const handler =
        request.method === "GET"
          ? mod.onRequestGet
          : request.method === "POST"
            ? mod.onRequestPost
            : mod.onRequest;
      if (!handler)
        return withCors(
          new Response("Method Not Allowed", { status: 405 }),
          env,
        );

      try {
        return withCors(
          await handler({
            request,
            env,
            params: {},
            waitUntil: (p) => ctx.waitUntil(p),
            next: () => {},
          }),
          env,
        );
      } catch (e) {
        return withCors(
          new Response(JSON.stringify({ error: String(e?.message || e) }), {
            status: 500,
            headers: { "content-type": "application/json; charset=utf-8" },
          }),
          env,
        );
      }
    }

    // 其余全部交给静态资源（"/" 自动命中 index.html）
    return env.ASSETS.fetch(request);
  },
};
