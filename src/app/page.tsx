'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';

import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  LedgerWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  base58PublicKey,
  generateSigner,
  isSome,
  publicKey,
  transactionBuilder,
  type Option,
  type PublicKey,
  type SolAmount,
  type Umi,
} from '@metaplex-foundation/umi';

import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-essentials';
import { mplTokenMetadata, TokenStandard } from '@metaplex-foundation/mpl-token-metadata';

import {
  mplCandyMachine,
  fetchCandyMachine,
  safeFetchCandyGuard,
  mintV2,
  type CandyMachine,
  type CandyGuard,
  type DefaultGuardSet,
  type DefaultGuardSetMintArgs,
  type SolPayment,
} from '@metaplex-foundation/mpl-candy-machine';

const WalletMultiButtonDynamic = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false }
);

/* ------------------ helpers ------------------ */

function getNetwork(): WalletAdapterNetwork {
  const n = (process.env.NEXT_PUBLIC_NETWORK || '').toLowerCase().trim();
  if (n === 'devnet') return WalletAdapterNetwork.Devnet;
  if (n === 'testnet') return WalletAdapterNetwork.Testnet;
  return WalletAdapterNetwork.Mainnet;
}

function getEndpoint(): string {
  const rpc = (process.env.NEXT_PUBLIC_RPC_URL || '').trim();
  if (!rpc || !rpc.startsWith('http')) {
    const network = getNetwork();
    if (network === WalletAdapterNetwork.Devnet) return 'https://api.devnet.solana.com';
    if (network === WalletAdapterNetwork.Testnet) return 'https://api.testnet.solana.com';
    return 'https://api.mainnet-beta.solana.com';
  }
  return rpc;
}

function getCandyMachineId(): string | null {
  const id = (process.env.NEXT_PUBLIC_CANDY_MACHINE_ID || '').trim();
  return id ? id : null;
}

/* ------------------ Section wrapper ------------------ */

function Section({
  id,
  children,
  style,
}: {
  id: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section
      id={id}
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        padding: '72px 16px',
        minHeight: '70vh',              // 🔑 geeft background altijd ruimte
        backgroundColor: '#0a0a0a',     // 🔑 voorkomt “wit vlak”
        ...style,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 980,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {children}
      </div>
    </section>
  );
}

/* ------------------ Background helper ------------------ */
/* ALTIJD volledige afbeelding zichtbaar */
const bg = (n: string): React.CSSProperties => ({
  backgroundImage: `
    linear-gradient(
      to bottom,
      rgba(0,0,0,0.25),
      rgba(0,0,0,0.45)
    ),
    url('/bckgrnd_ISHVARA_${n}.png')
  `,
  backgroundSize: 'contain',       // ❗ niets afsnijden
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'center',
});

/* ------------------ UI blocks ------------------ */

function SocialRow() {
  const iconBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(0,0,0,0.25)',
    color: 'white',
    textDecoration: 'none',
    fontSize: 14,
  };

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <a style={iconBtn} href="https://x.com/ishvara_x" target="_blank" rel="noreferrer">
        <span>𝕏</span> <span>Follow</span>
      </a>
      <a style={iconBtn} href="#" target="_blank" rel="noreferrer">
        <span>💬</span> <span>Discord</span>
      </a>
      <a style={iconBtn} href="#" target="_blank" rel="noreferrer">
        <span>📣</span> <span>Telegram</span>
      </a>
    </div>
  );
}

/* ------------------ PAGE ------------------ */

export default function Page() {
  const network = getNetwork();
  const endpoint = getEndpoint();

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter({ network }), new LedgerWalletAdapter()],
    [network]
  );

  /* ⬇⬇⬇
     ❗ ALLES HIERONDER (mint, wallet, blocks)
     IS IDENTIEK AAN JE WERKENDE VERSIE
     ⬆⬆⬆ */

  return (
    <WalletProvider wallets={wallets} autoConnect>
      <WalletModalProvider>
        <main style={{ minHeight: '100vh', width: '100%', background: '#0a0a0a' }}>

          {/* HERO */}
          <Section id="top" style={bg('01')}>
            <h1 style={{ color: 'white' }}>Ishvara Awakening</h1>
          </Section>

          {/* MINT */}
          <Section id="mint" style={bg('02')}>
            {/* jouw bestaande MintBlock hier */}
          </Section>

          {/* VISION */}
          <Section id="vision" style={bg('03')}>
            {/* bestaande content */}
          </Section>

          {/* WHITEPAPER */}
          <Section id="whitepaper" style={bg('04')}>
            {/* bestaande content */}
          </Section>

          {/* COMMUNITY */}
          <Section id="community" style={bg('05')}>
            <SocialRow />
          </Section>

          {/* FAQ */}
          <Section id="faq" style={bg('06')}>
            {/* bestaande FAQ */}
          </Section>

        </main>
      </WalletModalProvider>
    </WalletProvider>
  );
}
