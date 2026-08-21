// 支付宝小程序云函数入口（Workers 兼容调度）。
//
// 平台 HTTP 触发按 FetchEvent 模式调度：加载 index.js 后派发 fetch 事件，要求
// 注册 addEventListener("fetch", ...)（未注册报 "No fetch handler defined"）。
// event.request 是标准 Request，直接交给 worker.js 统一路由，无需事件字段翻译。
//
// 环境变量在函数配置里设置：SESSION_SECRET（必须）、SITE_ORIGIN、BILI_PROXY、DEBUG_EVENT。
// 平台响应会全量缓冲，因此视频字节只通过 stream/export 返回的直链在用户端下载。
import worker from "../worker.js";

function buildEnv() {
  return {
    SESSION_SECRET: process.env.SESSION_SECRET,
    SITE_ORIGIN: process.env.SITE_ORIGIN,
    BILI_PROXY: process.env.BILI_PROXY,
    // 函数侧无静态资源：非 /api 请求返回 404（静态站由 Cloudflare ASSETS 托管）
    ASSETS: {
      fetch: () => new Response("Not Found", { status: 404 }),
    },
  };
}

async function handle(request) {
  // 调试：DEBUG_EVENT=1 回显平台透传的请求，核对 URL/请求头/body 是否完整
  if (process.env.DEBUG_EVENT === "1") {
    return new Response(
      JSON.stringify(
        {
          node: process.version,
          url: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
          body: await request.text().catch(() => null),
        },
        null,
        2,
      ),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }
  return worker.fetch(request, buildEnv(), { waitUntil: () => {} });
}

// Workers 风格入口：平台 HTTP 触发的 FetchEvent 调度
if (typeof addEventListener === "function") {
  addEventListener("fetch", (event) => {
    event.respondWith(handle(event.request));
  });
}

// 兜底导出：若平台还支持 exports.main 传统调用
export const main = handle;
