// 下载任务导出：服务端重新请求 playurl 拿新鲜直链，生成脚本 / aria2 任务 / yt-dlp 命令
// 直链默认不需要 Cookie（鉴权在查询参数），只带 Referer + UA —— B23 实证
import { json, apiError, checkRateLimit } from "../../../lib/http.js";
import { resolveClient } from "../../../lib/session.js";
import { playurl, viewInfo, UA, setBiliProxy } from "../../../lib/bili.js";

const DOWNLOAD_HEADERS = [`Referer: https://www.bilibili.com/`, `User-Agent: ${UA}`];

function sanitizeFileName(name) {
  return String(name || "video").replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 120).trim() || "video";
}

function findTracks(playData, videoId, audioId) {
  const dash = playData.dash;
  if (!dash) return { video: null, audio: null, reason: "该视频未返回 DASH 流（可能是 mp4/flv 老格式）" };

  const video = dash.video.find((t) => String(t.id) === String(videoId)) || null;
  let audio = null;
  if (audioId) {
    audio =
      dash.audio.find((t) => String(t.id) === String(audioId)) ||
      (dash.dolby || []).find((t) => String(t.id) === String(audioId)) ||
      (dash.flac && String(dash.flac.id) === String(audioId) ? dash.flac : null);
  }
  return { video, audio };
}

