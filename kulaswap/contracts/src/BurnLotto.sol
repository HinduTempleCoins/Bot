// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @title BurnLotto — burn MWALI for KULA lotto tickets
/// @notice You BURN **MWALI** to enter; the prize is **KULA**. Two different tokens on purpose, and
///         that is the operator's design, not an invention here: "Burn [MWALI] for KULA Lotto" and
///         "veLocking KULA can Boost the [MWALI] Lotto Burn" (2026-06-17). MWALI is the LP-reward token
///         — the thing you EARN by providing liquidity — so the lottery is where liquidity rewards go
///         to die, which is what makes it a sink for MWALI rather than a carousel for KULA.
///
///         Burning the SAME token you pay out would be close to pointless: it would destroy and
///         re-issue the same supply. Burning the reward token while paying from a separate pot is
///         what actually removes supply.
///
///         This is deliberately NOT the no-loss / PoolTogether model, where a deposit is held, the
///         yield is raffled, and the principal is handed back. That design returns every token it
///         touches, so it removes nothing from supply — it is a faucet with extra steps, and pairing
///         it against an emission as a "sink" is simply wrong arithmetic.
///
///         NOBODY CUSTODIES ANYTHING. There is no admin, no owner, no roles and no privileged key.
///         Funding the pot, opening a draw and revealing it are all permissionless. The contract
///         holds the pot itself and pays it out itself; no account is ever trusted to be holding the
///         money, which is the only version of this that a stranger should be willing to burn into.
///
///         Flow:
///           1. `enter(n)` pulls n * mwaliPerTicket from the player and BURNS it. They hold n tickets.
///              The tokens are gone. There is no withdraw function in this contract by design.
///           2. The prize pot is funded separately via `fundPrize` (emission slice, fees, sponsor).
///           3. `commitDraw` / `revealDraw` pick a winner weighted by ticket count and pay the pot.
///
///         NET EFFECT per round: MWALI supply falls by everything burned; KULA moves from the pot to
///         one winner and is not minted here. So the lottery is a pure MWALI sink and a KULA
///         redistribution — which is the right shape, because MWALI is the token being emitted to
///         liquidity providers and therefore the one that needs somewhere to go.
contract BurnLotto {
    using SafeERC20 for IERC20;

    /// @notice MWALI — burned to enter. Destroyed, never returned.
    ERC20Burnable public immutable mwali;
    /// @notice KULA — what the pot is paid in.
    IERC20 public immutable kula;
    /// @notice veKULA — read only, for the ticket boost.
    IERC20 public immutable veKula;

    /// @notice MWALI burned per base ticket.
    uint256 public immutable mwaliPerTicket;

    /// @notice veKULA boost curve (operator 2026-06-17, TerraCore/SCRAP style, diminishing returns):
    ///         boost = 1 + (maxBoost-1) * veKula/(veKula + k).  veKula=0 -> 1x, =k -> midpoint,
    ///         ->inf -> maxBoost. Held in basis points so the curve is exact in integer maths.
    uint256 public immutable maxBoostBps;   // 30000 = 3x
    uint256 public immutable boostK;        // the half-way point, in veKULA base units

    /// @notice Reveal is legal from commitBlock + REVEAL_DELAY and dies after WINDOW blocks,
    ///         because blockhash() only reaches back 256 blocks.
    uint256 public constant REVEAL_DELAY = 2;
    uint256 public constant WINDOW = 256;

    uint256 public prizePool;
    uint256 public totalBurned;
    uint256 public totalPrizesPaid;
    uint256 public roundId;

    /// @notice Tickets held in the CURRENT round. Cleared by a successful reveal.
    mapping(address => uint256) public ticketsOf;
    address[] private _players;
    uint256 public ticketCount;

    struct Commit { uint256 block_; bytes32 saltHash; }
    Commit public drawCommit;

    event Entered(address indexed player, uint256 tickets, uint256 mwaliBurned);
    event PrizeFunded(address indexed from, uint256 amount);
    event DrawCommitted(uint256 indexed round, uint256 commitBlock);
    event Drawn(uint256 indexed round, address indexed winner, uint256 prize, uint256 burnedThisRound);
    event DrawCleared(uint256 indexed round);

    error NothingToDraw();
    error DrawOpen();
    error NoDraw();
    error TooEarly();
    error Expired();
    error NotExpired();
    error BadSalt();

    constructor(
        ERC20Burnable mwali_, IERC20 kula_, IERC20 veKula_,
        uint256 mwaliPerTicket_, uint256 maxBoostBps_, uint256 boostK_
    ) {
        require(address(mwali_) != address(0) && address(kula_) != address(0), "bad token");
        require(mwaliPerTicket_ > 0, "bad args");
        require(maxBoostBps_ >= 10000 && boostK_ > 0, "bad boost");
        mwali = mwali_;
        kula = kula_;
        veKula = veKula_;
        mwaliPerTicket = mwaliPerTicket_;
        maxBoostBps = maxBoostBps_;
        boostK = boostK_;
    }

    /// @notice Tickets granted for burning `n` base tickets' worth of MWALI, after the veKULA boost.
    ///         MWALI is charged on the BASE tickets only — the boost is free extra weight, which is the
    ///         entire incentive to lock KULA.
    function boostBpsOf(address who) public view returns (uint256) {
        if (address(veKula) == address(0)) return 10000;
        uint256 v = veKula.balanceOf(who);
        if (v == 0) return 10000;
        return 10000 + ((maxBoostBps - 10000) * v) / (v + boostK);
    }

    function ticketsFor(address who, uint256 baseTickets) public view returns (uint256) {
        return (baseTickets * boostBpsOf(who)) / 10000;
    }

    /// @notice Burn `n * mwaliPerTicket` MWALI for `n` base tickets, boosted by your veKULA.
    ///         THE MWALI IS DESTROYED. There is no withdraw.
    /// @dev Entries are refused while a draw is committed, so nobody can buy in after the
    ///      randomness is already bound to a block.
    function enter(uint256 n) external {
        require(n > 0, "n=0");
        if (drawCommit.block_ != 0) revert DrawOpen();
        uint256 cost = n * mwaliPerTicket;
        IERC20(address(mwali)).safeTransferFrom(msg.sender, address(this), cost);
        mwali.burn(cost);                        // THE SINK — MWALI leaves supply here
        uint256 granted = ticketsFor(msg.sender, n);
        if (ticketsOf[msg.sender] == 0) _players.push(msg.sender);
        ticketsOf[msg.sender] += granted;
        ticketCount += granted;
        totalBurned += cost;
        emit Entered(msg.sender, granted, cost);
    }

    /// @notice Add KULA to the prize pot. PERMISSIONLESS — anyone, or any contract (the emission
    ///         scheduler, a fee splitter, a sponsor), can push KULA in. There is no funder to trust
    ///         and no account that has to be holding the pot beforehand.
    function fundPrize(uint256 amount) external {
        require(amount > 0, "amount=0");
        kula.safeTransferFrom(msg.sender, address(this), amount);
        prizePool += amount;
        emit PrizeFunded(msg.sender, amount);
    }

    function playerCount() external view returns (uint256) { return _players.length; }
    function playerAt(uint256 i) external view returns (address) { return _players[i]; }

    /// @notice PERMISSIONLESS. Anyone may open a draw by committing the hash of a secret salt —
    ///         and whoever commits is the only one who can reveal it, because only they know the
    ///         salt. A griefer who commits and never reveals stalls the round for at most WINDOW
    ///         blocks, after which clearExpiredDraw() (also permissionless) resets it with the
    ///         tickets and the pot untouched. No key, no role, no operator.
    function commitDraw(bytes32 saltHash) external {
        if (drawCommit.block_ != 0) revert DrawOpen();
        if (ticketCount == 0 || prizePool == 0) revert NothingToDraw();
        drawCommit = Commit(block.number, saltHash);
        emit DrawCommitted(roundId, block.number);
    }

    function saltHashOf(bytes32 salt) public pure returns (bytes32) { return keccak256(abi.encodePacked(salt)); }

    /// @notice PERMISSIONLESS. The salt must match the commit, so in practice only the committer
    ///         can call this.
    function revealDraw(bytes32 salt) external returns (address winner) {
        Commit memory c = drawCommit;
        if (c.block_ == 0) revert NoDraw();
        if (block.number < c.block_ + REVEAL_DELAY) revert TooEarly();
        if (block.number > c.block_ + WINDOW) revert Expired();
        if (saltHashOf(salt) != c.saltHash) revert BadSalt();

        uint256 pick = uint256(keccak256(abi.encodePacked(salt, blockhash(c.block_ + REVEAL_DELAY)))) % ticketCount;
        uint256 acc;
        uint256 n = _players.length;
        for (uint256 i = 0; i < n; ++i) {
            acc += ticketsOf[_players[i]];
            if (pick < acc) { winner = _players[i]; break; }
        }

        uint256 prize = prizePool;
        uint256 burnedThisRound = totalBurned;
        prizePool = 0;
        delete drawCommit;
        for (uint256 i = 0; i < n; ++i) delete ticketsOf[_players[i]];
        delete _players;
        ticketCount = 0;
        totalPrizesPaid += prize;
        emit Drawn(roundId, winner, prize, burnedThisRound);
        unchecked { ++roundId; }
        kula.safeTransfer(winner, prize);
    }

    /// @notice A commit older than the blockhash window can never be revealed. Clear it and re-arm.
    ///         Tickets and the pot survive untouched — nobody loses a round to an expired commit.
    function clearExpiredDraw() external {
        if (drawCommit.block_ == 0) revert NoDraw();
        if (block.number <= drawCommit.block_ + WINDOW) revert NotExpired();
        delete drawCommit;
        emit DrawCleared(roundId);
    }
}
