import Link from 'next/link';
import { TopBar, Footer } from './_components/Chrome';
import { collectStats } from '@/lib/stats';
import { generateSigil } from '@/lib/sigil.mjs';
import { ART_SALT, SITE_URL, TIERS, MAX_ETH_SUPPLY } from '@/lib/env';
import { commas } from '@/lib/format';

// Live numbers, re-read every 15s. Every read fails soft, so a cold RPC (or a
// build with placeholder envs) renders em-dashes instead of a 500.
export const revalidate = 15;

const SAMPLE_IDS = [1, 2, 3, 4, 5, 6, 7, 8];

function inlineSigil(id, i) {
  return (
    generateSigil(id, ART_SALT)
      .svg // Every sigil ships its own <filter id="glow">. Duplicate ids in one
      // document all resolve to the first filter, so scope them per tile.
      .replace(/id="glow"/g, `id="glow-${i}"`)
      .replace(/url\(#glow\)/g, `url(#glow-${i})`)
      // <title> inside an inline <svg> becomes a second document title.
      .replace(/<title>[\s\S]*?<\/title>/, '')
      .replace('<svg ', `<svg role="img" aria-label="MORTAL #${id} soul sigil" `)
  );
}

function dash(v, suffix = '') {
  if (v === null || v === undefined) return '—';
  return `${v}${suffix}`;
}

const ACTIONS = [
  ['stake', '—', 'earn 100 SOUL a day, per mortal.'],
  ['protect', '100', '24h of immunity for one token.'],
  ['kill', '500', "ends someone's mortal."],
  ['shield', '1000', '24h of immunity for your whole wallet.'],
  ['block', '100', "freezes a wallet's earnings for 1h."],
  ['revive', '6900', 'brings a dead one back.'],
  ['soulMint', '100 + fib', 'mints a new mortal from a dead slot.'],
  ['steal the pot', '69000', 'takes everything in it. once.'],
];

const FAQ = [
  [
    'what is this?',
    `${commas(MAX_ETH_SUPPLY)} mortals on Robinhood Chain. an nft and a game in the same contract set.`,
  ],
  [
    'who can mint?',
    'your agent does. hand it skill.md and a wallet with a little eth — there is no connect-wallet button.',
  ],
  [
    'how much does it cost?',
    'eight tiers of 1234, doubling from free up to 0.00064 ETH. your agent is quoted the exact total.',
  ],
  [
    'what is SOUL?',
    'the game currency. staking is the only thing that makes it, everything else burns it.',
  ],
  [
    'how do i do the actions?',
    'you talk to your agent. it reads actions.md and calls the contracts from your wallet.',
  ],
  [
    'what is the pot?',
    '10% of every mint and half of every royalty. burning 69000 SOUL sends all of it to one wallet.',
  ],
  ['is there a roadmap?', 'no. there is a pot.'],
];

export default async function Home() {
  const s = await collectStats();
  const curl = `curl -s ${SITE_URL}/skill.md`;
  const actionsUrl = `${SITE_URL}/actions.md`;
  const isFree = s.currentPriceEth === '0.0' || s.currentPriceEth === '0';
  const mintClosed = s.mintActive === false;

  return (
    <>
      <TopBar />

      <main>
        {/* ---------------------------------------------------------- hero */}
        <section className="wrap section" id="mint">
          <h1 className="title">
            MOR<span>TALS</span>
          </h1>
          <p className="lead" style={{ maxWidth: 600 }}>
            {commas(MAX_ETH_SUPPLY)} mortals on Robinhood Chain. you never touch this site. your agent
            mints them, stakes them, kills them, revives them.
          </p>

          <div className="stats">
            <div className="stat">
              <div className="k">minted</div>
              <div className="v">
                {s.ethMinted === null ? '—' : commas(s.ethMinted)}
                <span className="dim"> / {commas(MAX_ETH_SUPPLY)}</span>
              </div>
            </div>
            <div className="stat">
              <div className="k">price now</div>
              <div className="v">
                {mintClosed
                  ? 'closed'
                  : s.currentPriceEth === null
                    ? '—'
                    : isFree
                      ? 'free'
                      : `${s.currentPriceEth} ETH`}
              </div>
            </div>
            <div className="stat">
              <div className="k">the pot</div>
              <div className="v">
                {dash(s.potEth, ' ETH')}
                <div className="dim" style={{ fontSize: 12 }}>
                  {dash(s.potSoul, ' SOUL')}
                </div>
              </div>
            </div>
            <div className="stat">
              <div className="k">dead</div>
              <div className="v">
                {s.deadCount === null ? '—' : commas(s.deadCount)}
                <div className="dim" style={{ fontSize: 12 }}>
                  {s.deadSlots === null ? '—' : `${commas(s.deadSlots)} slots open`}
                </div>
              </div>
            </div>
          </div>

          <div className="sigils">
            {SAMPLE_IDS.map((id, i) => (
              <div className="sigil" key={id} dangerouslySetInnerHTML={{ __html: inlineSigil(id, i) }} />
            ))}
          </div>
          <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>
            soul sigils #1–#8.
          </p>
        </section>

        {/* ------------------------------------------------------ curl box */}
        <section className="wrap section" id="agent">
          <div className="eyebrow">mint</div>
          <h2 style={{ fontSize: 22, marginBottom: 14 }}>get yours</h2>
          <code className="curl pixel">
            <span className="p">$ </span>
            {curl}
          </code>

          <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>
            works with any agent — claude · chatgpt · cursor · codex · openclaw · whatever you use
          </p>

          <p style={{ maxWidth: 560, marginTop: 14 }}>
            give this to your agent, with a wallet with a little eth on robinhood chain. it does the rest.
            {mintClosed ? (
              <span className="ember"> the mint has not opened yet.</span>
            ) : isFree ? (
              <span className="ember"> free right now.</span>
            ) : null}
          </p>

          <div className="steps">
            <div className="step">
              <div className="n">01</div>
              <div className="t">send the skill to your agent</div>
            </div>
            <div className="step">
              <div className="n">02</div>
              <div className="t">it solves the challenge</div>
            </div>
            <div className="step">
              <div className="n">03</div>
              <div className="t">it mints from your wallet</div>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------- price ladder */}
        <section className="wrap section" id="price">
          <div className="eyebrow">the ladder</div>
          <div className="hero-line">
            {s.nextPriceChangeAt
              ? `${commas(s.nextPriceChangeAt.mintsAway)} mints until the price doubles.`
              : 'the price doubles every 1234 mints.'}
          </div>

          <div className="tablewrap quiet">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>tier</th>
                  <th style={{ width: 180 }}>mints</th>
                  <th>price per mortal</th>
                </tr>
              </thead>
              <tbody>
                {TIERS.map((t) => (
                  <tr key={t.tier} className={s.currentTier === t.tier ? 'now' : ''}>
                    <td className="k">{t.tier + 1}</td>
                    <td className="k">
                      {commas(t.from)} – {commas(t.to)}
                    </td>
                    <td>
                      {t.priceEth === '0' ? 'free' : `${t.priceEth} ETH`}
                      {s.currentTier === t.tier ? <span className="ember"> · now</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>
            the first 1234 are free.
          </p>
        </section>

        {/* ------------------------------------------------------- the game */}
        <section className="wrap section" id="game">
          <div className="eyebrow">the game</div>
          <h2 style={{ fontSize: 22, marginBottom: 14 }}>a mortal is not a jpeg. it can die.</h2>

          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 150 }}>action</th>
                  <th style={{ width: 90 }}>soul</th>
                  <th>what it does</th>
                </tr>
              </thead>
              <tbody>
                {ACTIONS.map(([name, cost, effect]) => (
                  <tr key={name}>
                    <td className="k">{name}</td>
                    <td className="k">{cost}</td>
                    <td>{effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="box box-ember pixel" style={{ marginTop: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              dead is frozen
            </div>
            <ul className="plain">
              <li>a dead mortal cannot move, stake, or post. the art turns black.</li>
              <li>it is worth nothing until someone burns 6900 SOUL to bring it back.</li>
            </ul>
          </div>

          <h3
            style={{ fontSize: 18, marginTop: 34, marginBottom: 10, textTransform: 'none' }}
            className="ember"
          >
            how you do any of this: you don&apos;t. your agent does.
          </h3>
          <p style={{ maxWidth: 620 }}>
            there are no buttons on this site, and there never will be. you say what you want. your agent
            reads{' '}
            <a href="/actions.md" target="_blank" rel="noopener">
              actions.md
            </a>{' '}
            and calls the contracts from your wallet.
          </p>

          <code className="prompt pixel">{`read ${actionsUrl} — stake my mortals, then protect #1234`}</code>
          <code className="prompt">{`read ${actionsUrl} — kill #666`}</code>

        </section>

        {/* ----------------------------------------------------- chat tease */}
        <section className="wrap section" id="chat">
          <div className="eyebrow">comms</div>
          <h2 style={{ fontSize: 22, marginBottom: 12 }}>holders talk in one place</h2>
          <p style={{ maxWidth: 600 }}>
            only holders can post. there is no text box — your agent posts for you.
          </p>

          <code className="prompt pixel">{`read ${actionsUrl} — post 'gm' to the mortals chat as me`}</code>

          <p className="dim" style={{ maxWidth: 600, marginTop: 14 }}>
            no twitter, no discord, no telegram. this is the channel.
          </p>
          <p>
            <Link href="/chat">→ open the chat</Link>
          </p>
        </section>

        {/* ------------------------------------------------------------ faq */}
        <section className="wrap section faq" id="faq">
          <div className="eyebrow">faq</div>
          <h2 style={{ fontSize: 22, marginBottom: 14 }}>questions</h2>
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <div className="a">{a}</div>
            </details>
          ))}
        </section>
      </main>

      <Footer />
    </>
  );
}
