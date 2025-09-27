// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../lib/reactive-lib/src/abstract-base/AbstractCallback.sol";

// Minimal interface for the 1inch LOP post-interaction callback
interface IPostInteraction {
    function postInteraction(
        bytes32 orderHash,
        address taker,
        uint256 makingAmount,
        uint256 takingAmount,
        uint256 remainingMakingAmount
    ) external;
}

/**
 * @title TraderHedgeLOP
 * @notice This contract enables a one-time hedge for a trader after a volatile swap.
 * It is controlled by a trusted Reactive Smart Contract (RSC).
 * 1. The RSC calls `enableHedgeForTrader` to "arm" the hedge for a specific trader.
 * 2. The trader's pre-signed limit order can then be filled, as the `isHedgeActive` predicate will return true.
 * 3. After the fill, the 1inch protocol calls `postInteraction` to "disarm" the hedge, preventing re-use.
 */
contract TraderHedgeLOP is IPostInteraction, AbstractCallback {
    // The address of the trader who is currently permitted to have their hedge order filled.
    address public activeHedger;

    // The address of the 1inch Limit Order Protocol contract.
    address public immutable limitOrderProtocolAddress;

    event HedgeEnabled(address indexed trader);
    event HedgeFilled(address indexed trader);

   
    modifier onlyLimitOrderProtocol() {
        require(msg.sender == limitOrderProtocolAddress, "Caller is not the 1inch LOP contract");
        _;
    }

    constructor(address _limitOrderProtocolAddress) {
        limitOrderProtocolAddress = _limitOrderProtocolAddress;
    }

    /**
     * @notice Called by the RSC to enable a hedge for a trader.
     * The first parameter is ignored as per your RSC's design.
     * @param trader The address of the trader who performed the volatile swap.
     */
    function demoSetter(address, address trader) external onlyReactiveContract {
        activeHedger = trader;
        emit HedgeEnabled(trader);
    }

    /**
     * @notice The predicate function that the off-chain order will point to.
     * It checks if the hedge is armed for the trader who signed the order.
     * @param maker The address of the trader who signed the limit order.
     * @return uint256 Returns 1 if the hedge is active for the maker, otherwise 0.
     */
    function isHedgeActiveFor(address maker) external view returns (uint256) {
        if (activeHedger != address(0) && activeHedger == maker) {
            return 1; // Condition met: Hedge is ARMED for this trader.
        } else {
            return 0; // Condition not met: Hedge is DISARMED or for someone else.
        }
    }

    /**
     * @notice The callback function called by the 1inch LOP contract AFTER a successful fill.
     * This function resets the state to prevent the hedge from being used again.
     */
    function postInteraction(
        bytes32 /*orderHash*/,
        address /*taker*/,
        uint256 /*makingAmount*/,
        uint256 /*takingAmount*/,
        uint256 remainingMakingAmount
    ) external override onlyLimitOrderProtocol {
        // If the order is fully filled, disarm the hedge.
        if (remainingMakingAmount == 0) {
            emit HedgeFilled(activeHedger);
            activeHedger = address(0);
        }
    }
}