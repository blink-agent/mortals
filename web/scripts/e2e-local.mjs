#!/usr/bin/env node
/**
 * Local end-to-end test. Not part of the deployment — it needs a hardhat node.
 *
 *   cd contracts && npx hardhat node &
 *   cd contracts && SIGNER_ADDRESS=... npx hardhat run scripts/deploy.js --network localhost
 *   cd web && <env pointing at the local node> npm run build && npm start &
 *   cd web && DEPLOYMENTS=/tmp/deployments.json MINTER_PK=... DEPLOYER_PK=... node scripts/e2e-local.mjs
 *
 * Drives the real HTTP endpoints: puzzle -> solve -> sign -> submit, then
 * kills a token and checks the metadata, art, info counters and chat feed.
 */
import { ethers } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';

const B = process.env.BASE_URL || 'http://localhost:3000';
const RPC = process.env.RPC || 'http://127.0.0.1:8545';
const d = JSON.parse(fs.readFileSync(process.env.DEPLOYMENTS || '/tmp/deployments.json', 'utf8'));

// Transactions are broadcast by the server, not by us, so a long-lived
// provider's cached nonce goes stale. Make a fresh one whenever it matters.
const fresh = () => new ethers.JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
const provider = fresh();
const wallet = new ethers.Wallet(process.env.MINTER_PK, provider);
const pendingNonce = async (addr) => fresh().getTransactionCount(addr, 'pending');

const ABI_DIR = path.join(process.cwd(), 'lib', 'abi');
const A = (n) => JSON.parse(fs.readFileSync(path.join(ABI_DIR, `${n}.json`), 'utf8'));

