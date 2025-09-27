// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import {IReactive} from "../lib/reactive-lib/src/interfaces/IReactive.sol";
import {AbstractReactive} from "../lib/reactive-lib/src/abstract-base/AbstractReactive.sol";

contract HookReactive is IReactive, AbstractReactive {


    address private hookContract;
    address private eventContract;
    address private lopContract;

    
    uint256 private constant EVENT_TOPIC_0 = 0x9958611eae85c0ec2dfb00681b6383009c734fe02913099b58e5076c7a8cd950;
    uint256 private constant VOLATILE_TOPIC_0 = 0xd2f86f77718e8c84bcd7f6501608767edefd3aadf331889bc31c92a7c1a5279d;

    uint64 private constant CALLBACK_GAS_LIMIT = 4000000;

    constructor(
        address hookContract_,
        address eventContract_,
        address lopContract_
    ) payable {
        hookContract = hookContract_;
        eventContract = eventContract_;
        lopContract = lopContract_;
        
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
            service.subscribe(
                11155111,
                hookContract,
                VOLATILE_TOPIC_0,
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
        if (log.topic_0 == VOLATILE_TOPIC_0){
            bytes memory payload = abi.encodeWithSignature(
                "demoSetter(address,address)",
                address(0),
                address(uint160(uint256(log.topic_1)))
            );

            emit Callback(11155111, lopContract, CALLBACK_GAS_LIMIT, payload);
        }
    }

}