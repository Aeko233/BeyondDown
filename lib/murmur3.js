// murmur3 x64 128（BigInt 移植），用于计算 buvid_fp
// 移植自 Bili23-Downloader src/util/auth/cookie.py get_buvid_fp（其本身为 B站前端 buvid_fp 算法）

const MOD = 1n << 64n;
const C1 = 0x87c37b91114253d5n;
const C2 = 0x4cf5ad432745937fn;
const C3 = 0x52dce729n;
const C4 = 0x38495ab5n;
const M = 5n;
const R1 = 27n;
const R2 = 31n;
const R3 = 33n;

function rotl(x, k) {
  return ((x << k) | (x >> (64n - k))) & (MOD - 1n);
}

function fmix64(k) {
  const C1F = 0xff51afd7ed558ccdn;
  const C2F = 0xc4ceb9fe1a85ec53n;
  let t = k & (MOD - 1n);
  t ^= t >> 33n;
  t = (t * C1F) % MOD;
  t ^= t >> 33n;
  t = (t * C2F) % MOD;
  t ^= t >> 33n;
  return t;
}

function le64(bytes, offset) {
  let v = 0n;
  for (let i = 7; i >= 0; i--) {
    v = (v << 8n) | BigInt(bytes[offset + i]);
  }
  return v;
}

export function murmur3x64_128(bytes, seed) {
  let h1 = BigInt(seed) & (MOD - 1n);
  let h2 = h1;
  let processed = 0;
  let pos = 0;

  while (true) {
    const remaining = bytes.length - pos;
    if (remaining >= 16) {
      const k1 = le64(bytes, pos);
      const k2 = le64(bytes, pos + 8);
      h1 ^= rotl((k1 * C1) % MOD, R2) * C2 % MOD;
      h1 = ((rotl(h1, R1) + h2) * M + C3) % MOD;
      h2 ^= rotl((k2 * C2) % MOD, R3) * C1 % MOD;
      h2 = ((rotl(h2, R2) + h1) * M + C4) % MOD;
      processed += 16;
      pos += 16;
    } else if (remaining === 0) {
      h1 ^= BigInt(processed);
      h2 ^= BigInt(processed);
      h1 = (h1 + h2) % MOD;
      h2 = (h2 + h1) % MOD;
      h1 = fmix64(h1);
      h2 = fmix64(h2);
      h1 = (h1 + h2) % MOD;
      h2 = (h2 + h1) % MOD;
      return (h2 << 64n) | h1;
    } else {
      // 尾部不足 16 字节：按原始实现的字节序构造（高位补进 k2，低位补进 k1）
      let k1 = 0n;
      let k2 = 0n;
      const read = bytes.subarray(pos);
      if (read.length >= 15) k2 ^= BigInt(read[14]) << 48n;
      if (read.length >= 14) k2 ^= BigInt(read[13]) << 40n;
      if (read.length >= 13) k2 ^= BigInt(read[12]) << 32n;
      if (read.length >= 12) k2 ^= BigInt(read[11]) << 24n;
      if (read.length >= 11) k2 ^= BigInt(read[10]) << 16n;
      if (read.length >= 10) k2 ^= BigInt(read[9]) << 8n;
      if (read.length >= 9) {
        k2 ^= BigInt(read[8]);
        k2 = rotl((k2 * C2) % MOD, R3) * C1 % MOD;
        h2 ^= k2;
      }
      if (read.length >= 8) k1 ^= BigInt(read[7]) << 56n;
      if (read.length >= 7) k1 ^= BigInt(read[6]) << 48n;
      if (read.length >= 6) k1 ^= BigInt(read[5]) << 40n;
      if (read.length >= 5) k1 ^= BigInt(read[4]) << 32n;
      if (read.length >= 4) k1 ^= BigInt(read[3]) << 24n;
      if (read.length >= 3) k1 ^= BigInt(read[2]) << 16n;
      if (read.length >= 2) k1 ^= BigInt(read[1]) << 8n;
      if (read.length >= 1) {
        k1 ^= BigInt(read[0]);
        k1 = rotl((k1 * C1) % MOD, R2) * C2 % MOD;
        h1 ^= k1;
      }
      processed += read.length;
      pos += read.length;
    }
  }
}

// buvid_fp = murmur3_x64_128(UA, seed=31)，低 64 位与高 64 位 hex 拼接（不补零，与 Python hex() 一致）
export function buvidFP(userAgent, seed = 31) {
  const bytes = new TextEncoder().encode(userAgent);
  const m = murmur3x64_128(bytes, seed);
  return ((m & (MOD - 1n)).toString(16)) + ((m >> 64n).toString(16));
}