let fails = 0;
const ok = (n, c, e = '') => {
  console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n}${e ? ' — ' + e : ''}`);
  if (!c) fails++;
};

function solve(q) {
  let m;
  if ((m = q.match(/^What is (\d+) \+ (\d+) \+ (\d+)\?$/))) return String(+m[1] + +m[2] + +m[3]);
  if ((m = q.match(/^What is (\d+) \+ (\d+)\?$/))) return String(+m[1] + +m[2]);
  if ((m = q.match(/^What is (\d+) - (\d+)\?$/))) return String(+m[1] - +m[2]);
  if ((m = q.match(/^What is (\d+) x (\d+)\?$/))) return String(+m[1] * +m[2]);
  if ((m = q.match(/^What is (\d+) \/ (\d+)\?$/))) return String(+m[1] / +m[2]);
  if ((m = q.match(/^What is (\d+) mod (\d+)\?$/))) return String(+m[1] % +m[2]);
  if ((m = q.match(/^What is (\d+) squared\?$/))) return String(+m[1] * +m[1]);
  if ((m = q.match(/^What is half of (\d+)\?$/))) return String(+m[1] / 2);
  if ((m = q.match(/^What is double (\d+)\?$/))) return String(+m[1] * 2);
  if ((m = q.match(/^What is (\d+) in hexadecimal/))) return (+m[1]).toString(16);
  if ((m = q.match(/^What is (\d+) in binary\?$/))) return (+m[1]).toString(2);
  throw new Error('unsolvable: ' + q);
}

async function post(p, body) {
  const r = await fetch(B + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

console.log('\ninfo');
{
  const r = await (await fetch(B + '/api/info')).json();
  ok('mintActive true', r.mintActive === true);
  ok('remainingEthSupply 9872', r.remainingEthSupply === 9872, String(r.remainingEthSupply));
  ok('tier 0 is free', r.currentPriceEth === '0.0' || r.currentPriceEth === '0', String(r.currentPriceEth));
  ok('contracts wired', r.contracts.mortals.toLowerCase() === d.mortals.toLowerCase());
}

console.log('\nmint flow (quantity 3)');
let tokenIds = [];
{
  const p = await post('/api/puzzle', { wallet: wallet.address, quantity: 3 });
  ok('puzzle 200', p.status === 200, JSON.stringify(p.json));
  ok('quantity echoed', p.json.quantity === 3);
  ok('totalCost is free in tier 1', p.json.totalCost && p.json.totalCost.wei === '0', JSON.stringify(p.json.totalCost));

  const wrong = await post('/api/solve', { wallet: wallet.address, puzzleId: p.json.puzzleId, answer: 'nope' });
  ok('wrong answer rejected', wrong.status === 400 && wrong.json.code === 'wrong_answer', JSON.stringify(wrong.json));

  const other = ethers.Wallet.createRandom();
  const hijack = await post('/api/solve', {
    wallet: other.address, puzzleId: p.json.puzzleId, answer: solve(p.json.question),
  });
  ok('another wallet cannot use the puzzle', hijack.status === 400 && hijack.json.code === 'wallet_mismatch');

  const s = await post('/api/solve', { wallet: wallet.address, puzzleId: p.json.puzzleId, answer: solve(p.json.question) });
  ok('solve 200', s.status === 200, JSON.stringify(s.json));
  ok('unsignedTx targets mortals', s.json.unsignedTx.to.toLowerCase() === d.mortals.toLowerCase());
  ok('value matches totalCostWei', BigInt(s.json.unsignedTx.value) === BigInt(s.json.totalCostWei));
  ok('nonce is 32 bytes', /^0x[0-9a-f]{64}$/.test(s.json.nonce));

  const fee = await provider.getFeeData();
  const gas = {
    gasLimit: 500000,
    maxFeePerGas: (fee.maxFeePerGas ?? fee.gasPrice) * 2n,
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 1000000n,
    type: 2,
  };
  const badTarget = await post('/api/submit', {
    signedTransaction: await wallet.signTransaction({
      to: ethers.ZeroAddress, value: 0, chainId: s.json.unsignedTx.chainId,
      nonce: (await pendingNonce(wallet.address)) + 9, ...gas, gasLimit: 21000,
    }),
  });
  ok('submit rejects a wrong target', badTarget.status === 400 && badTarget.json.code === 'invalid_target');

  const sub = await post('/api/submit', {
    signedTransaction: await wallet.signTransaction({
      ...s.json.unsignedTx, ...gas, nonce: await pendingNonce(wallet.address),
    }),
  });
  ok('submit 200', sub.status === 200, JSON.stringify(sub.json));
  ok('3 token ids returned', Array.isArray(sub.json.tokenIds) && sub.json.tokenIds.length === 3, JSON.stringify(sub.json.tokenIds));
  ok('wallet echoed', (sub.json.wallet || '').toLowerCase() === wallet.address.toLowerCase());
  tokenIds = sub.json.tokenIds || [];
  console.log('       ' + (sub.json.message || ''));
}

console.log('\nvoucher is single-use');
{
  const p = await post('/api/puzzle', { wallet: wallet.address, quantity: 1 });
  const s = await post('/api/solve', { wallet: wallet.address, puzzleId: p.json.puzzleId, answer: solve(p.json.question) });
  const fee = await provider.getFeeData();
  const base = {
    ...s.json.unsignedTx,
    gasLimit: 400000,
    maxFeePerGas: (fee.maxFeePerGas ?? fee.gasPrice) * 2n,
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 1000000n,
    type: 2,
  };
  const a = await post('/api/submit', {
    signedTransaction: await wallet.signTransaction({ ...base, nonce: await pendingNonce(wallet.address) }),
  });
  ok('first use mints', a.status === 200 && a.json.tokenIds.length === 1, JSON.stringify(a.json));
  const b = await post('/api/submit', {
    signedTransaction: await wallet.signTransaction({ ...base, nonce: await pendingNonce(wallet.address) }),
  });
  ok('replay of the same voucher is rejected', b.status !== 200 && ['mint_reverted', 'broadcast_failed'].includes(b.json.code), JSON.stringify(b.json));
}

console.log('\nmetadata + image');
{
  const id = tokenIds[0];
  const res = await fetch(`${B}/api/metadata/${id}`);
  const m = await res.json();
  ok('name', m.name === `MORTAL #${id}`);
  ok('status ALIVE', m.attributes.some((a) => a.trait_type === 'Status' && a.value === 'ALIVE'));
  ok('6 traits while alive', m.attributes.length === 6);
  ok('no-store', res.headers.get('cache-control') === 'no-store');
  const img = await fetch(`${B}/api/image/${id}`);
  const svg = await img.text();
  ok('image is svg', img.headers.get('content-type').startsWith('image/svg+xml') && svg.startsWith('<svg'));
  ok('unminted id 404s', (await fetch(`${B}/api/metadata/999999`)).status === 404);
}

