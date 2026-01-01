'use client';

import Image from 'next/image';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';

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

  // Must be a full URL like https://...
  if (!rpc || !rpc.startsWith('http')) {
    // Fallbacks (but you should set RPC in .env.local)
    const network = getNetwork();
    if (network === WalletAdapterNetwork.Devnet) return 'https://api.devnet.solana.com';
    if (network === WalletAdapterNetwork.Testnet) return 'https://api.testnet.solana.com';
    return 'https://api.mainnet-beta.solana.com';
  }
  return rpc;
}

function getCandyMachineId(): string | null {
  const id = (process.env.NEXT_PUBLIC_CANDY_MACHINE_ID || '').trim();
  if (!id) return null;
  return id;
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

  // UMI base instance (identity is injected later inside Mint() once wallet is connected)
  const [umi] = useState<Umi>(() =>
    createUmi(endpoint).use(mplTokenMetadata()).use(mplCandyMachine())
  );

  // State
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

  // Load CM + Guard + counts + cost
  const retrieveAvailability = async () => {
    try {
      setMintMsg(undefined);

      const cmIdStr = getCandyMachineId();
      if (!cmIdStr) {
        setMintMsg('No candy machine ID found. Set NEXT_PUBLIC_CANDY_MACHINE_ID in .env.local.');
        setMintDisabled(true);
        return;
      }

      // Validate public key format early (this prevents "Invalid public key" crashes)
      let cmPk;
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

      // Fetch guard (in CMv3: usually on mintAuthority)
      const cg = await safeFetchCandyGuard(umi, candyMachine.mintAuthority);
      if (cg) setGuard(cg);
      else setGuard(null);

      // Cost from solPayment guard (if present)
      const defaultGuards: DefaultGuardSet | undefined = cg?.guards;
      const solPaymentGuard: Option<SolPayment> | undefined = defaultGuards?.solPayment;

      if (solPaymentGuard) {
        const solPayment = unwrapSome(solPaymentGuard);
        const lamports: SolAmount = solPayment.lamports;
        const solCost = Number(lamports.basisPoints) / 1_000_000_000;
        setCostInSol(solCost);
      } else {
        setCostInSol(0);
      }

      setMintDisabled(!(remaining > 0));
    } catch (e: any) {
      console.error(e);
      setMintMsg(
        `Could not fetch candy machine. Check RPC and network. Details: ${e?.message || String(e)}`
      );
      setMintDisabled(true);
    }
  };

  useEffect(() => {
    retrieveAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintCreated]);

  // Inner component that binds wallet identity to umi
  const Mint = () => {
    const wallet = useWallet();

    // Inject wallet identity into umi when connected
    useEffect(() => {
      if (wallet?.connected) {
        umi.use(walletAdapterIdentity(wallet));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet?.connected]);

    // Check balance when wallet is connected and cost is known
    useEffect(() => {
      const run = async () => {
        if (!wallet.connected) return;
        if (costInSol <= 0) {
          // Free mint: allow if remaining > 0
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
        setMintMsg('Candy Machine not loaded. Refresh the page.');
        return;
      }

      setLoading(true);
      setMintMsg(undefined);

      try {
        // If a guard exists, we may need mintArgs
        const mintArgs: Partial<DefaultGuardSetMintArgs> = {};

        if (guard) {
          const defaultGuards: DefaultGuardSet | undefined = guard.guards;
          const solPaymentGuard: Option<SolPayment> | undefined = defaultGuards?.solPayment;

          if (solPaymentGuard) {
  const solPayment = unwrapSome(solPaymentGuard);
  if (solPayment != null) {
    const lamports = solPayment.lamports;
    const solCost = Number(lamports.basisPoints) / 1_000_000_000;
    setCostInSol(solCost);
  } else {
    // Als er geen solPayment guard actief is, toon bv 0 of laat het staan
    setCostInSol(0);
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
              candyGuard: guard?.publicKey, // ok if undefined (no guard)
              mintArgs,
              // Most CMv3 mints are NonFungible. If your CM is pNFT, you can switch.
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

          <h1>
            Mint UI (CMv3)
          </h1>

          <Image
            className={styles.logo}
            src="/preview.gif"
            alt="Preview of NFTs"
            width={300}
            height={300}
            priority
          />

          <div className={styles.countsContainer}>
            <div>Minted: {countMinted ?? '-'} / {countTotal ?? '-'}</div>
            <div>Remaining: {countRemaining ?? '-'}</div>
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
