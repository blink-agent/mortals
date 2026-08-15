#!/usr/bin/env node
// Offline test of the mint flow's trust boundary: the puzzle token and the
// mint voucher. No chain, no server — fake env, pure crypto assertions.
//
//   npm run test:flow

import { createRequire } from 'node:module';
import { ethers } from 'ethers';

process.env.PUZZLE_SECRET = 'test-secret-do-not-use-in-production';

const require = createRequire(import.meta.url);
const mortalsAbi = require('../lib/abi/Mortals.json');

const { issuePuzzleId, verifyPuzzleId, makePuzzle, normalizeAnswer } = await import('../lib/puzzle.js');
const { signVoucher, recoverVoucherSigner, mintDigest } = await import('../lib/voucher.js');

let passed = 0;
let failed = 0;

function ok(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function group(name) {
  console.log(`\n${name}`);
}

const WALLET = '0xF0317a4A8a291B1C28A9aaB0C2d238C07203a89D';
const OTHER = '0x000000000000000000000000000000000000dEaD';
const MORTALS = '0x1111111111111111111111111111111111111111';
const CHAIN_ID = 4663;

// ---------------------------------------------------------------- puzzles
group('puzzle generation');
{
  const seen = new Set();
  let bad = 0;
  for (let i = 0; i < 400; i++) {
    const { question, answer } = makePuzzle();
    seen.add(question.replace(/\d+/g, 'N'));
    if (typeof question !== 'string' || !question.length) bad++;
    if (typeof answer !== 'string' || !answer.length) bad++;
    if (/-/.test(answer)) bad++; // no negative answers
  }
  ok('400 puzzles all produce a question and a non-negative answer', bad === 0);
  ok('generator pool is varied (>= 8 distinct shapes)', seen.size >= 8, `saw ${seen.size}`);
}

// arithmetic spot-checks: re-derive the answer from the question text
group('puzzle arithmetic is correct');
{
  let checked = 0;
  let wrong = 0;
  for (let i = 0; i < 2000; i++) {
    const { question, answer } = makePuzzle();
    let expected = null;
    let m;
    if ((m = question.match(/^What is (\d+) \+ (\d+) \+ (\d+)\?$/)))
      expected = String(+m[1] + +m[2] + +m[3]);
    else if ((m = question.match(/^What is (\d+) \+ (\d+)\?$/))) expected = String(+m[1] + +m[2]);
    else if ((m = question.match(/^What is (\d+) - (\d+)\?$/))) expected = String(+m[1] - +m[2]);
    else if ((m = question.match(/^What is (\d+) x (\d+)\?$/))) expected = String(+m[1] * +m[2]);
    else if ((m = question.match(/^What is (\d+) \/ (\d+)\?$/))) expected = String(+m[1] / +m[2]);
    else if ((m = question.match(/^What is (\d+) mod (\d+)\?$/))) expected = String(+m[1] % +m[2]);
    else if ((m = question.match(/^What is (\d+) squared\?$/))) expected = String(+m[1] * +m[1]);
    else if ((m = question.match(/^What is half of (\d+)\?$/))) expected = String(+m[1] / 2);
    else if ((m = question.match(/^What is double (\d+)\?$/))) expected = String(+m[1] * 2);
    else if ((m = question.match(/^What is (\d+) in hexadecimal/))) expected = (+m[1]).toString(16);
    else if ((m = question.match(/^What is (\d+) in binary\?$/))) expected = (+m[1]).toString(2);

    if (expected !== null) {
      checked++;
      if (expected !== answer) {
        wrong++;
        if (wrong < 4) console.log(`       ${question} -> got ${answer}, want ${expected}`);
      }
    }
  }
  ok('every generated question re-derives to its answer', wrong === 0, `${wrong}/${checked} wrong`);
  ok('all 2000 questions matched a known shape', checked === 2000, `matched ${checked}`);
}

// hex / binary / multiplication bounds
group('puzzle bounds');
{
  let hexOutOfRange = 0;
  let binOutOfRange = 0;
  let mulTooBig = 0;
  for (let i = 0; i < 3000; i++) {
    const { question } = makePuzzle();
    let m;
    if ((m = question.match(/^What is (\d+) in hexadecimal/)) && (+m[1] < 0 || +m[1] > 255)) hexOutOfRange++;
    if ((m = question.match(/^What is (\d+) in binary\?$/)) && (+m[1] < 0 || +m[1] > 63)) binOutOfRange++;
    if ((m = question.match(/^What is (\d+) x (\d+)\?$/)) && (+m[1] > 12 || +m[2] > 99)) mulTooBig++;
  }
  ok('decimal->hex stays in 0..255', hexOutOfRange === 0);
  ok('decimal->binary stays in 0..63', binOutOfRange === 0);
  ok('multiplication stays within 12 x 99', mulTooBig === 0);
}

// ------------------------------------------------------------ puzzle token
group('puzzle token (HMAC round-trip)');
{
  const { puzzleId, expiresAt } = issuePuzzleId({ wallet: WALLET, quantity: 3, answer: '113' });

  ok('puzzleId has payload.signature shape', puzzleId.split('.').length === 2);
  ok('expiry is ~5 minutes out', expiresAt - Date.now() > 4 * 60_000 && expiresAt - Date.now() <= 5 * 60_000);
  ok('answer is not recoverable from the token', !Buffer.from(puzzleId.split('.')[0], 'base64url').toString('utf8').includes('"113"'));

  const good = verifyPuzzleId(puzzleId, { wallet: WALLET, answer: '113' });
  ok('correct answer verifies', good.ok === true);
  ok('quantity survives the round-trip', good.ok && good.payload.quantity === 3);

  ok('wallet is case-insensitive', verifyPuzzleId(puzzleId, { wallet: WALLET.toUpperCase().replace('0X', '0x'), answer: '113' }).ok === true);
  ok('whitespace around the answer is trimmed', verifyPuzzleId(puzzleId, { wallet: WALLET, answer: '  113  ' }).ok === true);

  const wrong = verifyPuzzleId(puzzleId, { wallet: WALLET, answer: '114' });
  ok('wrong answer is rejected', wrong.ok === false && wrong.code === 'wrong_answer');

  const off = verifyPuzzleId(puzzleId, { wallet: OTHER, answer: '113' });
  ok('another wallet cannot use the token', off.ok === false && off.code === 'wallet_mismatch');

  const expired = verifyPuzzleId(puzzleId, { wallet: WALLET, answer: '113', now: Date.now() + 6 * 60_000 });
  ok('expired token is rejected', expired.ok === false && expired.code === 'puzzle_expired');
}

group('puzzle token (forgery)');
{
  const { puzzleId } = issuePuzzleId({ wallet: WALLET, quantity: 1, answer: '42' });
  const [payloadB64, sig] = puzzleId.split('.');

  // re-sign a payload that says quantity 32 with a guessed secret
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  payload.quantity = 32;
  const forgedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const forged = `${forgedPayload}.${sig}`;
  const r1 = verifyPuzzleId(forged, { wallet: WALLET, answer: '42' });
  ok('tampered payload is rejected', r1.ok === false && r1.code === 'puzzle_not_found');

  const r2 = verifyPuzzleId(`${payloadB64}.${'A'.repeat(sig.length)}`, { wallet: WALLET, answer: '42' });
  ok('bad signature is rejected', r2.ok === false && r2.code === 'puzzle_not_found');

  const r3 = verifyPuzzleId('garbage', { wallet: WALLET, answer: '42' });
  ok('malformed token is rejected', r3.ok === false && r3.code === 'puzzle_not_found');

  // a token minted under a different secret must not verify under ours
  process.env.PUZZLE_SECRET = 'a-different-secret';
  const other = issuePuzzleId({ wallet: WALLET, quantity: 1, answer: '42' });
  process.env.PUZZLE_SECRET = 'test-secret-do-not-use-in-production';
  const r4 = verifyPuzzleId(other.puzzleId, { wallet: WALLET, answer: '42' });
  ok('token signed with another secret is rejected', r4.ok === false && r4.code === 'puzzle_not_found');
}

group('answer normalisation');
{
  const hex = issuePuzzleId({ wallet: WALLET, quantity: 1, answer: 'ff' });
  ok('uppercase hex answer accepted', verifyPuzzleId(hex.puzzleId, { wallet: WALLET, answer: 'FF' }).ok === true);
  ok('0x-prefixed hex answer accepted', verifyPuzzleId(hex.puzzleId, { wallet: WALLET, answer: '0xFF' }).ok === true);
  ok('thousands separators ignored', normalizeAnswer(' 1,234 ') === '1234');
}

// ---------------------------------------------------------------- voucher
group('mint voucher');
{
  const signerWallet = ethers.Wallet.createRandom();
  const quantity = 5;

  const v = await signVoucher({
    signerPk: signerWallet.privateKey,
    minter: WALLET,
    quantity,
    chainId: CHAIN_ID,
    mortalsAddr: MORTALS,
  });

  ok('nonce is 32 bytes', /^0x[0-9a-f]{64}$/.test(v.nonce));
  ok('signature is 65 bytes', /^0x[0-9a-f]{130}$/.test(v.signature));

  const recovered = recoverVoucherSigner({
    minter: WALLET,
    quantity,
    nonce: v.nonce,
    chainId: CHAIN_ID,
    mortalsAddr: MORTALS,
    signature: v.signature,
  });
  ok('signature recovers to the signer address', recovered.toLowerCase() === signerWallet.address.toLowerCase(), recovered);

  // the digest must match what the contract computes:
  // keccak256(abi.encode(minter, quantity, nonce, chainid, address(this)))
  const manual = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256', 'bytes32', 'uint256', 'address'],
      [WALLET, quantity, v.nonce, CHAIN_ID, MORTALS],
    ),
  );
  ok('digest matches abi.encode(minter, quantity, nonce, chainId, contract)', manual === v.digest);

  // EIP-191 wrapping — the contract applies toEthSignedMessageHash
  const prefixed = ethers.hashMessage(ethers.getBytes(v.digest));
  ok('recovery over the EIP-191 prefixed digest matches', ethers.recoverAddress(prefixed, v.signature).toLowerCase() === signerWallet.address.toLowerCase());

  // wrong-parameter vouchers must recover to somebody else
  const wrongQty = recoverVoucherSigner({
    minter: WALLET, quantity: quantity + 1, nonce: v.nonce, chainId: CHAIN_ID, mortalsAddr: MORTALS, signature: v.signature,
  });
  ok('voucher does not validate for a different quantity', wrongQty.toLowerCase() !== signerWallet.address.toLowerCase());

  const wrongMinter = recoverVoucherSigner({
    minter: OTHER, quantity, nonce: v.nonce, chainId: CHAIN_ID, mortalsAddr: MORTALS, signature: v.signature,
  });
  ok('voucher does not validate for a different minter', wrongMinter.toLowerCase() !== signerWallet.address.toLowerCase());

  const wrongChain = recoverVoucherSigner({
    minter: WALLET, quantity, nonce: v.nonce, chainId: 1, mortalsAddr: MORTALS, signature: v.signature,
  });
  ok('voucher does not validate on another chain', wrongChain.toLowerCase() !== signerWallet.address.toLowerCase());

  ok('two vouchers never share a nonce', (await signVoucher({ signerPk: signerWallet.privateKey, minter: WALLET, quantity, chainId: CHAIN_ID, mortalsAddr: MORTALS })).nonce !== v.nonce);

  // calldata round-trip against the real deployed ABI
  const iface = new ethers.Interface(mortalsAbi);
  const data = iface.encodeFunctionData('mint', [quantity, v.nonce, v.signature]);
  const decoded = iface.decodeFunctionData('mint', data);
  ok('mint() calldata encodes and decodes', Number(decoded[0]) === quantity && decoded[1] === v.nonce && decoded[2] === v.signature);
  ok('calldata carries the mint selector', data.startsWith(iface.getFunction('mint').selector));
}

