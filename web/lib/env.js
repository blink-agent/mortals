// Central env access. Nothing here throws at import time — a missing value
// yields a harmless placeholder so `next build` stays green without secrets.

const ZERO = '0x0000000000000000000000000000000000000000';

function pub(name, fallback) {
  const v = process.env[name];
  return v && v.length ? v : fallback;
}

export const CHAIN_ID = Number(pub('NEXT_PUBLIC_CHAIN_ID', '4663'));
export const RPC_URL = pub('NEXT_PUBLIC_RPC', 'https://rpc.mainnet.chain.robinhood.com');
export const EXPLORER = pub('NEXT_PUBLIC_EXPLORER', 'https://robinhoodchain.blockscout.com').replace(/\/$/, '');

export const ADDR = {
  mortals: pub('NEXT_PUBLIC_MORTALS_ADDR', ZERO),
  soul: pub('NEXT_PUBLIC_SOUL_ADDR', ZERO),
  staking: pub('NEXT_PUBLIC_STAKING_ADDR', ZERO),
  game: pub('NEXT_PUBLIC_GAME_ADDR', ZERO),
  chat: pub('NEXT_PUBLIC_CHAT_ADDR', ZERO),
};

export const SITE_URL = pub('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000').replace(/\/$/, '');

// server-only
export const SIGNER_PK = process.env.SIGNER_PK || '';
export const PUZZLE_SECRET = process.env.PUZZLE_SECRET || 'dev-insecure-puzzle-secret';
export const ART_SALT = process.env.ART_SALT || 'mortals-mainnet';
export const OPERATOR_ADDR = (process.env.OPERATOR_ADDR || ZERO).toLowerCase();
export const CHAT_DEPLOY_BLOCK = Number(process.env.CHAT_DEPLOY_BLOCK || '0');

export const MAX_ETH_SUPPLY = 9872;
export const TIER_SIZE = 1234;
export const TIER_COUNT = 8;
export const MAX_PER_TX = 32;

// Price ladder, per token, by 0-based ETH-mint index. Mirrors Mortals.sol.
// Kept here purely for static rendering; every quote sent to an agent comes
// from priceForQuantity() on-chain.
export const TIERS = [
  { tier: 0, from: 1, to: 1234, priceEth: '0', label: 'free' },
  { tier: 1, from: 1235, to: 2468, priceEth: '0.00001', label: '0.00001' },
  { tier: 2, from: 2469, to: 3702, priceEth: '0.00002', label: '0.00002' },
  { tier: 3, from: 3703, to: 4936, priceEth: '0.00004', label: '0.00004' },
  { tier: 4, from: 4937, to: 6170, priceEth: '0.00008', label: '0.00008' },
  { tier: 5, from: 6171, to: 7404, priceEth: '0.00016', label: '0.00016' },
  { tier: 6, from: 7405, to: 8638, priceEth: '0.00032', label: '0.00032' },
  { tier: 7, from: 8639, to: 9872, priceEth: '0.00064', label: '0.00064' },
];

export function isPlaceholder(addr) {
  return !addr || addr.toLowerCase() === ZERO;
}

export const ZERO_ADDRESS = ZERO;
