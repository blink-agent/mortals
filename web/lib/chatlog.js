// Chat.sol stores nothing — messages are events. This module scans them once,
// keeps the result in module memory, and afterwards only scans the new tail.
// A warm Vercel lambda therefore does ~one small getLogs per 10s window.

import { provider, chatInterface } from './chain';
import { ADDR, CHAT_DEPLOY_BLOCK, OPERATOR_ADDR, isPlaceholder } from './env';

const CACHE_MS = 10_000;
const MAX_CHUNK = 100_000;
const MIN_CHUNK = 2_000;
const MAX_CHUNKS_PER_PASS = 60; // bounds a cold scan; the tail catches up next call

const MSG_TOPIC = chatInterface.getEvent('Message').topicHash;
const USER_TOPIC = chatInterface.getEvent('UsernameSet').topicHash;

const state = {
  messages: [], // oldest -> newest
  usernames: new Map(), // lowercased address -> name (last write wins)
  lastScanned: null, // last block already folded in
  fetchedAt: 0,
  inflight: null,
};

async function getLogsChunked(from, to) {
  const out = [];
  let cursor = from;
  let chunk = MAX_CHUNK;
  let passes = 0;

  while (cursor <= to && passes < MAX_CHUNKS_PER_PASS) {
    const end = Math.min(cursor + chunk - 1, to);
    try {
      const logs = await provider().getLogs({
        address: ADDR.chat,
        fromBlock: cursor,
        toBlock: end,
      });
      out.push(...logs);
      cursor = end + 1;
      passes++;
    } catch (e) {
      // Most RPCs answer "too many blocks" by erroring; back off and retry.
      if (chunk <= MIN_CHUNK) throw e;
      chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 4));
    }
  }

  return { logs: out, scannedTo: cursor - 1 };
}

function fold(logs) {
  for (const log of logs) {
    const topic = log.topics?.[0];
    try {
      if (topic === MSG_TOPIC) {
        const parsed = chatInterface.parseLog(log);
        state.messages.push({
          address: parsed.args.sender,
          text: parsed.args.text,
          timestamp: Number(parsed.args.timestamp),
          blockNumber: log.blockNumber,
          logIndex: log.index ?? log.logIndex ?? 0,
        });
      } else if (topic === USER_TOPIC) {
        const parsed = chatInterface.parseLog(log);
        state.usernames.set(String(parsed.args.wallet).toLowerCase(), parsed.args.name);
      }
    } catch {
      // unknown / malformed log — skip
    }
  }
  state.messages.sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber - b.blockNumber,
  );
}

async function refresh() {
  const latest = await provider().getBlockNumber();
  const from = state.lastScanned === null ? Math.max(0, CHAT_DEPLOY_BLOCK) : state.lastScanned + 1;
  if (from > latest) {
    state.fetchedAt = Date.now();
    return;
  }
  const { logs, scannedTo } = await getLogsChunked(from, latest);
  fold(logs);
  state.lastScanned = Math.max(state.lastScanned ?? -1, scannedTo);
  state.fetchedAt = Date.now();
}

async function ensureFresh() {
  if (isPlaceholder(ADDR.chat)) return;
  if (Date.now() - state.fetchedAt < CACHE_MS && state.lastScanned !== null) return;
  if (state.inflight) {
    await state.inflight;
    return;
  }
  state.inflight = refresh().finally(() => {
    state.inflight = null;
  });
  await state.inflight;
}

function shape(m) {
  const lower = String(m.address).toLowerCase();
  const name = state.usernames.get(lower);
  return {
    address: m.address,
    name: name && name.length ? name : null,
    text: m.text,
    timestamp: m.timestamp,
    isOperator: lower === OPERATOR_ADDR,
  };
}

/**
 * Newest-first, max `limit`. `before` is a unix-seconds cursor (exclusive).
 * Returns [] rather than throwing when the chain is unreachable.
 */
export async function getMessages({ before = null, limit = 100 } = {}) {
  try {
    await ensureFresh();
  } catch {
    // fall through to whatever is cached (possibly nothing)
  }
  let list = state.messages.slice().reverse();
  if (before !== null && Number.isFinite(before)) {
    list = list.filter((m) => m.timestamp < before);
  }
  return list.slice(0, limit).map(shape);
}

/** Operator-only lane for the pinned TRANSMISSIONS box. */
export async function getOperatorMessages({ limit = 3 } = {}) {
  const all = await getMessages({ limit: 500 });
  return all.filter((m) => m.isOperator).slice(0, limit);
}

export function chatCacheState() {
  return { lastScanned: state.lastScanned, count: state.messages.length, fetchedAt: state.fetchedAt };
}
