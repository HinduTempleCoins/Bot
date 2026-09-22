// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MerkleDistributor — claimable ERC-20 airdrop with a Merkle allowlist
///
/// @notice ⚠️ TESTNET / LOCAL until the operator deploys. Recipients claim their own allocation and
///         pay their own gas — cheap on an L2 (~$0.005), the reason the plan (Part 3b) allows claims on
///         Base/Polygon where L1's ~$4.50 would suppress the claim rate. For very large lists this is
///         the "publish the root on-chain + full CSV to IPFS" mechanism; for smaller lists use
///         {BatchDisperse} instead (tokens simply appear, maximally visible).
///
///         Leaf scheme = OpenZeppelin StandardMerkleTree double-hash:
///           leaf = keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))))
///         The off-chain builder (scripts/lib/merkle.mjs) reproduces this exactly, and the offline
///         test proves a generated proof verifies here. Double-claim is blocked per index.
///
///         Extends the PRANA MerkleDistributor with an owner + a post-deadline `sweep`: unclaimed
///         airdrop float returns to the treasury instead of being stranded forever (the plan's
///         "sink-for-every-faucet" discipline, Risks). Fund by transferring the token to this
///         contract after deploy.
contract MerkleDistributor is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    bytes32 public immutable merkleRoot;
    /// @notice Unix time after which the owner may sweep unclaimed tokens. 0 == never (no sweep).
    uint256 public immutable claimDeadline;

    mapping(uint256 => bool) public claimed;

    event Claimed(uint256 indexed index, address indexed account, uint256 amount);
    event Swept(address indexed to, uint256 amount);

    error AlreadyClaimed();
    error InvalidProof();
    error SweepTooEarly();
    error NoDeadline();

    /// @param token_        the airdrop token.
    /// @param merkleRoot_   root of the recipient tree (from scripts/build-merkle.mjs).
    /// @param claimDeadline_ unix time after which unclaimed float can be swept (0 to disable sweep).
    /// @param owner_        treasury that funds the drop and can sweep the remainder.
    constructor(IERC20 token_, bytes32 merkleRoot_, uint256 claimDeadline_, address owner_)
        Ownable(owner_)
    {
        require(address(token_) != address(0), "token=0");
        token = token_;
        merkleRoot = merkleRoot_;
        claimDeadline = claimDeadline_;
    }

    /// @notice Claim `amount` for `account` at `index`, proving membership with `proof`.
    function claim(uint256 index, address account, uint256 amount, bytes32[] calldata proof) external {
        if (claimed[index]) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
        if (!MerkleProof.verify(proof, merkleRoot, leaf)) revert InvalidProof();
        claimed[index] = true;
        token.safeTransfer(account, amount);
        emit Claimed(index, account, amount);
    }

    /// @notice After the deadline, return unclaimed float to the treasury (the sink half of the drop).
    function sweep(address to) external onlyOwner {
        if (claimDeadline == 0) revert NoDeadline();
        if (block.timestamp < claimDeadline) revert SweepTooEarly();
        uint256 bal = token.balanceOf(address(this));
        token.safeTransfer(to, bal);
        emit Swept(to, bal);
    }
}
