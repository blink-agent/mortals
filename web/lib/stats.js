import { contracts, softAll } from './chain';
import { ADDR, MAX_ETH_SUPPLY, TIER_SIZE, TIER_COUNT } from './env';
import { eth, soul, num } from './format';

/**
 * One round-trip of every public counter. Each read fails soft to null so a
 * dead RPC (or placeholder addresses at build time) degrades to "—" rather
 * than a 500.
 */
export async function collectStats() {
  const c = contracts();

  const raw = await softAll({
    totalMinted: c.mortals.totalMinted(),
    ethMinted: c.mortals.ethMinted(),
    gameMinted: c.mortals.gameMinted(),
    remainingEthSupply: c.mortals.remainingEthSupply(),
    currentTier: c.mortals.currentTier(),
    priceOne: c.mortals.priceForQuantity(1),
    mintActive: c.mortals.mintActive(),
    killedCount: c.game.killedCount(),
    revivedCount: c.game.revivedCount(),
    deadSlots: c.game.deadSlots(),
    nextSoulMintCost: c.game.nextSoulMintCost(),
    potEth: c.game.potEth(),
    potSoul: c.game.potSoul(),
  });

  const ethMinted = num(raw.ethMinted);
  const tier = num(raw.currentTier);

  // The contract has no notion of "when does the price change" — it's just
  // the next tier boundary in ETH-mint index space.
  let nextPriceChangeAt = null;
  if (ethMinted !== null && tier !== null && tier < TIER_COUNT - 1) {
    const boundary = (tier + 1) * TIER_SIZE;
    nextPriceChangeAt = {
      atEthMint: boundary,
      mintsAway: Math.max(0, boundary - ethMinted),
    };
  }

  const dead =
    raw.killedCount !== null && raw.revivedCount !== null
      ? num(raw.killedCount) - num(raw.revivedCount)
      : null;

  return {
    totalMinted: num(raw.totalMinted),
    maxEthSupply: MAX_ETH_SUPPLY,
    ethMinted,
    gameMinted: num(raw.gameMinted),
    remainingEthSupply: num(raw.remainingEthSupply),
    currentTier: tier,
    currentPriceEth: eth(raw.priceOne),
    currentPriceWei: raw.priceOne === null ? null : raw.priceOne.toString(),
    nextPriceChangeAt,
    deadCount: dead,
    deadSlots: num(raw.deadSlots),
    nextSoulMintCost: soul(raw.nextSoulMintCost),
    potEth: eth(raw.potEth),
    potSoul: soul(raw.potSoul),
    mintActive: raw.mintActive === null ? null : Boolean(raw.mintActive),
    contracts: {
      mortals: ADDR.mortals,
      soul: ADDR.soul,
      staking: ADDR.staking,
      game: ADDR.game,
      chat: ADDR.chat,
    },
  };
}
