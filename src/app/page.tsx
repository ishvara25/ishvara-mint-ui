


'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';

import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter, LedgerWalletAdapter } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  base58PublicKey,
  generateSigner,
  isSome,
  publicKey,
  some,
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
  if (n === 'mainnet' || n === 'mainnet-beta') return WalletAdapterNetwork.Mainnet;
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
        position: 'relative',
        overflow: 'hidden',
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
          position: 'relative',
          zIndex: 2,
        }}
      >
        {children}
      </div>
    </section>
  );
}

function SocialRow() {
  const iconBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(18,10,30,0.42)',
    color: 'white',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.2,
  };

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <a style={iconBtn} href="https://x.com/ISHVA_X" target="_blank" rel="noreferrer">
        <span>𝕏</span>
        <span>Follow on X</span>
      </a>
      <a
        style={iconBtn}
        href="https://discord.gg/huQ7a4xNBc"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Join ISHVA on Discord"
      >
        <span aria-hidden="true">◉</span>
        <span>Discord</span>
      </a>
      <a
        style={iconBtn}
        href="https://paragraph.com/@ishva"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Read ISHVA on Paragraph"
      >
        <span aria-hidden="true">¶</span>
        <span>Paragraph</span>
      </a>
      <a style={iconBtn} href="#faq">
        <span>?</span>
        <span>FAQ</span>
      </a>
      <a style={iconBtn} href="#mint">
        <span>◈</span>
        <span>Mint</span>
      </a>
    </div>
  );
}

