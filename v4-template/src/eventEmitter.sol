// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract eventEmitter{

    event VolatilityCheck(bool valatile);

    function emitVolatile(bool flag) public {

     emit VolatilityCheck(flag);
     
    }
}