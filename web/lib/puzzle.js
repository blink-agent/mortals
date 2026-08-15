// Stateless puzzle tokens.
//
// There is no database. A puzzle is a signed blob:
//
//   puzzleId = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload))
//
// The payload carries the wallet, quantity, expiry, a random salt, and a
// hash of the answer — never the answer itself. /api/solve re-hashes the
// submitted answer and compares. Nothing is stored server-side.
//
// Pure node:crypto so this file runs unchanged under plain `node` in tests.

import crypto from 'node:crypto';

const PUZZLE_TTL_MS = 5 * 60 * 1000;

function secret() {
  return process.env.PUZZLE_SECRET || 'dev-insecure-puzzle-secret';
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function hmac(payloadB64) {
  return b64url(crypto.createHmac('sha256', secret()).update(payloadB64).digest());
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

/** Normalise a submitted answer: trim, lowercase, drop separators and 0x. */
export function normalizeAnswer(a) {
  return String(a ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s,_]/g, '')
    .replace(/^0x/, '');
}

export function hashAnswer(answer, rand) {
  return sha256(`${normalizeAnswer(answer)}|${secret()}|${rand}`);
}

// --------------------------------------------------------------------------
// Puzzle generation — one tier, plain arithmetic. Hard enough that a curl
// loop can't mint, trivial for anything that can reason.
// --------------------------------------------------------------------------

function ri(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

const GENERATORS = [
  function add() {
    const a = ri(12, 499), b = ri(12, 499);
    return { question: `What is ${a} + ${b}?`, answer: String(a + b) };
  },
  function sub() {
    const a = ri(120, 900), b = ri(11, 119);
    return { question: `What is ${a} - ${b}?`, answer: String(a - b) };
  },
  function mul() {
    const a = ri(2, 12), b = ri(11, 99);
    return { question: `What is ${a} x ${b}?`, answer: String(a * b) };
  },
  function div() {
    const b = ri(2, 12), q = ri(3, 40);
    return { question: `What is ${b * q} / ${b}?`, answer: String(q) };
  },
  function mod() {
    const b = ri(3, 17), a = ri(40, 400);
    return { question: `What is ${a} mod ${b}?`, answer: String(a % b) };
  },
  function square() {
    const n = ri(7, 40);
    return { question: `What is ${n} squared?`, answer: String(n * n) };
  },
  function half() {
    const n = ri(20, 400) * 2;
    return { question: `What is half of ${n}?`, answer: String(n / 2) };
  },
  function double() {
    const n = ri(17, 499);
    return { question: `What is double ${n}?`, answer: String(n * 2) };
  },
  function triSum() {
    const a = ri(10, 300), b = ri(10, 300), c = ri(10, 300);
    return { question: `What is ${a} + ${b} + ${c}?`, answer: String(a + b + c) };
  },
  function toHex() {
    const n = ri(16, 255);
    return {
      question: `What is ${n} in hexadecimal? Answer without the 0x prefix.`,
      answer: n.toString(16),
    };
  },
  function toBin() {
    const n = ri(5, 63);
    return { question: `What is ${n} in binary?`, answer: n.toString(2) };
  },
];

export function makePuzzle() {
  const gen = GENERATORS[Math.floor(Math.random() * GENERATORS.length)];
  return gen();
}

// --------------------------------------------------------------------------
// Token issue / verify
// --------------------------------------------------------------------------

export function issuePuzzleId({ wallet, quantity, answer, now = Date.now(), ttlMs = PUZZLE_TTL_MS }) {
  const rand = crypto.randomBytes(16).toString('hex');
  const exp = now + ttlMs;
  const payload = {
    wallet: String(wallet).toLowerCase(),
    quantity: Number(quantity),
    answerHash: hashAnswer(answer, rand),
    rand,
    exp,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return { puzzleId: `${payloadB64}.${hmac(payloadB64)}`, expiresAt: exp };
}

/**
 * @returns {{ok:true, payload:object} | {ok:false, code:string, message:string, status:number}}
 */
export function verifyPuzzleId(puzzleId, { wallet, answer, now = Date.now() }) {
  if (typeof puzzleId !== 'string' || !puzzleId.includes('.')) {
    return { ok: false, code: 'puzzle_not_found', message: 'Malformed puzzleId.', status: 404 };
  }
  const idx = puzzleId.lastIndexOf('.');
  const payloadB64 = puzzleId.slice(0, idx);
  const sig = puzzleId.slice(idx + 1);

  const expected = hmac(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: 'puzzle_not_found', message: 'Invalid puzzleId signature.', status: 404 };
  }

  let payload;
  try {
    payload = JSON.parse(fromB64url(payloadB64).toString('utf8'));
  } catch {
    return { ok: false, code: 'puzzle_not_found', message: 'Unreadable puzzleId.', status: 404 };
  }

  if (typeof payload.exp !== 'number' || now > payload.exp) {
    return { ok: false, code: 'puzzle_expired', message: 'Puzzle expired. Request a new one from /api/puzzle.', status: 400 };
  }

  if (String(wallet || '').toLowerCase() !== payload.wallet) {
    return { ok: false, code: 'wallet_mismatch', message: 'This puzzle was issued to a different wallet.', status: 400 };
  }

  if (hashAnswer(answer, payload.rand) !== payload.answerHash) {
    return { ok: false, code: 'wrong_answer', message: 'Wrong answer. Request a new puzzle from /api/puzzle.', status: 400 };
  }

  return { ok: true, payload };
}

export const PUZZLE_TTL = PUZZLE_TTL_MS;
