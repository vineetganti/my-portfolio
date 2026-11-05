"use client";

import { useState } from "react";

/** Paillier encryption with real keys: adding happens on ciphertexts, without the private key. */
const B = BigInt;
const rand = (bits: number) => {
  const bytes = new Uint8Array(Math.ceil(bits / 8));
  crypto.getRandomValues(bytes);
  bytes[0] |= 0x80;
  bytes[bytes.length - 1] |= 1;
  return bytes.reduce((n, b) => (n << B(8)) | BigInt(b), B(0));
};

function modPow(base: bigint, exp: bigint, mod: bigint) {
  let result = B(1);
  let b = base % mod;
  let e = exp;
  while (e > B(0)) {
    if (e & B(1)) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= B(1);
  }
  return result;
}

function isPrime(n: bigint) {
  for (const p of [B(2), B(3), B(5), B(7), B(11), B(13), B(17), B(19), B(23), B(29)]) {
    if (n % p === B(0)) return n === p;
  }
  let d = n - B(1);
  let r = 0;
  while (d % B(2) === B(0)) {
    d /= B(2);
    r++;
  }
  outer: for (let i = 0; i < 12; i++) {
    const a = B(2) + (rand(64) % (n - B(3)));
    let x = modPow(a, d, n);
    if (x === B(1) || x === n - B(1)) continue;
    for (let j = 0; j < r - 1; j++) {
      x = (x * x) % n;
      if (x === n - B(1)) continue outer;
    }
    return false;
  }
  return true;
}

function prime(bits: number) {
  for (;;) {
    const c = rand(bits);
    if (isPrime(c)) return c;
  }
}

const gcd = (a: bigint, b: bigint): bigint => (b === B(0) ? a : gcd(b, a % b));

function inverse(a: bigint, m: bigint) {
  let [r0, r1] = [m, a % m];
  let [t0, t1] = [B(0), B(1)];
  while (r1 !== B(0)) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [t0, t1] = [t1, t0 - q * t1];
  }
  return ((t0 % m) + m) % m;
}

interface Keys {
  n: bigint;
  n2: bigint;
  lambda: bigint;
  mu: bigint;
}

function keygen(bits: number): Keys {
  const p = prime(bits);
  let q = prime(bits);
  while (q === p) q = prime(bits);
  const n = p * q;
  const n2 = n * n;
  const lambda = ((p - B(1)) * (q - B(1))) / gcd(p - B(1), q - B(1));
  const l = (modPow(n + B(1), lambda, n2) - B(1)) / n;
  return { n, n2, lambda, mu: inverse(l, n) };
}

function encrypt(m: bigint, k: Keys) {
  let r = rand(k.n.toString(2).length - 1) % k.n;
  while (gcd(r, k.n) !== B(1)) r = rand(k.n.toString(2).length - 1) % k.n;
  return (modPow(k.n + B(1), m, k.n2) * modPow(r, k.n, k.n2)) % k.n2;
}

const decrypt = (c: bigint, k: Keys) => (((modPow(c, k.lambda, k.n2) - B(1)) / k.n) * k.mu) % k.n;

const SALARIES = [
  ["Ana", 52000],
  ["Ben", 61000],
  ["Cara", 47000],
] as const;

const short = (n: bigint) => {
  const s = n.toString(16);
  return `${s.slice(0, 18)}…${s.slice(-6)}`;
};

/**
 * Real additively homomorphic encryption in the browser. The "server" column adds encrypted numbers
 * by multiplying them, holding no key, and only the client can read the result.
 */
export default function HomomorphicLab() {
  const [keys, setKeys] = useState<Keys | null>(null);
  const [cipher, setCipher] = useState<bigint[]>([]);
  const [sum, setSum] = useState<bigint | null>(null);
  const [plain, setPlain] = useState<bigint | null>(null);
  const [ms, setMs] = useState<{ gen?: number; add?: number }>({});

  const timed = <T,>(fn: () => T): [T, number] => {
    const start = performance.now();
    const r = fn();
    return [r, performance.now() - start];
  };

  const start = () => {
    const [k, gen] = timed(() => keygen(256));
    setKeys(k);
    setCipher(SALARIES.map(([, s]) => encrypt(BigInt(s), k)));
    setSum(null);
    setPlain(null);
    setMs({ gen });
  };

  const add = () => {
    if (!keys) return;
    const [c, took] = timed(() => cipher.reduce((a, b) => (a * b) % keys.n2));
    setSum(c);
    setMs((m) => ({ ...m, add: took }));
  };

  return (
    <div
      className="diagram diagram-live data-trace he-lab"
      role="group"
      aria-label="Real Paillier encryption in your browser. Three salaries are encrypted on the client. The server multiplies the ciphertexts without any key, which adds the hidden numbers. Only the client can decrypt the total."
    >
      <div className="he-cols">
        <div className="he-col">
          <div className="he-title">Client: holds the private key</div>
          {SALARIES.map(([name, s]) => (
            <div key={name} className="he-row">
              <span>{name}</span>
              <strong>{s.toLocaleString("en-US")}</strong>
            </div>
          ))}
          {plain !== null && (
            <div className="he-row he-result">
              <span>Decrypted total</span>
              <strong>{plain.toLocaleString("en-US")}</strong>
            </div>
          )}
        </div>
        <div className="he-col">
          <div className="he-title">Server: sees only this</div>
          {cipher.length === 0 && <div className="he-row he-muted">Nothing yet.</div>}
          {cipher.map((c, i) => (
            <div key={i} className="he-row he-cipher">
              {short(c)}
            </div>
          ))}
          {sum !== null && (
            <div className="he-row he-cipher he-result">
              <span>Encrypted total: {short(sum)}</span>
            </div>
          )}
        </div>
      </div>
      <div className="tree-actions">
        <button type="button" className="chart-button" onClick={start}>
          {keys ? "New keys, encrypt again" : "Make keys and encrypt"}
        </button>
        <button type="button" className="chart-button" disabled={!keys || sum !== null} onClick={add}>
          Server adds them
        </button>
        <button type="button" className="chart-button" disabled={sum === null || plain !== null} onClick={() => keys && sum !== null && setPlain(decrypt(sum, keys))}>
          Client decrypts
        </button>
      </div>
      <div className="chart-readout">
        {!keys && "Press the first button. The keys are 512-bit Paillier keys, made here in your browser."}
        {keys && sum === null && `Keys made in ${ms.gen?.toFixed(0)} ms. Each ciphertext is ${keys.n2.toString(2).length} bits, to hide a number that fits in 16. The same salary would encrypt differently every time.`}
        {sum !== null && plain === null && `Added in ${ms.add?.toFixed(2)} ms, by multiplying the ciphertexts. The server never saw a salary.`}
        {plain !== null && "Correct, and the server never held a key. Paillier can only add. Fully homomorphic schemes handle any computation, at a far higher cost."}
      </div>
    </div>
  );
}
