# BeyondDown

一个轻量的 Bilibili 视频下载工具，帮助用户解析视频并导出可直接下载的任务。

## Why

Bilibili 的登录态、清晰度和 CDN 请求头让本地下载流程变得繁琐；BeyondDown 将解析、登录和下载任务集中到一个简洁的 Web 界面，同时尽量不让视频字节经过服务器。

## Features

- **多种登录方式**：支持扫码、Cookie 和 `cookies.txt` / JSON 导入。
- **视频解析**：支持视频信息、WBI 签名和 DASH 音视频轨解析。
- **灵活导出**：生成 `.bat`、`.sh`、aria2、yt-dlp 或直链下载任务。
- **低服务器带宽**：下载脚本和直链由用户端直接请求 Bilibili CDN。
- **安全会话**：使用 AES-GCM 加密的无状态 Bearer 会话令牌，不依赖 KV 保存登录态。

## Quick Start

需要 [Bun](https://bun.sh/)。

```bash
bun install
bun run build
```

然后分别启动 API 和前端：

```bash
# 终端 1
bun run dev:api       # http://localhost:8788

# 终端 2
bun run dev           # http://localhost:5173
```

运行检查：

```bash
bun run check
```

## Cloudflare Workers

```bash
bun x wrangler login
bun x wrangler secret put SESSION_SECRET
bun run deploy
```

Cloudflare 海外出口可能被 Bilibili 风控拦截。生产环境请在 `wrangler.toml` 配置可用的 `API_PROXY` 或 `BILI_PROXY`，并按需设置 `SITE_ORIGIN`。

## License

本项目采用 [GNU General Public License v3.0](./LICENSE) 授权。