function FAQTop6() {
  const card: React.CSSProperties = {
    borderRadius: 18,
    border: '1px solid rgba(255,255,255,0.14)',
    background: 'rgba(10, 8, 20, 0.42)',
    backdropFilter: 'blur(10px)',
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  };

  const q: React.CSSProperties = {
    color: 'white',
    fontWeight: 800,
    fontSize: 15,
    lineHeight: 1.45,
  };

  const a: React.CSSProperties = {
    color: 'rgba(255,255,255,0.88)',
    lineHeight: 1.75,
    fontSize: 15,
    fontWeight: 400,
  };

  const items = [
    {
      q: 'What is the ISHVA Launch NFT?',
      a: 'The Launch NFT is the first participation marker in the ISHVA ecosystem. The launch is limited to 888 unique NFTs. Each one marks early support and participation from the beginning.',
    },
    {
      q: 'Why mint the NFT?',
      a: 'Minting the NFT means you support the philosophy of Ishvara, become part of the early participation layer, hold one of the 888 unique Launch NFTs, and gain access to future ecosystem developments.',
    },
    {
      q: 'How do I mint it?',
      a: 'Install a Solana wallet, fund it with enough SOL for the mint and network fees, connect it on this page, and approve the transaction. The live mint price is 0.2 SOL. After confirmation, the NFT appears in your wallet collectibles.',
    },
    {
      q: 'Which wallet is recommended?',
      a: 'Phantom and Solflare are the easiest options for most people. Ledger also works for users who already use hardware wallets.',
    },
    {
      q: 'What is the difference between Ishvara, ISHVA, and the ISHVA coin?',
      a: 'Ishvara is the philosophy. ISHVA is the participation layer and ecosystem that grows from it. The ISHVA coin comes later as a functional participation layer designed to support continuity, access, and contribution inside the ecosystem.',
    },
    {
      q: 'Where can I ask questions or get support?',
      a: 'For questions or technical help you can contact ishva_x@proton.me. Using an anonymous email address is fine. You can also follow updates on X at @ISHVA_X.',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((it, idx) => (
        <div key={idx} style={card}>
          <div style={q}>{it.q}</div>
          <div style={a}>{it.a}</div>
        </div>
      ))}
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

        const defaultGuards: DefaultGuardSet | undefined = guard?.guards;
        const solPaymentGuard: Option<SolPayment> | undefined = defaultGuards?.solPayment;

        if (solPaymentGuard && isSome(solPaymentGuard)) {
          mintArgs.solPayment = some({
            destination: solPaymentGuard.value.destination,
          });
        }

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
      border: '1px solid rgba(255,255,255,0.16)',
      background: 'rgba(15,10,28,0.42)',
      color: 'white',
      fontSize: 13,
      fontWeight: 700,
      lineHeight: 1.2,
    };

    const bodyText: React.CSSProperties = {
      color: 'rgba(255,255,255,0.88)',
      lineHeight: 1.75,
      fontSize: 16,
      fontWeight: 400,
    };

    return (
      <div
        style={{
          width: '100%',
          borderRadius: 24,
          border: '1px solid rgba(255,255,255,0.14)',
          background: 'rgba(12, 8, 22, 0.48)',
          backdropFilter: 'blur(10px)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxShadow: '0 0 30px rgba(0,0,0,0.18)',
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                color: 'rgba(255,255,255,0.72)',
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                lineHeight: 1.2,
              }}
            >
              ISHVA Launch NFT
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span style={pill}>Minted: {countMinted ?? '-'} / {countTotal ?? '-'}</span>
              <span style={pill}>Remaining: {countRemaining ?? '-'}</span>
              <span style={pill}>{costInSol > 0 ? `Price: ${costInSol} SOL` : 'Free mint'}</span>
            </div>
          </div>

          <WalletMultiButtonDynamic />
        </div>

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
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

          <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                fontSize: 30,
                fontWeight: 900,
                color: 'white',
                lineHeight: 1.15,
                letterSpacing: -0.3,
              }}
            >
              Mint the Launch NFT
            </div>

            <div style={bodyText}>
              The ISHVA Launch NFT marks the beginning of participation in the ecosystem.
              <br />
              There will be <strong>888 unique Launch NFTs</strong>.
              <br />
              Each one marks early participation in the ISHVA ecosystem.
            </div>

            <div style={bodyText}>
              Minting the Launch NFT records your participation on-chain and sends the NFT to your wallet.
              <br />
              The mint price for the live launch is <strong>0.2 SOL</strong>.
            </div>

            <div style={{ height: 12 }} />

            {!mintCreated ? (
              <button
                onClick={mintBtnHandler}
                disabled={mintDisabled || loading}
                style={{
                  width: '100%',
                  maxWidth: 360,
                  padding: '15px 18px',
                  borderRadius: 16,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: mintDisabled ? 'rgba(255,255,255,0.10)' : 'rgba(145, 108, 255, 0.28)',
                  color: 'white',
                  fontWeight: 900,
                  fontSize: 15,
                  lineHeight: 1.2,
                  cursor: mintDisabled ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Minting…' : `Mint Launch NFT ${costInSol > 0 ? `(${costInSol} SOL)` : ''}`}
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
                  fontSize: 15,
                  lineHeight: 1.2,
                  maxWidth: 520,
                }}
              >
                View minted NFT on Solscan
              </a>
            )}

            {mintCreated && (
              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 1.5 }}>
                Mint address: <code style={{ opacity: 0.95 }}>{base58PublicKey(mintCreated)}</code>
              </div>
            )}

            {mintMsg && (
              <div
                style={{
                  borderRadius: 16,
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(0,0,0,0.25)',
                  padding: '10px 12px',
                  color: 'rgba(255,255,255,0.94)',
                  fontSize: 13,
                  lineHeight: 1.55,
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
    color: 'rgba(255,255,255,0.9)',
    textDecoration: 'none',
    fontSize: 14,
    padding: '10px 12px',
    borderRadius: 12,
    fontWeight: 800,
    letterSpacing: 0.2,
    lineHeight: 1.2,
  };

  const bg = (n: string): React.CSSProperties => ({
    backgroundImage: `
      linear-gradient(to bottom, rgba(18,8,40,0.58), rgba(10,6,22,0.76)),
      url('/bckgrnd_ISHVARA_${n}.png')
    `,
    backgroundSize: 'cover',
    backgroundPosition: n === '01' || n === '03' ? 'center bottom' : 'center',
    backgroundRepeat: 'no-repeat',
    backgroundColor: '#12081f',
  });

  const disabledLink: React.CSSProperties = {
    ...navLink,
    opacity: 0.45,
    cursor: 'not-allowed',
    pointerEvents: 'none',
  };

  const headingStyle: React.CSSProperties = {
    margin: 0,
    color: 'white',
    fontSize: 30,
    fontWeight: 900,
    lineHeight: 1.15,
    letterSpacing: -0.3,
  };

  const bodyStyle: React.CSSProperties = {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 16,
    lineHeight: 1.8,
    fontWeight: 400,
  };

  return (
    <WalletProvider wallets={wallets} autoConnect>
      <WalletModalProvider>
        <main
          style={{
            minHeight: '100vh',
            width: '100%',
            background: 'radial-gradient(circle at top, rgba(88,43,145,0.25), transparent 30%), #12081f',
          }}
        >
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
              background: 'rgba(10, 6, 22, 0.56)',
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
                    lineHeight: 1,
                  }}
                >
                  I
                </div>
                <div style={{ color: 'white', fontWeight: 900, letterSpacing: 0.3, lineHeight: 1.2 }}>ISHVARA</div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a style={navLink} href="#mint">
                  Mint
                </a>
                <a style={navLink} href="#vision">
                  Vision
                </a>
                <a
                  style={navLink}
                  href="/whitepaper.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Whitepaper
                </a>
                <a style={navLink} href="#faq">
                  FAQ
                </a>
              </div>
            </div>
          </div>

          <Section id="top" style={bg('01')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ color: 'rgba(255,255,255,0.78)', fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>
                A philosophy — not a hierarchy
              </div>

              <h1
                style={{
                  margin: 0,
                  color: 'white',
                  fontSize: 'clamp(36px, 6.5vw, 62px)',
                  lineHeight: 1.02,
                  fontWeight: 900,
                  letterSpacing: -0.8,
                }}
              >
                Ishvara
              </h1>

              <div
                style={{
                  color: 'rgba(255,255,255,0.92)',
                  fontSize: 16,
                  maxWidth: 780,
                  lineHeight: 1.8,
                  fontWeight: 400,
                }}
              >
                Ishvara begins with a simple recognition:
                <br />
                <strong>coherence can exist without being imposed.</strong>
                <br />
                <br />
                Creation doesn’t need permission from algorithms, trends, or urgency.
                <br />
                It isn’t a belief.
                <br />
                It isn’t a brand.
                <br />
                It’s the ground where honest work can emerge.
                <br />
                <br />
                <strong>Ishvara is the philosophy.</strong>
                <br />
                <strong>ISHVA is how that recognition becomes participation.</strong>
                <br />
                <br />
                The launch begins with <strong>888 unique NFTs</strong> for those who choose to participate early.
              </div>

              <div style={{ color: 'rgba(255,255,255,0.68)', fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
                Mint the Launch NFT only if the idea resonates.
              </div>

              <div style={{ height: 10 }} />

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <a
                  href="#mint"
                  style={{
                    padding: '13px 18px',
                    borderRadius: 16,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(145, 108, 255, 0.26)',
                    color: 'white',
                    fontWeight: 900,
                    textDecoration: 'none',
                    fontSize: 15,
                    lineHeight: 1.2,
                  }}
                >
                  Enter Mint
                </a>

                <a
                  href="#vision"
                  style={{
                    padding: '13px 18px',
                    borderRadius: 16,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(0,0,0,0.18)',
                    color: 'white',
                    fontWeight: 800,
                    textDecoration: 'none',
                    fontSize: 15,
                    lineHeight: 1.2,
                  }}
                >
                  Read the Vision
                </a>

                <a
                  href="/whitepaper.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '13px 18px',
                    borderRadius: 16,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(0,0,0,0.18)',
                    color: 'white',
                    fontWeight: 800,
                    textDecoration: 'none',
                    fontSize: 15,
                    lineHeight: 1.2,
                  }}
                >
                  Read the Whitepaper
                </a>
              </div>

              <div style={{ height: 16 }} />
              <SocialRow />
            </div>
          </Section>

          <Section id="mint" style={bg('02')}>
            <MintBlock />
          </Section>

          <Section id="vision" style={bg('03')}>
            <h2 style={headingStyle}>Vision</h2>

            <div
              style={{
                maxWidth: 880,
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <div
                style={{
                  color: 'white',
                  fontSize: 20,
                  fontWeight: 900,
                  lineHeight: 1.35,
                }}
              >
                <strong>Ishvara begins as a recognition.</strong>
              </div>

              <div style={bodyStyle}>
                ISHVA turns that recognition into a living ecosystem where meaningful creation can emerge without
                algorithmic pressure.
              </div>

              <div
                style={{
                  color: 'rgba(255,255,255,0.96)',
                  lineHeight: 1.8,
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                People create because something real wants to take form — not because a system demands performance.
              </div>

              <div style={bodyStyle}>
                What is made can be artistic, practical, intellectual, or communal.
                <br />
                Its value is not defined by category, but by the resonance it carries.
              </div>

              <div style={bodyStyle}>
                The launch begins with <strong>888 unique NFTs</strong> that mark early participation and help sustain
                what continues.
              </div>

              <div style={bodyStyle}>
                <strong>Participation</strong> — support the philosophy and help the ecosystem take shape.
                <br />
                <strong>Access</strong> — NFT holders gain access to future platform initiatives and early releases.
                <br />
                <strong>Continuity</strong> — the NFT connects participants to future phases of the ISHVA ecosystem.
              </div>

              <div style={bodyStyle}>
                <strong>Ishvara gives direction.</strong>
                <br />
                <strong>ISHVA sustains what follows.</strong>
                <br />
                <br />
                The <strong>ISHVA coin</strong> comes later as a participation layer — not to lead the ecosystem, but
                to support continuity, contribution, and alignment inside it.
              </div>

              <div
                style={{
                  color: 'rgba(213,190,255,0.98)',
                  lineHeight: 1.6,
                  fontSize: 22,
                  fontWeight: 900,
                  letterSpacing: 0.2,
                }}
              >
                What resonates, continues.
              </div>
            </div>
          </Section>

          <Section id="faq" style={bg('04')}>
            <h2 style={headingStyle}>FAQ</h2>
            <div style={{ color: 'rgba(255,255,255,0.8)', lineHeight: 1.75, fontSize: 15, fontWeight: 400 }}>
              Plain answers for first-time visitors.
            </div>
            <FAQTop6 />
          </Section>

          <div style={{ padding: '28px 16px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '100%', maxWidth: 980, color: 'rgba(255,255,255,0.45)', fontSize: 12, lineHeight: 1.5 }}>
              © {new Date().getFullYear()} Ishvara — single page build.
            </div>
          </div>
        </main>
      </WalletModalProvider>
    </WalletProvider>
  );
}