// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MwaliToken} from "./MwaliToken.sol";
import {BurnLotto} from "./BurnLotto.sol";
import {MwaliGauge, IMintableMwali} from "./MwaliGauge.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title KulaLottoWiring — deploys the whole loop and leaves nobody holding it
/// @notice One constructor deploys MWALI and BurnLotto, grants the gauge the right to mint MWALI,
///         and then RENOUNCES its own admin. When this transaction ends, no account — not the
///         operator, not this contract, nobody — holds admin over MWALI, and BurnLotto has no roles
///         to hold in the first place.
///
///         The point is that "no account holds the funds" has to be true at the end of DEPLOYMENT,
///         not something an operator promises to do later. A setup that leaves a human holding
///         admin "for now" is a setup where a human holds admin.
contract KulaLottoWiring {
    MwaliToken public immutable mwali;
    MwaliGauge public immutable gauge;
    BurnLotto public immutable lotto;

    event Wired(address mwali, address lotto, address gauge);

    /// @param lpToken      the KULA/WPRANA LP staked in the gauge
    /// @param ratePerSecond first-year MWALI per second across all stakers (decays 10%/yr)
    /// @param mwaliCap      hard ceiling on MWALI ever minted
    /// @param kula         the prize token
    /// @param veKula       read for the ticket boost (may be the zero address to disable it)
    /// @param perTicket    MWALI burned per base ticket
    /// @param maxBoostBps  30000 = 3x cap
    /// @param boostK       veKULA half-way point
    constructor(
        IERC20 lpToken, uint256 ratePerSecond, uint256 mwaliCap,
        IERC20 kula, IERC20 veKula, uint256 perTicket, uint256 maxBoostBps, uint256 boostK
    ) {
        require(address(lpToken) != address(0), "lp=0");

        // admin only for the length of this constructor, and renounced before it ends
        MwaliToken m = new MwaliToken(address(this), mwaliCap);
        MwaliGauge g = new MwaliGauge(lpToken, IMintableMwali(address(m)), ratePerSecond);
        m.grantRole(m.MINTER_ROLE(), address(g));
        m.renounceRole(m.DEFAULT_ADMIN_ROLE(), address(this));

        BurnLotto l = new BurnLotto(m, kula, veKula, perTicket, maxBoostBps, boostK);

        mwali = m;
        gauge = g;
        lotto = l;
        emit Wired(address(m), address(l), address(g));
    }

    /// @notice True when nothing and nobody can mint MWALI except the gauge, and no admin exists.
    function isSealed() external view returns (bool) {
        return mwali.hasRole(mwali.MINTER_ROLE(), address(gauge))
            && !mwali.hasRole(mwali.DEFAULT_ADMIN_ROLE(), address(this))
            && mwali.getRoleMemberCount(mwali.DEFAULT_ADMIN_ROLE()) == 0;
    }
}
