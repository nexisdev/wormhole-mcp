# Wormhole MCP – Multichain Token Transfer MCP via Wormhole SDK

Wormhole MCP is a TypeScript/Node.js Model Context Protocol (MCP) server that enables automatic transfer of tokens across multiple blockchains using the [Wormhole SDK](https://wormhole.com/). It provides utilities for managing cross-chain transfers, wallet operations, and environment-based configuration for secure key management.

This MCP abstracts the complexity of cross-chain interactions by providing a structured, context-aware layer for initiating and managing token transfers. It is designed for easy integration with LLM agents, bots, or applications that require secure and reliable access to decentralized cross-chain liquidity.

## Features

- 🌐 **Cross-Chain Swaps:** Move native tokens between EVM and non-EVM chains using Wormhole’s trusted bridging layer.
- 🤖 **Agent-Friendly Protocol:** Encodes user intent and target chain data into a standardized, model-readable format.
- 🔐 **Secure & Verifiable Transfers:** Ensures swaps are signed and verified with full user approval.
- ⚙️ **Modular Integration:** Easily plugs into existing model or bot frameworks alongside other MCP components.
- 📡 **Chain-Agnostic Design:** Built to support a growing number of chains supported by Wormhole NTT.
- 💼 **Secure Transaction Handling**: Signs and sends transactions securely, using environment-based key management.

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher recommended)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
- [Claude for Deskop](https://claude.ai/download)

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/collinsezedike/wormhole-mcp
   cd wormhole-mcp
   ```

2. **Install dependencies:**

   ```bash
   npm install
   # or
   yarn install
   ```

3. **Build the project:**

   ```bash
   npm run build
   # or
   yarn run build
   ```

4. **Configure the MCP for Claude for Desktop:**  
    Add the MCP configuration to `C:\Users\{User}\AppData\Roaming\Claude\claude_desktop_config.json`

     ```json
    "wormhole-mcp": {
        "command": "node",
        "args": [
            "<PROJECT_ABSOLUTE_FILEPATH>\\build\\index.js"
        ],
        "env": {
            "ALCHEMY_API_KEY": "<alchemy account api key>",
            "ALCHEMY_ACCESS_KEY": "<account kit server signer access key>",
            "ALCHEMY_ACCOUNT_ID": "<optional account id if reusing access key>"
        }
    }
     ```

    [Follow this guide](https://modelcontextprotocol.io/quickstart/server#testing-your-server-with-claude-for-desktop-2)

5. **Run the application:**
    Head to open Claude for Desktop and verify that the Wormhole MCP tools has been added. Try asking the Chatbot for the to bridge from Sepolia to Avalanche.

    **NOTE:** Ensure you have testnet USDC in your wallet. You can get some testnet USDC from the [Circle Faucet](https://faucet.circle.com/).

### Account Kit Configuration

The MCP no longer relies on raw private keys. Instead it uses an [Alchemy Account Kit server signer](https://accountkit.alchemy.com/docs) to authorize transfers. Before running the server:

- Generate an access key with `generateAccessKey` or through the Account Kit dashboard, and store it in `ALCHEMY_ACCESS_KEY`.
- Provide your Alchemy API key via `ALCHEMY_API_KEY`. If you manage multiple smart wallet orgs with the same access key, also set `ALCHEMY_ACCOUNT_ID`.
- Optionally set `ALCHEMY_CHAIN_AGNOSTIC_URL` to point at a custom Turnkey endpoint.
- If you intend to use sponsored Solana transactions, supply your paymaster policy as `ALCHEMY_SOLANA_POLICY_ID`.

During startup the server signs and verifies a probe message to ensure the Account Kit smart wallet can produce valid signatures before executing any transfers.

## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.
