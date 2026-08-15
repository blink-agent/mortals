import { ethers } from 'ethers';
import { provider, mortalsInterface } from '@/lib/chain';
import { ADDR, EXPLORER, SITE_URL } from '@/lib/env';
import { json, fail, preflight, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const RECEIPT_TIMEOUT_MS = 60_000;
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const ZERO_TOPIC = '0x' + '0'.repeat(64);

export function OPTIONS() {
  return preflight();
}

function classify(err) {
  const msg = `${err?.shortMessage || ''} ${err?.message || ''} ${err?.info?.error?.message || ''}`.toLowerCase();
  if (msg.includes('nonce too low') || msg.includes('nonce is too low')) {
    return { code: 'nonce_too_low', status: 400, message: 'Wallet nonce is too low — a previous tx is still pending or already mined. Re-read the nonce and re-sign.' };
  }
  if (msg.includes('already known') || msg.includes('known transaction') || msg.includes('already exists')) {
    return { code: 'already_known', status: 409, message: 'This transaction was already submitted. Wait for it to confirm.' };
  }
  if (msg.includes('insufficient funds') || msg.includes('insufficient balance')) {
    return { code: 'insufficient_eth', status: 400, message: 'Wallet does not have enough ETH for value + gas.' };
  }
  if (msg.includes('underpriced') || msg.includes('fee too low') || msg.includes('max fee per gas')) {
    return { code: 'fee_too_low', status: 400, message: 'Gas price too low for this chain. Raise maxFeePerGas and re-sign.' };
  }
  if (msg.includes('execution reverted') || msg.includes('revert')) {
    return { code: 'mint_reverted', status: 400, message: 'The mint reverted on-chain. Request a fresh puzzle — the voucher may be used or the price may have moved.' };
  }
  return { code: 'broadcast_failed', status: 500, message: 'Failed to broadcast the transaction. Retry in a moment.' };
}

export async function POST(req) {
  const body = await readJson(req);
  const raw = body.signedTransaction;

  if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]+$/.test(raw)) {
    return fail('invalid_transaction', 'Provide the hex-encoded fully-signed transaction as "signedTransaction".', 400);
  }

  let tx;
  try {
    tx = ethers.Transaction.from(raw);
  } catch {
    return fail('invalid_transaction', 'Could not parse the signed transaction.', 400);
  }

  if (!tx.to || !ADDR.mortals || tx.to.toLowerCase() !== ADDR.mortals.toLowerCase()) {
    return fail('invalid_target', `Transaction must target the MORTALS contract (${ADDR.mortals}).`, 400);
  }
  if (!tx.from) {
    return fail('invalid_transaction', 'Transaction is not signed.', 400);
  }

  let sent;
  try {
    sent = await provider().broadcastTransaction(raw);
  } catch (err) {
    const c = classify(err);
    return fail(c.code, c.message, c.status, { hash: tx.hash || null });
  }

  let receipt;
  try {
    receipt = await sent.wait(1, RECEIPT_TIMEOUT_MS);
  } catch (err) {
    return json(
      {
        success: false,
        code: 'receipt_timeout',
        error: 'Broadcast succeeded but the receipt did not arrive within 60s.',
        hash: sent.hash,
        wallet: tx.from,
        agentHint: `The transaction is in the mempool. Check ${EXPLORER}/tx/${sent.hash} before resubmitting — do NOT re-sign, that would double mint.`,
      },
      202,
    );
  }

  if (!receipt) {
    return json(
      {
        success: false,
        code: 'receipt_timeout',
        error: 'No receipt yet.',
        hash: sent.hash,
        wallet: tx.from,
        agentHint: `Check ${EXPLORER}/tx/${sent.hash}.`,
      },
      202,
    );
  }

  if (receipt.status === 0) {
    return fail('mint_reverted', 'The mint reverted on-chain.', 400, {
      hash: receipt.hash,
      wallet: tx.from,
      agentHint: `See ${EXPLORER}/tx/${receipt.hash}. Request a fresh puzzle and retry; do not reuse the voucher.`,
    });
  }

  const tokenIds = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ADDR.mortals.toLowerCase()) continue;
    if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 4) continue;
    if (log.topics[1] !== ZERO_TOPIC) continue; // mints only
    try {
      const parsed = mortalsInterface.parseLog(log);
      tokenIds.push(parsed.args.tokenId.toString());
    } catch {
      tokenIds.push(BigInt(log.topics[3]).toString());
    }
  }
  tokenIds.sort((a, b) => Number(a) - Number(b));

  const quantity = tokenIds.length;
  const list = tokenIds.map((id) => `#${id}`).join(', ');

  return json({
    success: true,
    tokenIds,
    tokenId: tokenIds[0] ?? null,
    quantity,
    hash: receipt.hash,
    wallet: tx.from,
    message:
      quantity === 1
        ? `Minted MORTAL ${list}. It is alive. Keep it that way.`
        : `Minted ${quantity} MORTALS: ${list}. They are alive. Keep them that way.`,
    agentHint:
      `Show the user the message field. Art and metadata: ${SITE_URL}/api/metadata/${tokenIds[0] ?? 1}. ` +
      `Explorer: ${EXPLORER}/tx/${receipt.hash}. ` +
      `To mint more, POST /api/puzzle again — there is no per-wallet limit. ` +
      `A MORTAL can be killed by anyone for 500 SOUL: read ${SITE_URL}/actions.md to stake, protect, shield, and play.`,
  });
}
