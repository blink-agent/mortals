import { ethers } from 'ethers';
import mortalsAbi from './abi/Mortals.json';
import soulAbi from './abi/Soul.json';
import stakingAbi from './abi/Staking.json';
import gameAbi from './abi/Game.json';
import chatAbi from './abi/Chat.json';
import { RPC_URL, CHAIN_ID, ADDR } from './env';

export const ABI = {
  mortals: mortalsAbi,
  soul: soulAbi,
  staking: stakingAbi,
  game: gameAbi,
  chat: chatAbi,
};

let _provider = null;

export function provider() {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, {
      staticNetwork: ethers.Network.from(CHAIN_ID),
      batchMaxCount: 8,
    });
  }
  return _provider;
}

function make(name) {
  return new ethers.Contract(ADDR[name], ABI[name], provider());
}

let _c = {};
export function contracts() {
  if (!_c.mortals) {
    _c = {
      mortals: make('mortals'),
      soul: make('soul'),
      staking: make('staking'),
      game: make('game'),
      chat: make('chat'),
    };
  }
  return _c;
}

export const mortalsInterface = new ethers.Interface(mortalsAbi);
export const chatInterface = new ethers.Interface(chatAbi);

/**
 * Run a chain read, returning `fallback` instead of throwing.
 * Every stat on the site is optional — placeholder envs and dead RPCs must
 * never take the page (or the build) down.
 */
export async function soft(fn, fallback = null) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Resolve an object of promises, each failing soft to null. */
export async function softAll(map) {
  const keys = Object.keys(map);
  const results = await Promise.allSettled(keys.map((k) => map[k]));
  const out = {};
  keys.forEach((k, i) => {
    out[k] = results[i].status === 'fulfilled' ? results[i].value : null;
  });
  return out;
}
