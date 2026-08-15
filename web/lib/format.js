import { ethers } from 'ethers';

/** Wei -> a short ETH string with no trailing zero noise. */
export function eth(wei) {
  if (wei === null || wei === undefined) return null;
  const s = ethers.formatEther(wei);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** 18-decimal token amount -> plain string. */
export function soul(wei) {
  if (wei === null || wei === undefined) return null;
  const s = ethers.formatUnits(wei, 18);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

export function num(v) {
  if (v === null || v === undefined) return null;
  return Number(v);
}

/** 0xabc123…def456 — first 6 + last 6 hex chars. */
export function shortAddr(a) {
  if (!a || a.length < 16) return a || '';
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

export function relTime(tsSeconds, nowMs = Date.now()) {
  const d = Math.max(0, Math.floor(nowMs / 1000 - Number(tsSeconds)));
  if (d < 10) return 'just now';
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 2592000) return `${Math.floor(d / 86400)}d ago`;
  return `${Math.floor(d / 2592000)}mo ago`;
}

/** 1234 -> "1,234" */
export function commas(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-US');
}