console.log('\ndeath flips metadata and art');
{
  const p = fresh();
  const w = new ethers.Wallet(process.env.MINTER_PK, p);
  const mortals = new ethers.Contract(d.mortals, A('Mortals'), w);
  const staking = new ethers.Contract(d.staking, A('Staking'), w);
  const game = new ethers.Contract(d.game, A('Game'), w);

  const victim = tokenIds[0];
  const keep = tokenIds[1];
  await (await mortals.setApprovalForAll(d.staking, true)).wait();
  await (await staking.stake([keep])).wait();
  await p.send('evm_increaseTime', [86400 * 10]);
  await p.send('evm_mine', []);
  await (await staking.claim()).wait();
  await (await game.kill(victim)).wait();

  const m = await (await fetch(`${B}/api/metadata/${victim}`)).json();
  ok('dead description', m.description === "You've been killed.", m.description);
  ok('single DEAD trait', m.attributes.length === 1 && m.attributes[0].value === 'DEAD');
  const svg = await (await fetch(`${B}/api/image/${victim}`)).text();
  ok('dead art', svg.includes('BEEN KILLED'));

  const alive = await (await fetch(`${B}/api/metadata/${keep}`)).json();
  ok('staked sibling still alive', alive.attributes.some((a) => a.value === 'ALIVE'));

  const info = await (await fetch(`${B}/api/info`)).json();
  ok('info deadCount 1', info.deadCount === 1, String(info.deadCount));
  ok('info deadSlots 1', info.deadSlots === 1, String(info.deadSlots));
  ok('nextSoulMintCost exposed', info.nextSoulMintCost !== null, String(info.nextSoulMintCost));
}

console.log('\nchat');
{
  const chat = new ethers.Contract(d.chat, A('Chat'), new ethers.Wallet(process.env.MINTER_PK, fresh()));
  await (await chat.setUsername('gravedigger')).wait();
  await (await chat.post('first')).wait();

  const opWallet = new ethers.Wallet(process.env.DEPLOYER_PK, fresh());
  const opChat = new ethers.Contract(d.chat, A('Chat'), opWallet);
  await (await opChat.post('the pot is open.')).wait();

  await new Promise((r) => setTimeout(r, 11000)); // outlast the 10s log cache
  const r = await (await fetch(`${B}/api/chat/messages`)).json();
  ok('messages read from logs', r.messages.length === 2, JSON.stringify(r.messages.map((m) => m.text)));
  ok('newest first', r.messages[0].text === 'the pot is open.');
  ok('operator flagged', r.messages[0].isOperator === true);
  ok('username joined', r.messages[1].name === 'gravedigger', String(r.messages[1].name));
  ok('holder not flagged operator', r.messages[1].isOperator === false);

  const before = r.messages[0].timestamp;
  const older = await (await fetch(`${B}/api/chat/messages?before=${before}`)).json();
  ok('before cursor filters', older.messages.every((m) => m.timestamp < before));

  const page = await (await fetch(`${B}/chat`)).text();
  ok('chat page server-renders the transmission', page.includes('the pot is open.'));
  ok('chat page server-renders the holder name', page.includes('gravedigger'));
}

console.log('\nhome page');
{
  const html = await (await fetch(`${B}/`)).text();
  ok('title present', html.includes('MOR'));
  ok('8 sample sigils embedded', (html.match(/<svg/g) || []).length >= 8);
  ok('curl box present', html.includes('/skill.md'));
  ok('price ladder present', html.includes('0.00064'));
  ok('no wallet-connect libs', !/walletconnect|rainbowkit|wagmi/i.test(html));
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURES'}\n`);
process.exit(fails === 0 ? 0 : 1);
