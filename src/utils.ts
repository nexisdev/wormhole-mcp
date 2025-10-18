import {
	Chain,
	ChainAddress,
	ChainContext,
	Network,
	Signer,
	Wormhole,
} from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/evm";
import solana from "@wormhole-foundation/sdk/solana";
import dotenv from "dotenv";
import {
	AlchemyServerSigner,
	createServerSigner,
	SolanaSigner as AlchemySolanaSigner,
} from "@account-kit/signer";
import { verifyMessage } from "viem";
import {
	JsonRpcProvider,
	Transaction,
	Signature,
	hexlify,
} from "ethers";
import {
	Connection,
	PublicKey,
	SendOptions,
	Signer as SolanaKeySigner,
	Transaction as SolanaTransaction,
	TransactionExpiredBlockheightExceededError,
	VersionedTransaction,
} from "@solana/web3.js";

dotenv.config();

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const ALCHEMY_ACCESS_KEY = process.env.ALCHEMY_ACCESS_KEY;
const ALCHEMY_ACCOUNT_ID = process.env.ALCHEMY_ACCOUNT_ID;
const ALCHEMY_CHAIN_AGNOSTIC_URL = process.env.ALCHEMY_CHAIN_AGNOSTIC_URL;
const SOLANA_SPONSOR_POLICY_ID = process.env.ALCHEMY_SOLANA_POLICY_ID;

if (!ALCHEMY_API_KEY || !ALCHEMY_ACCESS_KEY) {
	throw new Error(
		"ALCHEMY_API_KEY and ALCHEMY_ACCESS_KEY must be defined in environment variables"
	);
}

type VerifiedSigner = {
	serverSigner: AlchemyServerSigner;
	ethereumAddress: string;
};

const verifiedSignerPromise: Promise<VerifiedSigner> = (async () => {
	const serverSigner = await createServerSigner({
		auth: { accessKey: ALCHEMY_ACCESS_KEY, accountId: ALCHEMY_ACCOUNT_ID },
		connection: {
			apiKey: ALCHEMY_API_KEY,
			...(ALCHEMY_CHAIN_AGNOSTIC_URL
				? { chainAgnosticUrl: ALCHEMY_CHAIN_AGNOSTIC_URL }
				: {}),
		},
	});

	// Verify that the signer can produce a valid EVM signature.
	const message = `wormhole-mcp signer verification ${Date.now()}`;
	const signature = await serverSigner.signMessage(message);
	const ethereumAddress = await serverSigner.getAddress();
	const verified = await verifyMessage({
		address: ethereumAddress as `0x${string}`,
		message,
		signature: signature as `0x${string}`,
	});

	if (!verified) {
		throw new Error(
			"Failed to verify Account Kit server signer signature authenticity"
		);
	}

	return { serverSigner, ethereumAddress };
})();

class AccountKitEvmSigner<N extends Network, C extends Chain> {
	constructor(
		private readonly chainContext: ChainContext<N, C>,
		private readonly provider: JsonRpcProvider,
		private readonly serverSigner: AlchemyServerSigner,
		private readonly addressValue: string
	) {}

	chain(): C {
		return this.chainContext.chain;
	}

	address(): string {
		return this.addressValue;
	}

	unwrap() {
		return {
			type: "alchemy-account-kit",
			address: this.addressValue,
		};
	}

