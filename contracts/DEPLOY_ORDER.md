# MORTALS — deploy + wire order

Chain: Robinhood Chain (Arbitrum-style L2), chainId **4663**, RPC `https://rpc.mainnet.chain.robinhood.com`,
explorer `https://robinhoodchain.blockscout.com`. Gas ~0.028 gwei.

Everything below is done for you by `scripts/deploy.js`. This file documents *why* the order is what it is,
so the wiring can be reproduced or audited by hand.

## Why this order

There is one circular reference: **Game** needs Staking's address in its constructor, and **Staking** needs
Game's address to accept `applyBlock`. Staking therefore gets Game through a one-time setter, and everything
else is constructor-injected.

Every wiring setter (`Soul.setMinter`, `Soul.setGame`, `Staking.setGame`, `Mortals.setGame`) is **one-time**:
once set it can never be changed. That is deliberate — the owner must not be able to swap in a new Game and
start flipping tokens dead or minting SOUL. Get them right the first time.

## Order

| # | Contract | Constructor args |
|---|----------|------------------|
| 1 | `Soul`    | — |
| 2 | `Mortals` | `(signer, payout, baseURI, contractURI)` |
| 3 | `Staking` | `(mortals, soul)` |
| 4 | `Game`    | `(mortals, soul, staking, payout)` |
| 5 | `Chat`    | `(mortals, staking, operator)` |

Then, in this exact sequence:

1. `soul.setMinter(staking)` — Staking becomes the only address that can mint SOUL.
2. `soul.setGame(game)` — Game becomes the only address that can `gameBurn` / `gameTake`.
3. `staking.setGame(game)` — Game becomes the only address that can `applyBlock`.
4. `mortals.setGame(game)` — Game becomes the only address that can `setDead` / `gameMint`.
   **Until this is set, `mint()` reverts with `GameNotSet()`** (the 10% pot split has nowhere to go).
5. `mortals.setDefaultRoyalty(game, 500)` — 5% royalties, receiver = Game (plain ETH into Game splits 50/50).
6. `mortals.setMintActive(true)` — opens the mint.

Optional, later:

- `mortals.setTransferValidator(<LimitBreak validator>)` — only once a validator exists on this chain.
  Leave it at `address(0)` until then; the hook is a no-op while unset.
- `chat.setOperator(...)`, `mortals.setSigner(...)`, `mortals.setPayout(...)`, `mortals.setBaseURI(...)`.

## Command

```bash
cd contracts
npm install

export DEPLOYER_PK=0x...                 # deployer/owner key, never committed
export SIGNER_ADDRESS=0x...              # voucher signer — a FRESH keypair, NOT the deployer
export PAYOUT=0xF0317a4A8a291B1C28A9aaB0C2d238C07203a89D   # optional, defaults to deployer
export OPERATOR=0xF0317a4A8a291B1C28A9aaB0C2d238C07203a89D # optional, defaults to deployer
export BASE_URI=https://<vercel-domain>/api/metadata/
export CONTRACT_URI=https://<vercel-domain>/api/contract

npx hardhat run scripts/deploy.js --network robinhood
```

The script prints every address as JSON and writes `contracts/deployments.json`
(addresses + the exact constructor args used, for verification).

## Verification (Blockscout)

```bash
npx hardhat run scripts/verify.js --network robinhood
```

`scripts/verify.js` prints the manual equivalents too, e.g.

```bash
npx hardhat verify --network robinhood <SOUL>
npx hardhat verify --network robinhood <MORTALS> "<SIGNER>" "<PAYOUT>" "<BASE_URI>" "<CONTRACT_URI>"
npx hardhat verify --network robinhood <STAKING> "<MORTALS>" "<SOUL>"
npx hardhat verify --network robinhood <GAME> "<MORTALS>" "<SOUL>" "<STAKING>" "<PAYOUT>"
npx hardhat verify --network robinhood <CHAT> "<MORTALS>" "<STAKING>" "<OPERATOR>"
```

Compiler settings to declare if verifying by hand: **solc 0.8.24**, optimizer **on**, **200 runs**,
no viaIR, EVM target `paris`, license MIT.

## Post-deploy sanity checklist

```
soul.minter()           == Staking
soul.game()             == Game
staking.game()          == Game
mortals.game()          == Game
mortals.mintActive()    == true
mortals.royaltyInfo(1, 10000) == (Game, 500)
mortals.nextTokenId()   == 1
game.deadSlots()        == 0
game.nextSoulMintCost() == 100e18
chat.operator()         == operator
```

## Ownership notes

- `Mortals`, `Soul`, `Staking`, `Chat` are `Ownable` (owner = deployer).
- **`Game` has no owner at all.** No rescue, no withdraw, no upgrade. The pot only leaves through
  `stealPot()` (and the 50% royalty forward inside `receive()`).
