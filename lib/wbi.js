// WBI 签名（bilibili-API-collect 文档 + Bili23-Downloader src/util/parse/parser/base.py enc_wbi 交叉验证）
import { md5 } from "./md5.js";

export const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

export function getMixinKey(imgKey, subKey) {
  const orig = imgKey + subKey;
  let key = "";
  for (const i of MIXIN_KEY_ENC_TAB) key += orig[i];
  return key.slice(0, 32);
}

// 追加 wts、排序、过滤 !'()*、md5 签名，返回完整 query string（含 w_rid）
export function wbiSign(params, imgKey, subKey) {
  const mixinKey = getMixinKey(imgKey, subKey);

  const withTs = { ...params, wts: Math.floor(Date.now() / 1000) };
  const entries = Object.entries(withTs)
    .map(([k, v]) => [k, String(v).replace(/[!'()*]/g, "")])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const query = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  return `${query}&w_rid=${md5(query + mixinKey)}`;
}
