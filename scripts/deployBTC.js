// deploy.js
// "Deployment script for mainnet contracts: Hedge Token, Bitorio Token, MerkleProofVerify, HedgeContract, PoolManager, AffiliationHedge"
// "Update the variables below with the appropriate mainnet addresses and values."

const { ethers, upgrades } = require("hardhat");

async function main() {
  // "Default admin, pauser, upgrader addresses. Update as needed for mainnet deployment."
  const [deployer] = await ethers.getSigners();
  const defaultAdmin = deployer.address; // Replace with main deployer wallet address

  // "HedgexDao initial supply in wei. Update this value as required for mainnet."
  const initialSupplyHedgex = ethers.utils.parseUnits("", 18);
  const MaxSupplyHedgex = ethers.utils.parseUnits("", 18);
  const floorSupplyHedgex = ethers.utils.parseUnits("", 18);

  // 1. Deploy Hedgex Dao Token
  // "Deploy HedgexDao contract. This token will be used for Hedgex Dao."
  const HedgexToken = await ethers.getContractFactory("HedgexDao");
  const hedgexToken = await HedgexToken.deploy("HedgexDao", "HGXD", initialSupplyHedgex, MaxSupplyHedgex, floorSupplyHedgex);
  console.log("HedgexDao deployed at:", hedgexToken.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });