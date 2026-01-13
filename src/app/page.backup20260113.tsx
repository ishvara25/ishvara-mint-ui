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

/** Small helper: section wrapper */
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

/** Simple icon buttons */
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

/** Email signup (front-end only). Later you plug this into a service. */
function EmailCapture() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) {
      setMsg('Please enter a valid email.');
      return;
    }
    setMsg('Saved (demo). Later we connect this to a mailing service.');
    setEmail('');
  };

  return (
    <form
      onSubmit={submit}
      style={{
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email for updates"
        style={{
          flex: '1 1 240px',
          padding: '12px 14px',
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(0,0,0,0.25)',
          color: 'white',
          outline: 'none',
        }}
      />
      <button
        type="submit"
        style={{
          padding: '12px 16px',
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(255,255,255,0.12)',
          color: 'white',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        Notify me
      </button>
      {msg && (
        <div style={{ width: '100%', color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
          {msg}
        </div>
      )}
    </form>
  );
}

/** FAQ block (UI-only) */
function FAQ() {
  const card: React.CSSProperties = {
    borderRadius: 18,
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(0,0,0,0.35)',
    backdropFilter: 'blur(10px)',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  };

  const q: React.CSSProperties = { color: 'white', fontWeight: 900 };
  const a: React.CSSProperties = { color: 'rgba(255,255,255,0.85)', lineHeight: 1.6 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card}>
        <div style={q}>What is Collectable 1?</div>
        <div style={a}>The first Ishvara badge. A symbolic entry point into the ecosystem.</div>
      </div>
      <div style={card}>
        <div style={q}>Is this on mainnet?</div>
        <div style={a}>Yes, depending on your environment settings (Network + RPC) configured in Vercel.</div>
      </div>
      <div style={card}>
        <div style={q}>Do you store my wallet address?</div>
        <div style={a}>No. This page does not store wallet identities on a server.</div>
      </div>
      <div style={card}>
        <div style={q}>What happens after mint?</div>
        <div style={a}>You can view the minted NFT on Solscan via the link shown after a successful mint.</div>
      </div>
    </div>
  );
}

export default function Page() {
  const network = getNetwork();
  const endpoint = getEndpoint();

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter({ network }), new LedgerWalletAdapter()],
    [network]
  );

  const [umi] = useState<Umi>(() => createUmi(endpoint).use(mplTokenMetadata()).use(mplCandyMachine()));

  const [cm, setCm] = useState<CandyMachine | null>(null);
  const [guard, setGuard] = useState<CandyGuard<DefaultGuardSet> | null>(null);

  const [loading, setLoading] = useState(false);
  const [mintCreated, setMintCreated] = useState<PublicKey | null>(null);
  const [mintMsg, setMintMsg] = useState<string | null>(null);

  const [countTotal, setCountTotal] = useState<number | null>(null);
  const [countMinted, setCountMinted] = useState<number | null>(null);
  const [countRemaining, setCountRemaining] = useState<number | null>(null);

  const [costInSol, setCostInSol] = useState<number>(0);
  const [mintDisabled, setMintDisabled] = useState<boolean>(true);

  const retrieveAvailability = async () => {
    try {
      setMintMsg(null);

      const cmIdStr = getCandyMachineId();
      if (!cmIdStr) {
        setMintMsg('Missing NEXT_PUBLIC_CANDY_MACHINE_ID in Vercel env vars.');
        setMintDisabled(true);
        return;
      }

      let cmPk: ReturnType<typeof publicKey>;
      try {
        cmPk = publicKey(cmIdStr);
      } catch {
        setMintMsg('Invalid candy machine public key. Check NEXT_PUBLIC_CANDY_MACHINE_ID (no quotes/spaces).');
        setMintDisabled(true);
        return;
      }

      const candyMachine = await fetchCandyMachine(umi, cmPk);
      setCm(candyMachine);

      const total = candyMachine.itemsLoaded;
      const minted = Number(candyMachine.itemsRedeemed);
      const remaining = total - minted;

      setCountTotal(total);
      setCountMinted(minted);
      setCountRemaining(remaining);

      const cg = await safeFetchCandyGuard(umi, candyMachine.mintAuthority);
      setGuard(cg ?? null);

      // ✅ FIX: strict-safe parsing of solPayment guard
      const defaultGuards: DefaultGuardSet | undefined = cg?.guards;
      const solPaymentGuard: Option<SolPayment> | undefined = defaultGuards?.solPayment;

      if (solPaymentGuard && isSome(solPaymentGuard)) {
        const lamports: SolAmount = solPaymentGuard.value.lamports;
        const solCost = Number(lamports.basisPoints) / 1_000_000_000;
        setCostInSol(solCost);
      } else {
        setCostInSol(0);
      }

      setMintDisabled(!(remaining > 0));
    } catch (e: any) {
      console.error(e);
      setMintMsg(`Could not fetch candy machine. Check RPC/network. Details: ${e?.message || String(e)}`);
      setMintDisabled(true);
    }
  };

  useEffect(() => {
    retrieveAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintCreated]);

  const MintBlock = () => {
    const wallet = useWallet();

    useEffect(() => {
      if (wallet.connected) umi.use(walletAdapterIdentity(wallet));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet.connected]);

    useEffect(() => {
      const run = async () => {
        if (!wallet.connected) return;

        if (countRemaining !== null && countRemaining <= 0) {
          setMintDisabled(true);
          return;
        }

        if (costInSol <= 0) {
          setMintDisabled(false);
          return;
        }

        try {
          const balance: SolAmount = await umi.rpc.getBalance(umi.identity.publicKey);
          const sol = Number(balance.basisPoints) / 1_000_000_000;
          if (sol < costInSol) {
            setMintMsg('Not enough SOL in wallet.');
            setMintDisabled(true);
          } else {
            setMintDisabled(false);
          }
        } catch (e: any) {
          console.error(e);
          setMintMsg(`Could not read wallet balance: ${e?.message || String(e)}`);
        }
      };
      run();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet.connected, costInSol, countRemaining]);

    const mintBtnHandler = async () => {
      if (!wallet.connected) {
        setMintMsg('Connect your wallet first.');
        return;
      }
      if (!cm) {
        setMintMsg('Candy Machine not loaded (refresh).');
        return;
      }

      setLoading(true);
      setMintMsg(null);

      try {
        const mintArgs: Partial<DefaultGuardSetMintArgs> = {};

        const nftSigner = generateSigner(umi);

        const tx = transactionBuilder()
          .add(setComputeUnitLimit(umi, { units: 600_000 }))
          .add(
            mintV2(umi, {
              candyMachine: cm.publicKey,
              collectionMint: cm.collectionMint,
              collectionUpdateAuthority: cm.authority,
              nftMint: nftSigner,
              candyGuard: guard?.publicKey,
              mintArgs,
              tokenStandard: TokenStandard.NonFungible,
            })
          );

        const { signature } = await tx.sendAndConfirm(umi, {
          confirm: { commitment: 'finalized' },
          send: { skipPreflight: false },
        });

        console.log('Mint signature:', signature);
        setMintCreated(nftSigner.publicKey);
        setMintMsg('Mint successful.');
      } catch (err: any) {
        console.error(err);
        setMintMsg(err?.message || String(err));
      } finally {
        setLoading(false);
      }
    };

    const pill: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      borderRadius: 999,
      border: '1px solid rgba(255,255,255,0.18)',
      background: 'rgba(0,0,0,0.25)',
      color: 'white',
      fontSize: 13,
    };

    return (
      <div
        style={{
          width: '100%',
          borderRadius: 22,
          border: '1px solid rgba(255,255,255,0.16)',
          background: 'rgba(0,0,0,0.35)',
          backdropFilter: 'blur(10px)',
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span style={pill}>Minted: {countMinted ?? '-'} / {countTotal ?? '-'}</span>
            <span style={pill}>Remaining: {countRemaining ?? '-'}</span>
            <span style={pill}>{costInSol > 0 ? `Price: ${costInSol} SOL` : 'Free mint'}</span>
          </div>
          <WalletMultiButtonDynamic />
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '0 0 auto' }}>
            <Image
              src="/preview.gif"
              alt="Preview"
              width={260}
              height={260}
              style={{ borderRadius: 18, border: '1px solid rgba(255,255,255,0.12)' }}
              priority
            />
          </div>

          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'white' }}>
              Collectable 1 — Ishvara Awakening
            </div>
            <div style={{ color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
              Mint the first badge. Later this block becomes the presale buy module (coin purchase), without changing
              the page structure.
            </div>

            {!mintCreated ? (
              <button
                onClick={mintBtnHandler}
                disabled={mintDisabled || loading}
                style={{
                  width: '100%',
                  maxWidth: 360,
                  padding: '14px 16px',
                  borderRadius: 16,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: mintDisabled ? 'rgba(255,255,255,0.10)' : 'rgba(170, 255, 120, 0.22)',
                  color: 'white',
                  fontWeight: 800,
                  cursor: mintDisabled ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Minting…' : `MINT ${costInSol > 0 ? `(${costInSol} SOL)` : ''}`}
              </button>
            ) : (
              <a
                href={`https://solscan.io/token/${base58PublicKey(mintCreated)}${
                  network === WalletAdapterNetwork.Devnet ? '?cluster=devnet' : ''
                }`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  justifyContent: 'center',
                  padding: '12px 14px',
                  borderRadius: 16,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.12)',
                  color: 'white',
                  textDecoration: 'none',
                  fontWeight: 800,
                  maxWidth: 520,
                }}
              >
                View minted NFT on Solscan
              </a>
            )}

            {mintCreated && (
              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
                Mint address: <code style={{ opacity: 0.95 }}>{base58PublicKey(mintCreated)}</code>
              </div>
            )}

            {mintMsg && (
              <div
                style={{
                  borderRadius: 16,
                  border: '1px solid rgba(255,255,255,0.16)',
                  background: 'rgba(0,0,0,0.25)',
                  padding: '10px 12px',
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: 13,
                }}
              >
                {mintMsg}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const navLink: React.CSSProperties = {
    color: 'rgba(255,255,255,0.85)',
    textDecoration: 'none',
    fontSize: 14,
    padding: '8px 10px',
    borderRadius: 12,
  };

  // Helper: consistent background style per block (UPDATED: no crop, scales with block height)
  const bg = (n: string): React.CSSProperties => ({
    backgroundImage: `
      linear-gradient(
        to bottom,
        rgba(0,0,0,0.25),
        rgba(0,0,0,0.45)
      ),
      url('/bckgrnd_ISHVARA_${n}.png')
    `,
    backgroundSize: '100% auto',
    backgroundPosition: 'center center',
    backgroundRepeat: 'no-repeat',
  });

  return (
    <WalletProvider wallets={wallets} autoConnect>
      <WalletModalProvider>
        <main style={{ minHeight: '100vh', width: '100%', background: '#0a0a0a' }}>
          {/* Sticky top nav */}
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              padding: '12px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(0,0,0,0.45)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 980,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    background: 'rgba(255,255,255,0.12)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 900,
                    color: 'white',
                  }}
                >
                  I
                </div>
                <div style={{ color: 'white', fontWeight: 900, letterSpacing: 0.3 }}>ISHVARA</div>
              </div>

              {/* ✅ Updated order + FAQ link */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <a style={navLink} href="#mint">Mint</a>
                <a style={navLink} href="#vision">Vision</a>
                <a style={navLink} href="#whitepaper">Whitepaper</a>
                <a style={navLink} href="#community">Community</a>
                <a style={navLink} href="#faq">FAQ</a>
              </div>
            </div>
          </div>

          {/* Block 1: Hero / Awakening */}
          <Section id="top" style={bg('01')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>Something is shifting.</div>
              <h1 style={{ margin: 0, color: 'white', fontSize: 'clamp(32px, 6vw, 56px)', lineHeight: 1.05 }}>
                Ishvara Awakening
              </h1>
              <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16, maxWidth: 720, lineHeight: 1.6 }}>
                Collectables you can mint now — and later the same block becomes the presale buy module (coin purchase),
                without rebuilding your site structure.
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                <a
                  href="#mint"
                  style={{
                    padding: '12px 16px',
                    borderRadius: 16,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(255,255,255,0.12)',
                    color: 'white',
                    fontWeight: 800,
                    textDecoration: 'none',
                  }}
                >
                  Enter Mint
                </a>
                <a
                  href="#whitepaper"
                  style={{
                    padding: '12px 16px',
                    borderRadius: 16,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(0,0,0,0.15)',
                    color: 'white',
                    fontWeight: 700,
                    textDecoration: 'none',
                  }}
                >
                  Read the Whitepaper
                </a>
              </div>

              <div style={{ marginTop: 8 }}>
                <SocialRow />
              </div>
            </div>
          </Section>

          {/* ✅ Block 2: Mint (moved directly after Awakening) */}
          <Section id="mint" style={bg('02')}>
            <h2 style={{ margin: 0, color: 'white', fontSize: 28 }}>Mint / Buy</h2>
            <div style={{ color: 'rgba(255,255,255,0.75)', lineHeight: 1.7, marginBottom: 4 }}>
              This is the only “action block”. Today: mint NFT. Later: presale buy (coin).
            </div>
            <MintBlock />
          </Section>

          {/* Block 3: Vision */}
          <Section id="vision" style={bg('03')}>
            <h2 style={{ margin: 0, color: 'white', fontSize: 28 }}>Vision</h2>
            <div style={{ color: 'rgba(255,255,255,0.85)', lineHeight: 1.7 }}>
              Ishvara starts with Collectable 1 (Awakening). This page stays minimal. As the project matures, we add
              presale, staking, and other modules — still on this same single-page structure.
            </div>
          </Section>

          {/* Block 4: Whitepaper */}
          <Section id="whitepaper" style={bg('04')}>
            <h2 style={{ margin: 0, color: 'white', fontSize: 28 }}>Whitepaper</h2>
            <div style={{ color: 'rgba(255,255,255,0.85)', lineHeight: 1.7 }}>
              Later you can host a PDF in <code>/public</code> or on IPFS and link it here.
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a
                href="#"
                style={{
                  padding: '12px 16px',
                  borderRadius: 16,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.10)',
                  color: 'white',
                  fontWeight: 800,
                  textDecoration: 'none',
                }}
              >
                Download (placeholder)
              </a>
            </div>
          </Section>

          {/* Block 5: Community */}
          <Section id="community" style={bg('05')}>
            <h2 style={{ margin: 0, color: 'white', fontSize: 28 }}>Community</h2>
            <div style={{ color: 'rgba(255,255,255,0.85)', lineHeight: 1.7 }}>
              Follow and stay updated. If you want, leave an email (optional).
            </div>
            <SocialRow />
            <EmailCapture />

            <div style={{ marginTop: 10, color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>
              Network: {process.env.NEXT_PUBLIC_NETWORK || 'mainnet'} • This site does not store wallet identities on a
              server.
            </div>
          </Section>

          {/* ✅ Block 6: FAQ (new last block) */}
          <Section id="faq" style={bg('06')}>
            <h2 style={{ margin: 0, color: 'white', fontSize: 28 }}>FAQ</h2>
            <FAQ />
          </Section>

          <div style={{ padding: '28px 16px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '100%', maxWidth: 980, color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
              © {new Date().getFullYear()} Ishvara — single page build.
            </div>
          </div>
        </main>
      </WalletModalProvider>
    </WalletProvider>
  );
}