	async sign(tx: Array<{ transaction: any; description: string }>) {
		const signed: string[] = [];
		const network = await this.provider.getNetwork();
		const chainId = Number(network.chainId);
		let nonce = await this.provider.getTransactionCount(this.addressValue);

		let gasPrice = 100_000_000_000n;
		let maxFeePerGas = 1_500_000_000n;
		let maxPriorityFeePerGas = 100_000_000n;

		const feeData = await this.provider.getFeeData();

		if (feeData.gasPrice != null) {
			gasPrice = feeData.gasPrice;
		}
		if (feeData.maxFeePerGas != null) {
			maxFeePerGas = feeData.maxFeePerGas;
		}
		if (feeData.maxPriorityFeePerGas != null) {
			maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
		}

		for (const txn of tx) {
			const base = { ...txn.transaction };
			const resolvedNonce =
				base.nonce !== undefined ? Number(base.nonce) : nonce++;
			if (base.nonce !== undefined) {
				nonce = Number(base.nonce) + 1;
			}

			const resolved: Record<string, unknown> = {
				...base,
				nonce: resolvedNonce,
				from: this.addressValue,
				chainId: base.chainId ?? chainId,
			};

			if (resolved.gasLimit == null) {
				resolved.gasLimit = 500_000n;
			} else {
				resolved.gasLimit = BigInt(resolved.gasLimit as bigint | number | string);
			}

			if (resolved.gasPrice != null) {
				resolved.gasPrice = BigInt(
					resolved.gasPrice as bigint | number | string
				);
				delete resolved.maxFeePerGas;
				delete resolved.maxPriorityFeePerGas;
			} else {
				resolved.maxFeePerGas = BigInt(
					(resolved.maxFeePerGas as bigint | number | string | undefined) ??
						maxFeePerGas
				);
				resolved.maxPriorityFeePerGas = BigInt(
					(
						resolved.maxPriorityFeePerGas as
							| bigint
							| number
							| string
							| undefined
					) ?? maxPriorityFeePerGas
				);
			}

			const transaction = Transaction.from(resolved);
			const digest = transaction.unsignedHash;
			const rawSignature = await (this.serverSigner as any).inner.signRawMessage(
				digest
			);
			const signatureStruct = Signature.from(rawSignature);
			transaction.signature = signatureStruct;
			signed.push(hexlify(transaction.serialized));
		}

		return signed;
	}
}

class AccountKitSolanaSendSigner<N extends Network, C extends Chain> {
	private readonly commitment: "confirmed";
	private readonly maxResubmits = 5;
	private readonly sendOpts: SendOptions;

	constructor(
		private readonly chainContext: ChainContext<N, C>,
		private readonly connection: Connection,
		private readonly smartSigner: AlchemySolanaSigner,
		private readonly debug = false
	) {
		this.commitment = "confirmed";
		this.sendOpts = {
			preflightCommitment: this.commitment,
		};
	}

	chain(): C {
		return this.chainContext.chain;
	}

	address(): string {
		return this.smartSigner.address;
	}

	unwrap() {
		return {
			type: "alchemy-account-kit-solana",
			address: this.smartSigner.address,
		};
	}

	async sign(tx: Array<{ transaction: any; description: string }>) {
		const { blockhash, lastValidBlockHeight } =
			await this.connection.getLatestBlockhash(this.commitment);
		const signed: Uint8Array[] = [];

		for (const txn of tx) {
			const { transaction, signers: extraSigners = [] } = txn.transaction;
			const prepared = await this.prepareTransaction(
				this.cloneTransaction(transaction),
				extraSigners,
				blockhash,
				lastValidBlockHeight
			);
			if (prepared instanceof VersionedTransaction) {
				signed.push(prepared.serialize());
			} else {
				signed.push(prepared.serialize());
			}
		}

		return signed;
	}

