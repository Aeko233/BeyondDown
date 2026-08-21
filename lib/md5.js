// 纯 JS MD5（Workers 的 WebCrypto 不提供 MD5，WBI 签名必须用它）
// 常量表按 RFC 1321 运行时生成，避免手抄 64 个常量出错

function safeAdd(x, y) {
  const lsw = (x & 0xffff) + (y & 0xffff);
  const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xffff);
}

function bitRotateLeft(num, cnt) {
  return (num << cnt) | (num >>> (32 - cnt));
}

const S = [
  [7, 12, 17, 22],
  [5, 9, 14, 20],
  [4, 11, 16, 23],
  [6, 10, 15, 21],
];

const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));

function binlMD5(x, bitLen) {
  x[bitLen >> 5] |= 0x80 << (bitLen % 32);
  x[(((bitLen + 64) >>> 9) << 4) + 14] = bitLen;

  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;

  for (let i = 0; i < 64; i++) {
    let f;
    let g;
    if (i < 16) {
      f = (b & c) | (~b & d);
      g = i;
    } else if (i < 32) {
      f = (d & b) | (~d & c);
      g = (5 * i + 1) % 16;
    } else if (i < 48) {
      f = b ^ c ^ d;
      g = (3 * i + 5) % 16;
    } else {
      f = c ^ (b | ~d);
      g = (7 * i) % 16;
    }

    const tmp = d;
    d = c;
    c = b;
    const sum = (a + f + K[i] + x[g]) | 0;
    b = safeAdd(b, bitRotateLeft(sum, S[i >> 4][i % 4]));
    a = tmp;
  }

  return [safeAdd(a, 1732584193), safeAdd(b, -271733879), safeAdd(c, -1732584194), safeAdd(d, 271733878)];
}

export function md5(input) {
  const bytes = new TextEncoder().encode(input);
  // 必须按完整的 16 字块分配并填 0：不足 64 字节的消息会让未初始化字（undefined）
  // 进入轮函数，NaN|0 = 0 会把整轮累加清掉
  const words = new Array((((bytes.length + 8) >> 6) + 1) * 16).fill(0);
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] |= bytes[i] << (8 * (i % 4));
  }

  const out = binlMD5(words, bytes.length * 8);
  let hex = "";
  for (const word of out) {
    for (let j = 0; j < 4; j++) {
      hex += ((word >> (8 * j)) & 0xff).toString(16).padStart(2, "0");
    }
  }
  return hex;
}
