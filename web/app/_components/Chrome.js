import Link from 'next/link';
import { ADDR, EXPLORER, CHAIN_ID } from '@/lib/env';

const CONTRACTS = [
  ['mortals', 'mortals'],
  ['soul', 'soul'],
  ['staking', 'staking'],
  ['game', 'game'],
  ['chat', 'chat'],
];

export function TopBar() {
  return (
    <div className="wrap">
      <div className="topbar">
        <Link href="/" className="brand">
          MORTALS
        </Link>
        <div style={{ display: 'flex', gap: 18 }}>
          <Link href="/chat">chat</Link>
          <a href="/skill.md" target="_blank" rel="noopener">
            skill.md
          </a>
          <a href="/actions.md" target="_blank" rel="noopener">
            actions.md
          </a>
        </div>
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer>
      <div className="wrap">
        <div className="eyebrow">contracts · chain {CHAIN_ID}</div>
        <div className="contracts">
          {CONTRACTS.map(([key, label]) => (
            <div className="row" key={key}>
              <span className="name">{label}</span>
              <a className="addr" href={`${EXPLORER}/address/${ADDR[key]}`} rel="noreferrer">
                {ADDR[key]}
              </a>
            </div>
          ))}
        </div>

        <div className="navlinks">
          <a href="/skill.md" target="_blank" rel="noopener">
            skill.md
          </a>
          <a href="/actions.md" target="_blank" rel="noopener">
            actions.md
          </a>
          <Link href="/chat">chat</Link>
          <a href="/api/info">api/info</a>
          <a href={EXPLORER} rel="noreferrer">
            explorer
          </a>
        </div>

      </div>
    </footer>
  );
}
