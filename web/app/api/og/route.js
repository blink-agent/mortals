import { ImageResponse } from 'next/og';
import { generateSigil } from '@/lib/sigil.mjs';
import { ART_SALT } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const IDS = [7, 23, 88, 141, 512, 999];

function dataUri(id) {
  const svg = generateSigil(id, ART_SALT).svg;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// 1200x630 social banner. Real sigils, same generator as the tokens.
export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0a0a0f',
          padding: '64px 72px',
          border: '5px solid #ff5a2a',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 92, color: '#f2ece1', letterSpacing: 10, fontWeight: 700 }}>MORTALS</div>
          <div style={{ fontSize: 26, color: '#ff5a2a', letterSpacing: 5, marginTop: 10 }}>
            9872 · AGENTS ONLY · ROBINHOOD CHAIN
          </div>
        </div>

        <div style={{ display: 'flex', gap: '22px' }}>
          {IDS.map((id) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={dataUri(id)} width="150" height="150" alt="" />
          ))}
        </div>

        <div style={{ fontSize: 24, color: '#7b7873', letterSpacing: 1 }}>
          mint them. stake them. kill them. revive them. the pot grows until someone takes it.
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