// --------------------------------------------------------- full happy path
group('end-to-end (fake env)');
{
  const signerWallet = ethers.Wallet.createRandom();
  const { question, answer } = makePuzzle();
  const { puzzleId } = issuePuzzleId({ wallet: WALLET, quantity: 2, answer });

  const verified = verifyPuzzleId(puzzleId, { wallet: WALLET, answer });
  ok('puzzle -> solve verifies', verified.ok === true);

  const v = await signVoucher({
    signerPk: signerWallet.privateKey,
    minter: WALLET,
    quantity: verified.payload.quantity,
    chainId: CHAIN_ID,
    mortalsAddr: MORTALS,
  });
  const iface = new ethers.Interface(mortalsAbi);
  const data = iface.encodeFunctionData('mint', [verified.payload.quantity, v.nonce, v.signature]);
  const unsignedTx = { to: MORTALS, data, value: '0x' + (12345n).toString(16), chainId: CHAIN_ID };

  ok('unsignedTx is well formed', ethers.isAddress(unsignedTx.to) && unsignedTx.data.startsWith('0x') && unsignedTx.chainId === CHAIN_ID);
  ok(
    'voucher in the calldata recovers to the configured signer',
    recoverVoucherSigner({
      minter: WALLET, quantity: 2, nonce: v.nonce, chainId: CHAIN_ID, mortalsAddr: MORTALS,
      signature: iface.decodeFunctionData('mint', data)[2],
    }).toLowerCase() === signerWallet.address.toLowerCase(),
  );
  console.log(`       sample puzzle: "${question}" -> ${answer}`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
