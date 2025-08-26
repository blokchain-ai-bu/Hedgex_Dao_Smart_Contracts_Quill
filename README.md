# 🚀 Hedgex Smart Contracts

This repository demonstrates a basic Hardhat use case for smart contract development. It includes:
- ✅ A sample Solidity contract
- ✅ Unit tests for the contract
- ✅ Deployment scripts

Whether you're a beginner or an experienced developer, this project will help you quickly set up, compile, test, and deploy smart contracts on Ethereum-compatible blockchains.

# 📦 Prerequisites
Make sure you have the following installed before starting:
- Node.js (v16 or later recommended)
- npm or yarn
- Hardhat

Check if they are installed:
- node -v
- npm -v
- npx hardhat --version

# ⚡ Installation
Clone this repository and install dependencies:
# Clone the repo
- git clone https://github.com/yourusername/Hedgex_Smart_Contracts.git

# Enter project directory
- cd Hedgex_Smart_Contracts

# Install dependencies
- npm install

If you prefer Yarn:
- yarn install

# 🔨 Available Commands
Here are some useful Hardhat commands for this project:
# 📖 Help
- npx hardhat help

# 🛠 Compile Contracts
- npx hardhat compile

# ✅ Run Tests
- npx hardhat test

# 🚀 Deploy Contracts
To deploy the BTC contract example:
- npx hardhat run scripts/deployBTC.js --network localhost

You can also replace --network localhost with any configured network (e.g., sepolia, polygon, etc.) in your hardhat.config.js.

⚙️ Project Structure
Hedgex_Smart_Contracts/
│── contracts/           # Solidity smart contracts
│── scripts/             # Deployment scripts
│── test/                # Unit tests
│── hardhat.config.js    # Hardhat configuration file
│── package.json         # Dependencies and scripts

# 🧪 Testing
Run unit tests with:
- npx hardhat test
