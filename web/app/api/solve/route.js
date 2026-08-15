import { ethers } from 'ethers';
import { contracts, mortalsInterface } from '@/lib/chain';
import { ADDR, CHAIN_ID, SIGNER_PK, SITE_URL } from '@/lib/env';
import { json, fail, preflight, readJson } from '@/lib/http';
import { verifyPuzzleId } from '@/lib/puzzle';
import { signVoucher } from '@/lib/voucher';
import { eth } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function OPTIONS() {
  return preflight();
}

export async function POST(req) {
  const body = await readJson(req);
  const { wallet, puzzleId, answer } = body;

  if (typeof wallet !== 'string' || !ethers.isAddress(wallet)) {
    return fail('invalid_wallet', 'Provide a valid EVM address as "wallet".', 400);
  }
  if (typeof puzzleId !== 'string' || !puzzleId) {
    return fail('puzzle_not_found', 'Missing "puzzleId".', 404);
  }
  if (answer === undefined || answer === null || String(answer).trim() === '') {
    return fail('wrong_answer', 'Missing "answer".', 400);
  }

  const check = verifyPuzzleId(puzzleId, { wallet, answer });
  if (!check.ok) {
    return fail(check.code, check.message, check.status);
  }

  const quantity = Number(check.payload.quantity);
  const minter = ethers.getAddress(wallet);
  const c = contracts();

  // Re-read everything live. The puzzle is 5 minutes old at most, but the
  // ladder can have moved and the supply can have run out in that window.
  let mintActive;
  let remaining;
  let totalCostWei;
  try {
    [mintActive, remaining, totalCostWei] = await Promise.all([
      c.mortals.mintActive(),
      c.mortals.remainingEthSupply(),
      c.mortals.priceForQuantity(quantity),
    ]);
  } catch {
    return fail('server_error', 'Could not reach the chain. Retry in a moment.', 500);
  }

  if (!mintActive) return fail('mint_not_active', 'Minting is not active.', 403);
  if (remaining === 0n) return fail('sold_out', 'All 9872 ETH-mintable MORTALS are gone.', 410);
  if (BigInt(quantity) > remaining) {
    return fail('quantity_too_high', `Only ${remaining.toString()} left.`, 400, {
      remaining: Number(remaining),
    });
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(SIGNER_PK)) {
    return fail('server_error', 'Voucher signer is not configured.', 500);
  }

  let voucher;
  try {
    voucher = await signVoucher({
      signerPk: SIGNER_PK,
      minter,
      quantity,
      chainId: CHAIN_ID,
      mortalsAddr: ethers.getAddress(ADDR.mortals),
    });
  } catch {
    return fail('server_error', 'Could not sign the mint voucher.', 500);
  }

  const data = mortalsInterface.encodeFunctionData('mint', [quantity, voucher.nonce, voucher.signature]);

  return json({
    unsignedTx: {
      to: ethers.getAddress(ADDR.mortals),
      data,
      value: '0x' + totalCostWei.toString(16),
      chainId: CHAIN_ID,
    },
    quantity,
    totalCostEth: eth(totalCostWei),
    totalCostWei: totalCostWei.toString(),
    nonce: voucher.nonce,
    agentHint:
      'Sign this transaction locally with the wallet you asked the puzzle for. NEVER send the private key to any server. ' +
      'Add gasLimit 220000 + 60000 per extra token, maxFeePerGas ~0.15 gwei, maxPriorityFeePerGas ~0.01 gwei, type 2, ' +
      'and the wallet nonce from the RPC. Then POST {signedTransaction} to ' +
      `${SITE_URL}/api/submit. The voucher is single-use and only valid for this wallet and quantity.`,
  });
}