export async function onRequestGet(context) {
  const { request, env } = context;

  setBiliProxy(env.BILI_PROXY);

  if (!(await checkRateLimit(env, request))) return apiError("请求过于频繁", 429);

  const url = new URL(request.url);
  const bvid = url.searchParams.get("bvid");
  const cid = url.searchParams.get("cid");
  const qn = Number(url.searchParams.get("qn") || 127);
  const videoId = url.searchParams.get("videoId");
  const audioId = url.searchParams.get("audioId");
  const format = url.searchParams.get("format") || "raw";

  if (!bvid || !cid || !videoId) return apiError("缺少 bvid / cid / videoId 参数");

  try {
    const client = await resolveClient(request, env);
    const playData = await playurl(client, { bvid, cid, qn });
    const { video, audio, reason } = findTracks(playData, videoId, audioId);
    if (!video) return apiError(reason || "未找到指定视频轨", 404);

    const view = await viewInfo(bvid, client.session);
    const page = (view.pages || []).find((p) => String(p.cid) === String(cid));
    const multiPage = (view.pages || []).length > 1;
    const title = multiPage && page?.part && page.part !== view.title ? `${view.title} - ${page.part}` : view.title;
    const base = sanitizeFileName(title);

    if (format === "raw") {
      return json({
        title,
        headers: { Referer: "https://www.bilibili.com/", "User-Agent": UA },
        video: { baseUrl: video.baseUrl, backupUrl: video.backupUrl },
        audio: audio ? { baseUrl: audio.baseUrl, backupUrl: audio.backupUrl } : null,
      });
    }

    if (format === "aria2") {
      const tasks = [];
      tasks.push({ url: video.baseUrl, out: `${base}.video.m4s`, header: DOWNLOAD_HEADERS });
      if (audio) tasks.push({ url: audio.baseUrl, out: `${base}.audio.m4s`, header: DOWNLOAD_HEADERS });
      return json({ title, tasks, mergeCommand: `ffmpeg -i "${base}.video.m4s" -i "${base}.audio.m4s" -c copy "${base}.mp4"` });
    }

    if (format === "ytdlp") {
      const quoted = (s) => `"${s}"`;
      const direct = [
        "yt-dlp",
        `--add-headers ${quoted(DOWNLOAD_HEADERS[0])}`,
        `-o ${quoted(`${base}.%(ext)s`)}`,
        quoted(video.baseUrl),
        ...(audio ? [quoted(audio.baseUrl)] : []),
      ].join(" ");
      const pageUrl = `yt-dlp --cookies-from-browser edge ${quoted(`https://www.bilibili.com/video/${bvid}`)}`;
      return json({ title, direct, pageUrl });
    }

    if (format === "bat" || format === "sh") {
      // cmd 在 65001 代码页下解析批处理会吞掉多字节字符后的一个字节（如中文后紧跟的引号），
      // 导致 URL 引号失配被 & 拆开。因此 .bat 的命令行一律使用 ASCII 文件名，中文只出现在独立 echo 行。
      const batSafe = `${bvid}_${cid}`;
      const escBat = (s) => String(s).replace(/%/g, "%%"); // .bat 中 % 是变量/参数引导符，必须成对转义
      const headerArgs = DOWNLOAD_HEADERS.map((h) => `-H ${JSON.stringify(h)}`).join(" ");
      const mkFiles = format === "bat"
        ? { v: `${batSafe}.video.m4s`, a: `${batSafe}.audio.m4s`, out: `${batSafe}.mp4` }
        : { v: `${base}.video.m4s`, a: `${base}.audio.m4s`, out: `${base}.mp4` };
      const { v: vFile, a: aFile, out: outFile } = mkFiles;
      const curlBase = format === "bat" ? "curl.exe -L" : "curl -L";

      if (format === "bat") {
        // .bat 全 ASCII（含英文提示、不设 chcp）：cmd 的 65001 解析会吞多字节字符后的字节，
        // 任何非 ASCII 都可能破坏相邻引号/换行语法。中文体验由 sh / aria2 / yt-dlp 路径承担。
        // ffmpeg 引导：PATH → %USERPROFILE%\beyonddown\bin → 脚本同目录 → 首次运行自动下载安装（一次性）
        const lines = [
          "@echo off",
          'cd /d "%~dp0"',
          "setlocal",
          "set \"FFMPEG=\"",
          "where ffmpeg >nul 2>nul && set \"FFMPEG=ffmpeg\"",
          'if not defined FFMPEG if exist "%USERPROFILE%\\beyonddown\\bin\\ffmpeg.exe" set "FFMPEG=%USERPROFILE%\\beyonddown\\bin\\ffmpeg.exe"',
          'if not defined FFMPEG if exist "%~dp0ffmpeg.exe" set "FFMPEG=%~dp0ffmpeg.exe"',
          "if defined FFMPEG goto :ready",
          "echo [setup] ffmpeg not found. One-time setup, downloading ~170MB...",
          'curl.exe -L -o "%TEMP%\\beyonddown-ffmpeg.zip" "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" || (echo [ERROR] download failed, check network. & pause & exit /b 1)',
          "powershell -NoProfile -Command \"Expand-Archive -Force '%TEMP%\\beyonddown-ffmpeg.zip' '%USERPROFILE%\\beyonddown-tmp'\" || (echo [ERROR] unzip failed. & pause & exit /b 1)",
          'for /r "%USERPROFILE%\\beyonddown-tmp" %%F in (ffmpeg*.exe) do if not defined FFMPEG set "FFMPEG=%%F"',
          "if not defined FFMPEG (echo [ERROR] ffmpeg.exe not found after unzip. & pause & exit /b 1)",
          'mkdir "%USERPROFILE%\\beyonddown\\bin" 2>nul',
          'copy /y "%FFMPEG%" "%USERPROFILE%\\beyonddown\\bin\\ffmpeg.exe" >nul',
          'set "FFMPEG=%USERPROFILE%\\beyonddown\\bin\\ffmpeg.exe"',
          'rd /s /q "%USERPROFILE%\\beyonddown-tmp" >nul 2>nul',
          'del "%TEMP%\\beyonddown-ffmpeg.zip" >nul 2>nul',
          "echo [setup] done. Next runs will be instant.",
          ":ready",
          "echo [1/3] downloading video stream...",
          `${curlBase} ${headerArgs} -o ${JSON.stringify(escBat(vFile))} ${JSON.stringify(escBat(video.baseUrl))} || (echo video download failed & pause & exit /b 1)`,
        ];
        if (audio) {
          lines.push(
            "echo [2/3] downloading audio stream...",
            `${curlBase} ${headerArgs} -o ${JSON.stringify(escBat(aFile))} ${JSON.stringify(escBat(audio.baseUrl))} || (echo audio download failed & pause & exit /b 1)`,
            "echo [3/3] merging...",
            `"%FFMPEG%" -y -i ${JSON.stringify(escBat(vFile))} -i ${JSON.stringify(escBat(aFile))} -c copy ${JSON.stringify(escBat(outFile))} || (echo merge failed & pause & exit /b 1)`,
            `del ${JSON.stringify(escBat(vFile))} ${JSON.stringify(escBat(aFile))}`,
          );
        } else {
          lines.push(
            "echo [2/2] muxing...",
            `"%FFMPEG%" -y -i ${JSON.stringify(escBat(vFile))} -c copy ${JSON.stringify(escBat(outFile))} || (echo mux failed & pause & exit /b 1)`,
            `del ${JSON.stringify(escBat(vFile))}`,
          );
        }
        lines.push(`echo Done: ${escBat(outFile)}`, "pause");
        return new Response(lines.join("\r\n") + "\r\n", {
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${base}.bat`)}`,
          },
        });
      }

      const lines = [
        "#!/bin/sh",
        'cd "$(dirname "$0")"',
        "FFMPEG=$(command -v ffmpeg || [ -x ./ffmpeg ] && echo ./ffmpeg)",
        'if [ -z "$FFMPEG" ]; then echo "未找到 ffmpeg：请安装或放到本脚本同目录"; exit 1; fi',
        'echo "[1/3] 下载视频流…"',
        `${curlBase} ${headerArgs} -o ${JSON.stringify(vFile)} ${JSON.stringify(video.baseUrl)} || { echo 视频流下载失败; exit 1; }`,
      ];
      if (audio) {
        lines.push(
          'echo "[2/3] 下载音频流…"',
          `${curlBase} ${headerArgs} -o ${JSON.stringify(aFile)} ${JSON.stringify(audio.baseUrl)} || { echo 音频流下载失败; exit 1; }`,
          'echo "[3/3] 合并…"',
          `"$FFMPEG" -y -i ${JSON.stringify(vFile)} -i ${JSON.stringify(aFile)} -c copy ${JSON.stringify(outFile)} || { echo 合并失败; exit 1; }`,
          `rm -f ${JSON.stringify(vFile)} ${JSON.stringify(aFile)}`,
        );
      } else {
        lines.push(
          'echo "[2/2] 封装…"',
          `"$FFMPEG" -y -i ${JSON.stringify(vFile)} -c copy ${JSON.stringify(outFile)} || { echo 封装失败; exit 1; }`,
          `rm -f ${JSON.stringify(vFile)}`,
        );
      }
      lines.push(`echo "完成：${outFile}"`);
      return new Response(lines.join("\n") + "\n", {
        headers: {
          "content-type": "text/x-shellscript; charset=utf-8",
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${base}.sh`)}`,
        },
      });
    }

    return apiError("不支持的 format，可选 raw / aria2 / ytdlp / bat / sh");
  } catch (e) {
    return apiError(e.message || "生成下载任务失败", 502, e.code ? { biliCode: e.code } : {});
  }
}
