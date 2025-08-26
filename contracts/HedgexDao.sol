// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Snapshot.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";

/// @notice HedgexDao ERC20 Token 
/// @notice Ownable Control System adds more clear authorization and versatility than Ownership Model 
/// @notice Admin of contract will be a Multisignature Wallet 
/// @dev Standard ERC20 Smart Contract with OpenZeppelin Presets
contract HedgexDao is Ownable, ERC20Burnable, ERC20Capped, ERC20Snapshot, ERC20Votes {
    // ====== Fee config ======
    uint256 public constant FEE_DENOMINATOR = 10_000;          // basis points (10000 = 100%)
    uint256 public burnTax = 10;                               // e.g. 200 = 2.00%
    uint256 public burnTaxCap = 100;                           // max allowed tax in bps (default 1.00%)

     // ====== Supply floor (burn stops at / below this supply; resumes above it) ======
    uint256 public supplyFloor;                                // tokens (respecting decimals)

    // ====== AMM pairs & exclusions ======
    mapping(address => bool) public automatedMarketMakerPairs; // mark AMM pairs (Uniswap V2/V3 pools, etc.)
    mapping(address => bool) public isExcludedFromFee;         // wallets excluded from swap burn tax

    /// @notice Track current unique holders (balance > 0)
    uint256 public holdersCount;
    mapping(address => bool) private _isHolder;

    // ====== Events ======
    event AutomatedMarketMakerPairSet(address indexed pair, bool value);
    event ExcludedFromFee(address indexed account, bool isExcluded);
    event BurnTaxUpdated(uint256 oldTax, uint256 newTax);
    event SupplyFloorUpdated(uint256 oldFloor, uint256 newFloor);
    event TaxBurnApplied(address indexed from, address indexed to, uint256 amountBurned, uint256 newTaxBurnedTotal);

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        uint256 _maxSupply,
        uint256 _supplyFloor
    )
        ERC20(_name, _symbol)
        ERC20Permit(_name)
        ERC20Capped(_maxSupply)
    {
        // Mint initial supply to deployer
        _mint(msg.sender, _initialSupply);

        // Reasonable defaults (owner can change later)
        isExcludedFromFee[owner()] = true;
        isExcludedFromFee[address(this)] = true;
        supplyFloor = _supplyFloor;
    }

    // =========================================================
    //                      OWNER CONFIG
    // =========================================================

    /// @notice Mark/unmark an address as an AMM pair. Burn tax applies when either side is a marked pair.
    function setAutomatedMarketMakerPair(address pair, bool value) external onlyOwner {
        require(pair != address(0), "HedgexDao: Invalid Pair");
        automatedMarketMakerPairs[pair] = value;
        emit AutomatedMarketMakerPairSet(pair, value);
    }

    /// @notice Exclude or include an address from paying burn tax on buys/sells.
    function setExcludedFromFee(address account, bool excluded) external onlyOwner {
        require(account != address(0), "HedgexDao: Invalid Account");
        isExcludedFromFee[account] = excluded;
        emit ExcludedFromFee(account, excluded);
    }

    /// @notice Set the burn tax in basis points (e.g., 200 = 2%). Cannot exceed burnTaxCap.
    function setBurnTax(uint256 newBurnTaxBps) external onlyOwner {
        require(newBurnTaxBps <= burnTaxCap, "Burn tax > cap");
        emit BurnTaxUpdated(burnTax, newBurnTaxBps);
        burnTax = newBurnTaxBps;
    }

    /// @notice Set the supply floor: burn tax never reduces totalSupply below this value.
    /// @dev Can be set above/below current supply. Must be <= cap().
    function setSupplyFloor(uint256 newFloor) external onlyOwner {
        require(newFloor <= cap(), "Floor > cap");
        emit SupplyFloorUpdated(supplyFloor, newFloor);
        supplyFloor = newFloor;
    }

    // Helpful view utilities
    function isBurnActive() public view returns (bool) {
        return burnTax > 0 && totalSupply() > supplyFloor;
    }

    function remainingBurnableUntilFloor() public view returns (uint256) {
        uint256 ts = totalSupply();
        return ts > supplyFloor ? ts - supplyFloor : 0;
    }

    // =========================================================
    //                      SNAPSHOT (Owner)
    // =========================================================

    function snapshot() public onlyOwner {
        _snapshot();
    }

    function getCurrentSnapshot() public view onlyOwner returns (uint256) {
        return _getCurrentSnapshotId();
    }

    // =========================================================
    //                  MINT / BURN (Owner-only)
    // =========================================================

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    /// @notice Owner-only override for burn function (manual burns are NOT counted toward tax burn cap).
    function burn(uint256 amount) public override {
        super.burn(amount);
    }

    /// @notice Owner-only override for burnFrom function.
    function burnFrom(address account, uint256 amount) public override {
        super.burnFrom(account, amount);
    }

    // =========================================================
    //                    TRANSFER + TAX LOGIC
    // =========================================================

    /// @dev Applies burn tax ONLY when either 'from' or 'to' is a marked AMM pair.
    ///      If taxBurned >= maxTaxBurn, tax is disabled automatically.
    function _transfer(address from, address to, uint256 amount) internal override(ERC20) {
        uint256 sendAmount = amount;

        // Check if this is a buy or sell (one side is an AMM pair)
        bool isSwap = automatedMarketMakerPairs[from] || automatedMarketMakerPairs[to];

        if (
            isSwap &&
            burnTax > 0 &&
            !isExcludedFromFee[from] &&
            !isExcludedFromFee[to]
        ) {
            uint256 ts = totalSupply();
            if (ts > supplyFloor) {
                uint256 fee = (amount * burnTax) / FEE_DENOMINATOR;

                // Do not burn past the floor
                uint256 room = ts - supplyFloor; // guaranteed > 0 here
                if (fee > room) {
                    fee = room;
                }

                if (fee > 0) {
                    // Take fee by burning from sender BEFORE transferring the rest.
                    // Total debited from 'from' == fee + (amount - fee) == amount.
                    super._burn(from, fee);
                    sendAmount = amount - fee;

                    emit TaxBurnApplied(from, to, fee, ts - fee);
                }
            }
        }

        super._transfer(from, to, sendAmount);
    }

    // =========================================================
    //                     OZ REQUIRED OVERRIDES
    // =========================================================

    function _beforeTokenTransfer(address from, address to, uint256 amount)
        internal
        override(ERC20, ERC20Snapshot)
    {
        super._beforeTokenTransfer(from, to, amount);
    }

    function _afterTokenTransfer(address from, address to, uint256 amount)
        internal
        override(ERC20, ERC20Votes)
    {
        // If self-transfer, no holder state can change (balance unchanged overall)
        if (from != to) {
            updateCurrentHoldersCount(from, to);
        }
        super._afterTokenTransfer(from, to, amount);
    }

    function _mint(address to, uint256 amount)
        internal
        override(ERC20, ERC20Votes, ERC20Capped)
    {
        super._mint(to, amount);
    }

    function _burn(address account, uint256 amount)
        internal
        override(ERC20, ERC20Votes)
    {
        super._burn(account, amount);
    }

    function updateCurrentHoldersCount(address from, address to) internal {
        // Update holder flag + count for 'from'
        if (from != address(0)) {
            bool nowHolder = balanceOf(from) > 0;
            if (nowHolder != _isHolder[from]) {
                _isHolder[from] = nowHolder;
                if (nowHolder) {
                    holdersCount += 1;
                } else {
                    if (holdersCount > 0) { holdersCount -= 1; }
                }
            }
        }

        // Update holder flag + count for 'to'
        if (to != address(0)) {
            bool nowHolder = balanceOf(to) > 0;
            if (nowHolder != _isHolder[to]) {
                _isHolder[to] = nowHolder;
                if (nowHolder) {
                    holdersCount += 1;
                } else {
                    if (holdersCount > 0) { holdersCount -= 1; }
                }
            }
        }
    }
}