	async signAndSend(tx: Array<{ transaction: any; description: string }>) {
		let { blockhash, lastValidBlockHeight } =
			await this.connection.getLatestBlockhash(this.commitment);

		const txids: string[] = [];

		for (const txn of tx) {
			const { description, transaction, signers: extraSigners = [] } =
				txn.transaction;
			for (let attempt = 0; attempt < this.maxResubmits; attempt++) {
				try {
					const prepared = await this.prepareTransaction(
						this.cloneTransaction(transaction),
						extraSigners,
						blockhash,
						lastValidBlockHeight
					);
					const raw =
						prepared instanceof VersionedTransaction
							? prepared.serialize()
							: prepared.serialize();
					const signature = await this.connection.sendRawTransaction(
						raw,
						this.sendOpts
					);
					txids.push(signature);
					break;
				} catch (error) {
					if (
						attempt === this.maxResubmits - 1 ||
						!this.isRetryable(error as Error)
					) {
						throw error;
					}

					if (this.debug) {
						console.warn(
							`Retrying Solana transaction "${description}" after error`,
							error
						);
					}

					const latest = await this.connection.getLatestBlockhash(
						this.commitment
					);
					blockhash = latest.blockhash;
					lastValidBlockHeight = latest.lastValidBlockHeight;
				}
			}
		}

		await Promise.all(
			txids.map((signature) =>
				this.connection.confirmTransaction(
					{
						signature,
						blockhash,
						lastValidBlockHeight,
					},
					this.commitment
				)
			)
		);

		return txids;
	}

	private async prepareTransaction(
		transaction: SolanaTransaction | VersionedTransaction,
		extraSigners: SolanaKeySigner[],
		blockhash: string,
		lastValidBlockHeight: number
	) {
		if (transaction instanceof VersionedTransaction) {
			transaction.message.recentBlockhash = blockhash;
			await this.smartSigner.addSignature(transaction);
			if (extraSigners.length > 0) {
				transaction.sign(
					extraSigners as Parameters<VersionedTransaction["sign"]>[0]
				);
			}
		} else {
			transaction.recentBlockhash = blockhash;
			transaction.lastValidBlockHeight = lastValidBlockHeight;
			transaction.feePayer = new PublicKey(this.smartSigner.address);
			await this.smartSigner.addSignature(transaction);
			if (extraSigners.length > 0) {
				transaction.partialSign(...extraSigners);
			}
		}

		return transaction;
	}

	private cloneTransaction(
		transaction: SolanaTransaction | VersionedTransaction
	) {
		if (transaction instanceof VersionedTransaction) {
			return VersionedTransaction.deserialize(transaction.serialize());
		}

		return SolanaTransaction.from(
			transaction.serialize({
				requireAllSignatures: false,
				verifySignatures: false,
			})
		);
	}

	private isRetryable(error: Error) {
		if (error instanceof TransactionExpiredBlockheightExceededError) {
			return true;
		}
		const message = error.message ?? "";
		return (
			message.includes("Blockhash not found") ||
			message.includes("Not enough bytes")
		);
	}
}

export const getSigner = async <N extends Network, C extends Chain>(
	chain: ChainContext<N, C>
): Promise<{
	chain: ChainContext<N, C>;
	signer: Signer<N, C>;
	address: ChainAddress<C>;
}> => {
	const { serverSigner, ethereumAddress } = await verifiedSignerPromise;
	const platform = chain.platform.utils()._platform;

	switch (platform) {
		case "Evm": {
			const rpc = (await chain.getRpc()) as JsonRpcProvider;
			const signer = new AccountKitEvmSigner(chain, rpc, serverSigner, ethereumAddress);
			return {
				chain,
				signer: signer as Signer<N, C>,
				address: Wormhole.chainAddress(chain.chain, signer.address()),
			};
		}
		case "Solana": {
			const rpc = (await chain.getRpc()) as Connection;
			const solanaSigner = serverSigner.toSolanaSigner();
			if (SOLANA_SPONSOR_POLICY_ID) {
				console.warn(
					"ALCHEMY_SOLANA_POLICY_ID is defined but sponsorship must be applied within transaction construction."
				);
			}
			const signer = new AccountKitSolanaSendSigner(chain, rpc, solanaSigner);
			return {
				chain,
				signer: signer as Signer<N, C>,
				address: Wormhole.chainAddress(chain.chain, signer.address()),
			};
		}
		default:
			throw new Error(`Unsupported platform: ${platform}`);
	}
};
