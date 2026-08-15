import { ethers } from 'ethers';
import { contracts } from '@/lib/chain';
import { MAX_PER_TX, SITE_URL } from '@/lib/env';
import { json, fail, preflight, readJson } from '@/lib/http';
import { makePuzzle, issuePuzzleId } from '@/lib/puzzle';
import { eth } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function OPTIONS() {
  return preflight();
}

export async function POST(req) {
  const body = await readJson(req);
  const wallet = body.wallet;

  if (typeof wallet !== 'string' || !ethers.isAddress(wallet)) {
    return fail('invalid_wallet', 'Provide a valid EVM address as "wallet".', 400);
  }

  let quantity = body.quantity === undefined || body.quantity === null ? 1 : Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PER_TX) {
    return fail('invalid_quantity', `"quantity" must be an integer between 1 and ${MAX_PER_TX}.`, 400);
  }

  const c = contracts();

  let mintActive;
  let remaining;
  let totalCostWei;
  try {
    [mintActive, remaining] = await Promise.all([c.mortals.mintActive(), c.mortals.remainingEthSupply()]);
  } catch {
    return fail('server_error', 'Could not reach the chain. Retry in a moment.', 500);
  }

  if (!mintActive) {
    return fail('mint_not_active', 'Minting is not active.', 403);
  }
  if (remaining === 0n) {
    return fail('sold_out', 'All 9872 ETH-mintable MORTALS are gone.', 410);
  }
  if (BigInt(quantity) > remaining) {
    return fail(
      'quantity_too_high',
      `Only ${remaining.toString()} left. Request that many or fewer.`,
      400,
      { remaining: Number(remaining) },
    );
  }

  try {
    totalCostWei = await c.mortals.priceForQuantity(quantity);
  } catch {
    return fail('server_error', 'Could not price the mint. Retry in a moment.', 500);
  }

  const { question, answer } = makePuzzle();
  const { puzzleId, expiresAt } = issuePuzzleId({ wallet, quantity, answer });

  return json({
    puzzleId,
    question,
    quantity,
    // The ladder makes a per-token price meaningless for batches that cross a
    // tier boundary. Only the total is authoritative.
    pricePerToken: null,
    totalCost: {
      wei: totalCostWei.toString(),
      eth: eth(totalCostWei),
    },
    expiresAt,
    agentHint:
      `Solve the arithmetic in "question", then POST {wallet, puzzleId, answer} to ${SITE_URL}/api/solve ` +
      `within 5 minutes. Answer as a bare number (or bare hex/binary digits, no 0x). ` +
      `You will get back an unsigned transaction to sign locally with your own key. ` +
      `The wallet needs ${eth(totalCostWei)} ETH plus gas (~0.00002 ETH).`,
  });
}
