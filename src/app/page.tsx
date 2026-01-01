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
  publicKey,
  some,
  transactionBuilder,
  unwrapSome,
  type Option,
  type PublicKey as UmiPublicKey,
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
  const n = (process.env.NEXT_PUBLIC_NETWORK || 'mainnet-beta').toLowerCase().trim();
  if (n === 'devnet') return WalletAdapterNetwork.Devnet;
  if (n === 'testnet') return WalletAdapterNetwork.Testnet;
  return WalletAdapterNetwork.Mainnet;
}

function getEndpoint(): string {
  // In Vercel: zet NEXT_PUBLIC_RPC_URL als volledige URL: https://.......
  const rpc = (process.env.NEXT_PUBLIC_RPC_URL || '').trim();
  if (rpc && (rpc.startsWith('https://') || rpc.startsWith('http://'))) return rpc;

  // fallback
  const network = getNetwork();
  if (network === WalletAdapterNetwork.Devnet) return 'https://api.devnet.solana.com';
  if (network === WalletAdapterNetwork.Testnet) return 'https://api.testnet.solana.com';
  return 'https://api.mainnet-beta.solana.com';
}

function getCandyMachineId(): string | null {
  const raw = process.env.NEXT_PUBLIC_CANDY_MACHINE_ID;
  if (!raw) return null;
  // strip whitespace + quotes
  return raw.trim().replace(/^["']|["']$/g, '');
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

  // Base umi (zonder wallet identity)
  const umiBase: Umi = useMemo(() => {
    return createUmi(endpoint).use(mplTokenMetadata()).use(mplCandyMachine());
  }, [endpoint]);

  // State
  const [loading, setLoading] = useState(false);
  const [mintCreated, setMintCreated] = useState<UmiPublicKey | null>(null);
  const [mintMsg, setMintMsg] = useState<string | undefined>(undefined);

  const [cm, setCm] = useState<CandyMachine | null>(null);
  const [guard, setGuard] = useState<CandyGuard<DefaultGuardSet> | null>(null);

  const [countTotal, setCountTotal] = useState<number>(0);
  const [countMinted, setCountMinted] = useState<number>(0);
  const [countRemaining, setCountRemaining] = useState<number>(0);

  const [costInSol, setCostInSol] = useState<number>(0);
  const [mintDisabled, setMintDisabled] = useState<boolean>(true);

  // Load CM + Guard + counts + cost
  const retrieveAvailability = useCallback(async () => {
    try {
      setMintMsg(undefined);

      const cmIdStr = getCandyMachineId();
      if (!cmIdStr) {
        setMintMsg('No candy machine ID found. Set NEXT_PUBLIC_CANDY_MACHINE_ID.');
        setMintDisabled(true);
        return;
      }

      let cmPk: UmiPublicKey;
      try {
        cmPk = publicKey(cmIdStr);
      } catch {
        setMintMsg('Invalid candy machine public key. Check NEXT_PUBLIC_CANDY_MACHINE_ID (no quotes/spaces).');
        setMintDisabled(true);
        return;
      }

      const candyMachine = await fetchCandyMachine(umiBase, cmPk);
      setCm(candyMachine);

      const total = candyMachine.itemsLoaded;
      const minted = Number(candyMachine.itemsRedeemed);
      const remaining = total - minted;

      setCountTotal(total);
      setCountMinted(minted);
      setCountRemaining(remaining);

      // Guard ophalen
      const cg = await safeFetchCandyGuard(umiBase, candyMachine.mintAuthority);
      setGuard(cg ?? null);

      // Cost uit solPayment (als aanwezig)
      let solCost = 0;
      const defaultGuards: DefaultGuardSet | undefined = cg?.guards;
      const solPaymentGuard: Option<SolPayment> | undefined = defaultGuards?.solPayment;

      if (solPaymentGuard) {
        const solPayment = unwrapSome(solPaymentGuard);
        if (solPayment) {
          const lamports: SolAmount = solPayment.lamports;
          solCost = Number(lamports.basisPoints) / 1_000_000_000;
        }
      }

      setCostInSol(solCost);
      setMintDisabled(!(remaining > 0));
    } catch (e: any) {
      console.error(e);
      setMintMsg(`Could not fetch candy machine. Details: ${e?.message || String(e)}`);
      setMintDisabled(true);
    }
  }, [umiBase]);

  useEffect(() => {
    retrieveAvailability();
  }, [retrieveAvailability, mintCreated]);

  const Mint = () => {
    const wallet = useWallet();

    // umi mét wallet identity (alleen als wallet connected)
    const umi = useMemo(() => {
      return umiBase.use(walletAdapterIdentity(wallet));
    }, [umiBase, wallet]);

    // check balance zodra wallet connected en prijs bekend
    useEffect(() => {
      let cancelled = false;

      const run = async () => {
        if (!wallet.connected) return;

        // Free mint of 0: alleen remaining check
        if (costInSol <= 0) {
          if (!cancelled) setMintDisabled(!(countRemaining > 0));
          return;
        }

        try {
          const balance: SolAmount = await umi.rpc.getBalance(umi.identity.publicKey);
          const sol = Number(balance.basisPoints) / 1_000_000_000;

          if (cancelled) return;

          if (sol < costInSol) {
            setMintMsg('Add more SOL to your wallet.');
            setMintDisabled(true);
          } else {
            setMintDisabled(!(countRemaining > 0));
          }
        } catch (e: any) {
          console.error(e);
          if (!cancelled) setMintMsg(`Could not read wallet balance: ${e?.message || String(e)}`);
        }
      };

      run();
      return () => {
        cancelled = true;
      };
    }, [wallet.connected, umi, costInSol, countRemaining]);

    const mintBtnHandler = async () => {
      if (!wallet.connected) {
        setMintMsg('Connect your wallet first.');
        return;
      }
      if (!cm) {
        setMintMsg('Candy Machine not loaded. Refresh the page.');
        return;
      }

      setLoading(true);
      setMintMsg(undefined);

      try {
        const mintArgs: Partial<DefaultGuardSetMintArgs> = {};

        // Als er solPayment guard is, moet destination mee in mintArgs
        const defaultGuards: DefaultGuardSet | undefined = guard?.guards;
        const solPaymentGuard: Option<SolPayment> | undefined = defaultGuards?.solPayment;

        if (solPaymentGuard) {
          const solPayment = unwrapSome(solPaymentGuard);
          if (solPayment) {
            mintArgs.solPayment = some({
              destination: solPayment.destination,
            });
          }
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
              candyGuard: guard?.publicKey, // ok als undefined
              mintArgs,
              tokenStandard: TokenStandard.ProgrammableNonFungible,
            })
          );

        await tx.sendAndConfirm(umi, {
          confirm: { commitment: 'finalized' },
          send: { skipPreflight: false },
        });

        setMintCreated(nftSigner.publicKey);
        setMintMsg('Mint was successful!');
      } catch (err: any) {
        console.error(err);
        setMintMsg(err?.message || String(err));
      } finally {
        setLoading(false);
      }
    };

    if (!wallet.connected) return <p>Please connect your wallet.</p>;

    if (mintCreated) {
      const cluster = network === WalletAdapterNetwork.Devnet ? '?cluster=devnet' : '';
      return (
        <a
          className={styles.success}
          target="_blank"
          rel="noreferrer"
          href={`https://solscan.io/token/${base58PublicKey(mintCreated)}${cluster}`}
        >
          <Image
            className={styles.logo}
            src="/nftHolder.png"
            alt="Minted NFT"
            width={300}
            height={300}
            priority
          />
          <p className="mintAddress">
            <code>{base58PublicKey(mintCreated)}</code>
          </p>
        </a>
      );
    }

    return (
      <>
        <button
          onClick={mintBtnHandler}
          className={styles.mintBtn}
          disabled={mintDisabled || loading}
        >
          MINT
          <br />
          {costInSol > 0 ? `(${costInSol} SOL)` : '(FREE)'}
        </button>
        {loading && <div className={styles.loadingDots}>. . .</div>}
      </>
    );
  };

  return (
    <WalletProvider wallets={wallets} autoConnect>
      <WalletModalProvider>
        <main className={styles.main}>
          <WalletMultiButtonDynamic />

          <h1>Mint UI (CMv3)</h1>

          <Image
            className={styles.logo}
            src="/preview.gif"
            alt="Preview of NFTs"
            width={300}
            height={300}
            priority
          />

          <div className={styles.countsContainer}>
            <div>
              Minted: {countMinted} / {countTotal}
            </div>
            <div>Remaining: {countRemaining}</div>
          </div>

          <Mint />

          {mintMsg && (
            <div className={styles.mintMsg}>
              <button
                className={styles.mintMsgClose}
                onClick={() => setMintMsg(undefined)}
              >
                &times;
              </button>
              <span>{mintMsg}</span>
            </div>
          )}
        </main>
      </WalletModalProvider>
    </WalletProvider>
  );
}
