// 核心链路真实验证（bun test/verify.mjs）
// 直接调用 lib/ 层函数请求 B站真实接口，不依赖 KV / Pages 部署
import { md5 } from "../lib/md5.js";
import { buvidFP } from "../lib/murmur3.js";
import { wbiSign, getMixinKey } from "../lib/wbi.js";
import {
  UA, activateRisk, qrcodeGenerate, qrcodePoll, nav, navToWbi,
  viewInfo, simplifyView, playurl,
} from "../lib/bili.js";

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 1. 算法单元验证 ----------

const MD5_VECTORS = [
  ["", "d41d8cd98f00b204e9800998ecf8427e"],
  ["abc", "900150983cd24fb0d6963f7d28e17f72"],
  ["The quick brown fox jumps over the lazy dog", "9e107d9d372bb6826bd81d3542a419d6"],
  ["中文测试", md5("中文测试")], // 仅验证可运行
];
{
  let ok = MD5_VECTORS.slice(0, 3).every(([input, expect]) => md5(input) === expect);
  record("MD5 标准向量", ok, ok ? "" : `got ${md5("abc")}`);
}
{
  // mixin key 已知公开用例（bilibili-API-collect 文档示例 key）
  const key = getMixinKey("ea1db124af3c7062474693fa704f4ff8", "ad3aa03ccd86ccf1424f0c35b905a4b1");
  record("WBI mixinKey 生成（长度/字符集）", key.length === 32, key);
}

// ---------- 2. 风控激活链（真实接口） ----------

let riskBundle;
try {
  riskBundle = await activateRisk({});
  const r = riskBundle.risk;
  record("finger/spi 获取 buvid3/buvid4", Boolean(r.buvid3 && r.buvid4), `buvid3=${String(r.buvid3).slice(0, 16)}…`);
  record("GenWebTicket 获取 bili_ticket", Boolean(r.bili_ticket), `ttl 至 ${new Date(r.bili_ticket_expires * 1000).toISOString()}`);
  record("ExClimbWuzhi 激活", Boolean(r.ex_activated));
  record("buvid_fp 计算", r.buvid_fp.length > 8, r.buvid_fp);
  record("GenWebTicket 附带 WBI key", Boolean(riskBundle.wbi?.img_key && riskBundle.wbi?.sub_key),
    riskBundle.wbi ? `${riskBundle.wbi.img_key}/${riskBundle.wbi.sub_key}` : "");
} catch (e) {
  record("风控激活链", false, e.message);
  riskBundle = { risk: {}, wbi: null };
}

const guestSession = { risk: riskBundle.risk, login: null, wbi: riskBundle.wbi };

// ---------- 3. 二维码登录（生成 + 未扫码轮询） ----------

try {
  const qr = await qrcodeGenerate(guestSession);
  record("二维码生成", Boolean(qr.qrcode_key && qr.url), `key=${qr.qrcode_key}`);
  const poll = await qrcodePoll(qr.qrcode_key, guestSession);
  record("二维码轮询（未扫码应返回 86101）", poll.data.code === 86101, `code=${poll.data.code} msg=${poll.data.message}`);
} catch (e) {
  record("二维码登录链", false, e.message);
}

// ---------- 4. 用户信息（未登录） ----------

try {
  const navData = await nav(guestSession);
  const wbi = navToWbi(navData);
  record("nav 未登录", navData.isLogin === false, `uname=${navData.uname}`);
  record("nav 返回 WBI key", Boolean(wbi?.img_key));
  if (wbi) guestSession.wbi = wbi;
} catch (e) {
  record("nav", false, e.message);
}

// ---------- 5. 视频信息 + playurl（未登录，真实 WBI 签名） ----------

const BVID = "BV1GJ411x7h7";
let cid = null;
try {
  const data = await viewInfo(BVID, guestSession);
  const v = simplifyView(data);
  cid = v.pages[0].cid;
  record("视频信息（view）", Boolean(v.title && cid), `《${v.title}》cid=${cid} UP=${v.owner.name}`);
} catch (e) {
  record("视频信息", false, e.message);
}

let playData = null;
if (cid) {
  try {
    const client = { session: guestSession, wbi: guestSession.wbi };
    playData = await playurl(client, { bvid: BVID, cid, qn: 127 });
    record("playurl（WBI 签名，未登录）", Boolean(playData.dash?.video?.length),
      `quality=${playData.quality} accept=[${playData.accept_quality}] 视频轨=${playData.dash.video.length} 音频轨=${playData.dash.audio.length}`);
  } catch (e) {
    record("playurl", false, e.message);
  }
}

// ---------- 6. 直链可下载性（模式 B 核心前提：仅 Referer+UA，无 Cookie） ----------

if (playData?.dash?.video?.length) {
  const track = playData.dash.video.find((t) => t.baseUrl) || playData.dash.video[0];
  const backups = (track.backupUrl || []).filter((u) => {
    try { const h = new URL(u).hostname; return !["mcdn", "pcdn", "szbdyd.com", "mountaintoys.cn"].some((d) => h.includes(d)); }
    catch { return false; }
  });
  const candidates = [track.baseUrl, ...backups];
  let probed = false;
  let lastDetail = "";
  for (const url of candidates.slice(0, 3)) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "user-agent": UA, "referer": "https://www.bilibili.com/", "range": "bytes=0-1023" },
      });
      if (res.status === 206 || res.status === 200) {
        const buf = await res.arrayBuffer();
        probed = buf.byteLength > 0;
        lastDetail = `${res.status} ${buf.byteLength}B ${new URL(url).hostname}`;
        break;
      }
      lastDetail = `${res.status}`;
    } catch (e) {
      lastDetail = e.message;
    }
    await sleep(300);
  }
  record("直链 Range 下载探测（无 Cookie）", probed, lastDetail);
}

// ---------- 汇总 ----------

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 项通过${failed.length ? "，失败项：" + failed.map((f) => f.name).join("、") : ""}`);
process.exit(failed.length ? 1 : 0);
