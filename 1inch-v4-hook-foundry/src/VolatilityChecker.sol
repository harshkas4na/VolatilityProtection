// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// A minimal interface to read the fee from a Uniswap v4 pool
interface IUniswapV4Hook {
    function fees() external view returns (uint24);
}

/**
 * @title VolatilityChecker
 * @notice This is a 1inch LOP Predicate contract. Its only job is to check
 * if the fee on a given Uniswap v4 pool is above a certain threshold.
 */
contract VolatilityChecker {
    /**
     * @notice Checks if the Uniswap v4 pool's fee meets the volatility threshold.
     * @param hookAddress The address of the target Uniswap v4 pool.
     * @param feeThreshold The fee level that signifies high volatility (e.g., 5000 for 0.5%).
     * @return uint256 Returns 1 if currentFee >= feeThreshold, otherwise returns 0.
     */
    function checkVolatility(address hookAddress, uint24 feeThreshold) external view returns (uint256) {
        uint24 currentFee = IUniswapV4Hook(hookAddress).fees();

        if (currentFee >= feeThreshold) {
            return 1; // Condition met: Volatility is HIGH
        } else {
            return 0; // Condition not met: Volatility is LOW
        }
    }
}