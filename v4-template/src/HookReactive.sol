// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {IReactive} from "../lib/reactive-lib/src/interfaces/IReactive.sol";
import {AbstractReactive} from "../lib/reactive-lib/src/abstract-base/AbstractReactive.sol";

contract HookReactive is IReactive, AbstractReactive {


    address private hookContract;
    address private eventContract;

    
    uint256 private constant EVENT_TOPIC_0 = 0x9958611eae85c0ec2dfb00681b6383009c734fe02913099b58e5076c7a8cd950;

    uint64 private constant CALLBACK_GAS_LIMIT = 4000000;

    constructor(
        address hookContract_,
        address eventContract_
    ) payable {
        hookContract = hookContract_;
        eventContract = eventContract_;
        
        if (!vm) {
            // Subscribe to event contract
            service.subscribe(
                11155111,
                eventContract,
                EVENT_TOPIC_0,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE
            );
        }
    }

    function react(LogRecord calldata log) external vmOnly {
        if (log.topic_0 == EVENT_TOPIC_0) {
            bytes memory payload = abi.encodeWithSignature(
            "updateFlag(address)",
            address(0)
            );
            // Emit callback to Sepolia chain
            emit Callback(11155111, hookContract, CALLBACK_GAS_LIMIT, payload);
        }
    }

}