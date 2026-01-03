'use client';

import Image from 'next/image';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';

import styles from './page.module.css';

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

/** ---------- Env helpers ---------- */
function getNetwork(): WalletAdapterNetwork {
  const n = (process.env.NEXT_PUBLIC_NETWORK || '').toLowerCase().trim();
  if (n === 'devnet') return WalletAdapterNetwork.Devnet;
  if (n === 'testnet') return WalletAdapterNetwork.Testnet;
  return WalletAdapterNetwork.Mainnet; // default
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

/** ---------- Small UI helpers ---------- */
function shorten(addr: string, left = 4, right = 4) {
  if (!addr) return '';
  if (addr.length <= left + right + 3) return addr;
  return `${addr.slice(0, left)}…${addr.slice(-right)}`;
}

export default function Home() {
  const network = getNetwork();
  const endpoint = getEndpoint();

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network }),
      new LedgerWalletAdapter(),
    ],
    [network]
  );

  const [umi] = useState<Umi>(() => createUmi(endpoint).use(mplTokenMetadata()).use(mplCandyMachine()));

  /** ---------- Global state ---------- */
  const [loading, setLoading] = useState(false);
  const [mintCreated, setMintCreated] = useState<PublicKey | null>(null);
  const [mintMsg, setMintMsg] = useState<string | undefined>(undefined);

  const [cm, setCm] = useState<CandyMachine | null>(null);
  const [guard, setGuard] = useState<CandyGuard<DefaultGuardSet> | null>(null);

  const [countTotal, setCountTotal] = useState<number | null>(null);
  const [countMinted, setCountMinted] = useState<number | null>(null);
  const [countRemaining, setCountRemaining] = useState<number | null>(null);

  const [costInSol, setCostInSol] = useState<number>(0);
  const [mintDisabled, setMintDisabled] = useState<boolean>(true);

  /** ---------- Fetch CM + Guard + price ---------- */
  const retrieveAvailability = useCallback(async () => {
    try {
      setMintMsg(undefined);

      const cmIdStr = getCandyMachineId();
      if (!cmIdStr) {
        setMintMsg('No candy machine ID found. Set NEXT_PUBLIC_CANDY_MACHINE_ID in Vercel / .env.local.');
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
      const remaining = Math.max(0, total - minted);

      setCountTotal(total);
      setCountMinted(minted);
      setCountRemaining(remaining);

      const cg = await safeFetchCandyGuard(umi, candyMachine.mintAuthority);
      setGuard(cg ?? null);

      // Price from solPayment guard (safe w/ strict null checks)
      const defaultGuards: DefaultGuardSet | undefined = cg?.guards;
      const solPaymentGuard: Option<SolPayment> | undefined = defaultGuards?.solPayment;

      if (solPaymentGuard && isSome(solPaymentGuard)) {
        const lamports = solPaymentGuard.value.lamports;
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
  }, [umi]);

  useEffect(() => {
    retrieveAvailability();
  }, [retrieveAvailability, mintCreated]);

  /** ---------- Mint block component (uses wallet) ---------- */
  const MintBlock = () => {
    const wallet = useWallet();

    // Bind wallet to Umi identity
    useEffect(() => {
      if (wallet?.connected) {
        umi.use(walletAdapterIdentity(wallet));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet?.connected]);

    // Balance check (optional)
    useEffect(() => {
      const run = async () => {
        if (!wallet.connected) return;

        // Free mint -> only check remaining
        if (costInSol <= 0) {
          setMintDisabled(!(countRemaining !== null && countRemaining > 0));
          return;
        }

        try {
          const balance: SolAmount = await umi.rpc.getBalance(umi.identity.publicKey);
          const sol = Number(balance.basisPoints) / 1_000_000_000;
          if (sol < costInSol) {
            setMintMsg('Add more SOL to your wallet.');
            setMintDisabled(true);
          } else {
            setMintDisabled(!(countRemaining !== null && countRemaining > 0));
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
        setMintMsg('Candy Machine not loaded yet. Refresh the page.');
        return;
      }

      setLoading(true);
      setMintMsg(undefined);

      try {
        const mintArgs: Partial<DefaultGuardSetMintArgs> = {};
        // Most guards don’t require args if configured on-chain.
        // If later you enable allowList, gatekeeper, etc., we’ll add mintArgs.

        const nftSigner = generateSigner(umi);

        const tx = transactionBuilder()
          .add(setComputeUnitLimit(umi, { units: 600_000 }))
          .add(
            mintV2(umi, {
              candyMachine: cm.publicKey,
              collectionMint: cm.collectionMint,
              collectionUpdateAuthority: cm.authority,
              nftMint: nftSigner,
              candyGuard: guard?.publicKey, // ok if undefined
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
        setMintMsg('Mint was successful!');
      } catch (err: any) {
        console.error(err);
        setMintMsg(err?.message || String(err));
      } finally {
        setLoading(false);
      }
    };

    const cluster = network === WalletAdapterNetwork.Devnet ? '?cluster=devnet' : '';

    return (
      <div
        style={{
          width: '100%',
          maxWidth: 980,
          margin: '0 auto',
          borderRadius: 16,
          padding: 20,
          border: '1px solid rgba(0,0,0,0.12)',
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(6px)',
        }}
      >
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <h2 style={{ margin: 0, fontSize: 28 }}>Collectable #1</h2>
            <p style={{ marginTop: 8, marginBottom: 12, opacity: 0.85 }}>
              Mint your first Ishvara collectable. Later this block becomes the presale module.
            </p>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', opacity: 0.85 }}>
              <div>Minted: <b>{countMinted ?? '-'}</b> / <b>{countTotal ?? '-'}</b></div>
              <div>Remaining: <b>{countRemaining ?? '-'}</b></div>
              <div>Price: <b>{costInSol > 0 ? `${costInSol} SOL` : 'FREE'}</b></div>
            </div>

            <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={mintBtnHandler}
                className={styles.mintBtn}
                disabled={mintDisabled || loading}
                style={{
                  borderRadius: 12,
                  border: 'none',
                  padding: '14px 18px',
                  minWidth: 220,
                }}
              >
                {loading ? 'MINTING…' : 'MINT NOW'}
              </button>

              {mintCreated && (
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={`https://solscan.io/token/${base58PublicKey(mintCreated)}${cluster}`}
                  style={{
                    textDecoration: 'none',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid rgba(0,0,0,0.15)',
                    background: 'white',
                    color: 'black',
                  }}
                >
                  View on Solscan: <b>{shorten(base58PublicKey(mintCreated))}</b>
                </a>
              )}
            </div>

            {!wallet.connected && (
              <p style={{ marginTop: 10, opacity: 0.8 }}>Connect your wallet to mint.</p>
            )}
          </div>

          <div style={{ flex: '0 0 260px', textAlign: 'center' }}>
            <Image
              src="/preview.gif"
              alt="Preview"
              width={240}
              height={240}
              priority
              style={{ borderRadius: 14, border: '1px solid rgba(0,0,0,0.12)' }}
            />
          </div>
        </div>
      </div>
    );
  };

  /** ---------- Page layout (single long page with blocks) ---------- */
  return (
    <WalletProvider wallets={wallets} autoConnect>
      <WalletModalProvider>
        <main
          className={styles.main}
          style={{
            padding: '32px 16px',
            minHeight: '100vh',
            width: '100%',
          }}
        >
          {/* Top bar */}
          <div
            style={{
              width: '100%',
              maxWidth: 980,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              margin: '0 auto 18px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Image src="/favicon.ico" alt="Ishvara" width={24} height={24} />
              <b>Ishvara</b>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <a href="#mint" style={{ textDecoration: 'none' }}>Mint</a>
              <a href="#about" style={{ textDecoration: 'none' }}>About</a>
              <a href="#updates" style={{ textDecoration: 'none' }}>Updates</a>
              <WalletMultiButtonDynamic />
            </div>
          </div>

          {/* HERO */}
          <section
            style={{
              width: '100%',
              maxWidth: 980,
              margin: '0 auto',
              borderRadius: 18,
              padding: 24,
              border: '1px solid rgba(0,0,0,0.12)',
              background:
                'linear-gradient(135deg, rgba(0,0,0,0.65), rgba(0,0,0,0.15))',
              color: 'white',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* If you later want your OWN photo background: put it in /public and set it here */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: `url("/hero-bg.jpg")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                opacity: 0.25,
              }}
            />
            <div style={{ position: 'relative' }}>
              <h1 style={{ margin: 0, fontSize: 42, lineHeight: 1.1 }}>Something is shifting.</h1>
              <p style={{ marginTop: 10, maxWidth: 680, opacity: 0.9 }}>
                Ishvara is an evolving collection + future token ecosystem.
                Start with Collectable #1.
              </p>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                <a
                  href="#mint"
                  style={{
                    textDecoration: 'none',
                    background: 'white',
                    color: 'black',
                    padding: '10px 14px',
                    borderRadius: 12,
                    fontWeight: 700,
                  }}
                >
                  Go to Mint
                </a>
                <a
                  href="#updates"
                  style={{
                    textDecoration: 'none',
                    border: '1px solid rgba(255,255,255,0.5)',
                    color: 'white',
                    padding: '10px 14px',
                    borderRadius: 12,
                    fontWeight: 700,
                  }}
                >
                  Get Updates
                </a>
              </div>

              <div style={{ display: 'flex', gap: 14, marginTop: 14, opacity: 0.9, flexWrap: 'wrap' }}>
                <a href="#" style={{ color: 'white', textDecoration: 'none' }}>X</a>
                <a href="#" style={{ color: 'white', textDecoration: 'none' }}>Telegram</a>
                <a href="#" style={{ color: 'white', textDecoration: 'none' }}>Discord</a>
              </div>
            </div>
          </section>

          {/* MINT BLOCK */}
          <section
            id="mint"
            style={{
              width: '100%',
              marginTop: 18,
              padding: 0,
            }}
          >
            <MintBlock />
          </section>

          {/* ABOUT / WHITEPAPER PLACEHOLDER */}
          <section
            id="about"
            style={{
              width: '100%',
              maxWidth: 980,
              margin: '18px auto 0',
              borderRadius: 18,
              padding: 24,
              border: '1px solid rgba(0,0,0,0.12)',
              background: 'linear-gradient(135deg, rgba(250,250,250,1), rgba(235,235,235,1))',
            }}
          >
            <h2 style={{ marginTop: 0 }}>About</h2>
            <p style={{ marginBottom: 0, opacity: 0.85 }}>
              This block is where you’ll later place your whitepaper / lore / roadmap.
              (We can add a downloadable PDF, sections, and anchors.)
            </p>
          </section>

          {/* UPDATES / EMAIL CAPTURE */}
          <section
            id="updates"
            style={{
              width: '100%',
              maxWidth: 980,
              margin: '18px auto 0',
              borderRadius: 18,
              padding: 24,
              border: '1px solid rgba(0,0,0,0.12)',
              background: 'linear-gradient(135deg, rgba(20,20,20,1), rgba(60,60,60,1))',
              color: 'white',
            }}
          >
            <h2 style={{ marginTop: 0 }}>Get updates</h2>
            <p style={{ opacity: 0.9 }}>
              Leave your email to get notified about new collectables and the future presale.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setMintMsg('Email capture is placeholder for now (we can connect Formspree / Buttondown / Mailchimp).');
              }}
              style={{
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                marginTop: 12,
              }}
            >
              <input
                type="email"
                required
                placeholder="you@proton.me"
                style={{
                  flex: '1 1 260px',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: 'none',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: 'none',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Notify me
              </button>
            </form>

            <div style={{ display: 'flex', gap: 14, marginTop: 14, opacity: 0.9, flexWrap: 'wrap' }}>
              <a href="#" style={{ color: 'white', textDecoration: 'none' }}>X</a>
              <a href="#" style={{ color: 'white', textDecoration: 'none' }}>Telegram</a>
              <a href="#" style={{ color: 'white', textDecoration: 'none' }}>Discord</a>
              <a href="#" style={{ color: 'white', textDecoration: 'none' }}>Email</a>
            </div>
          </section>

          {/* Toast / message */}
          {mintMsg && (
            <div
              className={styles.mintMsg}
              style={{
                position: 'fixed',
                bottom: 18,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'min(920px, calc(100% - 24px))',
                background: 'white',
                borderRadius: 14,
                border: '1px solid rgba(0,0,0,0.15)',
                padding: 14,
                boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
                zIndex: 50,
              }}
            >
              <button
                className={styles.mintMsgClose}
                onClick={() => setMintMsg(undefined)}
                style={{
                  float: 'right',
                  borderRadius: 10,
                  padding: '4px 10px',
                  border: 'none',
                  backgroundColor: '#eee',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
              <span style={{ display: 'block', paddingRight: 30 }}>{mintMsg}</span>
            </div>
          )}
        </main>
      </WalletModalProvider>
    </WalletProvider>
  );
}
