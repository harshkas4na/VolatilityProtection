// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager, SwapParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import "../lib/reactive-lib/src/abstract-base/AbstractCallback.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";


contract DynamicFeeHook is BaseHook, AbstractCallback{
    using PoolIdLibrary for PoolKey;

    event VolatileTrader(address user);

    constructor(IPoolManager _poolManager) BaseHook(_poolManager)AbstractCallback(0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA) payable {}

    bool public flag=false;
    uint24 public fees= 3000;

    function updateFlag(address /*spender*/) external authorizedSenderOnly {
        flag=!flag;
        fees=(flag)?10000:3000;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,    
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // -----------------------------------------------
    // NOTE: see IHooks.sol for function documentation
    // -----------------------------------------------

    function _beforeSwap(address, PoolKey calldata /*key*/, SwapParams calldata, bytes calldata)
        internal
        override
        view
        returns (bytes4, BeforeSwapDelta, uint24)
    {
            return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, (fees | LPFeeLibrary.OVERRIDE_FEE_FLAG));
    }

    function _afterSwap(address, PoolKey calldata /*key*/, SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        emit VolatileTrader(tx.origin);
        return (BaseHook.afterSwap.selector, 0);
    }

    function withdraw() external {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        require(msg.sender == 0x49aBE186a9B24F73E34cCAe3D179299440c352aC, "buzzOff");
        
        (bool success, ) = payable(msg.sender).call{value: balance}("");
        require(success, "Withdrawal failed");
    } 
}