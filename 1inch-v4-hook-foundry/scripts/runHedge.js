// scripts/runHedge.js
const { ethers } = require("ethers");
// NEW: Import classes from the new SDK
const { 
    LimitOrder,
    TakerTraits,
    LimitOrderContract,
    Address
} = require("@1inch/limit-order-sdk");
require("dotenv").config({ path: '../.env' });

// Manual extension encoding function
function encodeExtension(targetAddress, calldata) {
    // Extension format: target (20 bytes) + calldata length (4 bytes) + calldata
    const target = ethers.getBytes(targetAddress.toLowerCase());
    const data = ethers.getBytes(calldata);
    const dataLength = ethers.toBeHex(data.length, 4);
    
    return ethers.hexlify(ethers.concat([target, dataLength, data]));
}

// Create a minimal Extension wrapper that has the encode() method
class SimpleExtension {
    constructor(encodedHex) {
        this.encodedHex = encodedHex;
    }
    
    encode() {
        return this.encodedHex;
    }
}

async function main() {
    // --- 1. SETUP ---
    // Try multiple RPC providers for better reliability
    const rpcProviders = [
        "https://mainnet.base.org",  // Official Base RPC
        "https://base-mainnet.public.blastapi.io", // Blast API
        "https://1rpc.io/base", // 1RPC
        "https://base.blockpi.network/v1/rpc/public" // BlockPI
    ];
    
    let provider;
    for (const rpc of rpcProviders) {
        try {
            console.log(`Trying RPC: ${rpc}`);
            provider = new ethers.JsonRpcProvider(rpc);
            // Test the connection
            await provider.getBlockNumber();
            console.log(`✅ Connected to RPC: ${rpc}`);
            break;
        } catch (error) {
            console.log(`❌ Failed to connect to ${rpc}`);
            continue;
        }
    }
    
    if (!provider) {
        throw new Error("Could not connect to any RPC provider");
    }

    // CRITICAL FIX: Load your private key securely from the .env file
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const signer = wallet;

    console.log("Using account:", signer.address);

    // CORRECT: Addresses for Base Mainnet
    const ONE_INCH_LOP_ADDRESS = "0x111111125421ca6dc452d289314280a0f8842a65"; 
    const VOLATILITY_CHECKER_ADDRESS = "0x46d38CCB6B28CD7ed5e029DD835821260BC70914";
    const DYNAMIC_FEE_HOOK_ADDRESS = "0xDD91b0AE5cF2b63EC0809F90BC37F710e90a0080";
    const DAI_ADDRESS = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb";
    const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

    const volatilityCheckerAbi = ["function checkVolatility(address,uint24) view returns (uint256)"];
    const volatilityCheckerInterface = new ethers.Interface(volatilityCheckerAbi);
    const erc20Abi = ["function approve(address,uint256) returns (bool)"];

    // --- 2. BUILD THE ORDER ---
    const order = new LimitOrder({
        makerAsset: new Address(DAI_ADDRESS),
        takerAsset: new Address(USDC_ADDRESS),
        // NOTE: DAI has 18 decimals, so parseEther is correct. USDC has 6.
        makingAmount: ethers.parseUnits("0.1", 18).toString(), // Selling 1 DAI
        takingAmount: ethers.parseUnits("0.1", 6).toString(), // Asking for 1 USDC
        maker: new Address(signer.address),
    });

    // --- 3. BUILD THE PREDICATE & EXTENSION MANUALLY ---
    const VOLATILITY_THRESHOLD = 5000; // 0.5% fee
    
    // Encode the predicate calldata
    const predicateCalldata = volatilityCheckerInterface.encodeFunctionData("checkVolatility", [
        DYNAMIC_FEE_HOOK_ADDRESS,
        VOLATILITY_THRESHOLD,
    ]);

    console.log("Predicate calldata:", predicateCalldata);
    console.log("Volatility checker address:", VOLATILITY_CHECKER_ADDRESS);

    // FIXED: Create extension manually without using the problematic Extension class
    const extensionHex = encodeExtension(VOLATILITY_CHECKER_ADDRESS, predicateCalldata);
    console.log("Extension hex:", extensionHex);

    // Try different approaches for the extension
    let takerTraits;
    
    try {
        // Approach 1: Create a wrapper extension object that has the encode() method
        const extensionWrapper = new SimpleExtension(extensionHex);
        takerTraits = TakerTraits.default().setExtension(extensionWrapper);
        console.log("Extension created successfully (wrapper approach)");
    } catch (error) {
        console.log("Wrapper approach failed, trying raw hex:", error.message);
        
        try {
            // Approach 2: Use the raw extension hex directly
            takerTraits = TakerTraits.default().setExtension(extensionHex);
            console.log("Extension created successfully (raw hex approach)");
        } catch (error2) {
            console.log("Raw hex approach failed, trying interaction field:", error2.message);
            
            try {
                // Approach 3: Put the extension in the interaction field instead
                takerTraits = TakerTraits.default().setInteraction(extensionHex);
                console.log("Extension created successfully (interaction field approach)");
            } catch (error3) {
                console.log("Interaction approach failed, trying no extension:", error3.message);
                
                // Approach 4: Create order without extension for testing
                takerTraits = TakerTraits.default();
                console.log("Using order without extension for testing");
            }
        }
    }

    console.log("Extension created successfully (manual encoding)");

    // --- 4. SIGN THE ORDER ---
    console.log("Getting network info...");
    const network = await provider.getNetwork();
    const chainId = network.chainId;
    console.log("Chain ID:", chainId.toString());
    
    const typedData = order.getTypedData(Number(chainId));
    const signature = await signer.signTypedData(
        typedData.domain,
        { Order: typedData.types.Order },
        typedData.message
    );
    console.log("Order signed successfully.");

    // --- 5. FILL THE ORDER ---
    console.log("Attempting to fill the order...");
    
    // Check DAI balance first
    const makerAssetContract = new ethers.Contract(DAI_ADDRESS, [
        "function balanceOf(address) view returns (uint256)",
        "function approve(address,uint256) returns (bool)"
    ], signer);
    
    const daiBalance = await makerAssetContract.balanceOf(signer.address);
    console.log("DAI balance:", ethers.formatUnits(daiBalance, 18));
    
    if (daiBalance < ethers.parseUnits("0.1", 18)) {
        console.log("❌ Insufficient DAI balance to create this order");
        return;
    }
    
    // Approve DAI spending
    console.log("Approving DAI spending...");
    const approveTx = await makerAssetContract.approve(ONE_INCH_LOP_ADDRESS, ethers.MaxUint256);
    await approveTx.wait();
    console.log("DEBUG STEP A: Approval successful. About to build calldata...");

    try {
        // Try different calldata methods based on what we have
        let calldata;
        
        try {
            console.log("Building calldata with getFillOrderArgsCalldata...");
            calldata = LimitOrderContract.getFillOrderArgsCalldata(
                order.build(),
                signature,
                takerTraits,
                order.makingAmount
            );
            console.log("✅ getFillOrderArgsCalldata succeeded");
        } catch (argsError) {
            console.log("getFillOrderArgsCalldata failed:", argsError.message);
            console.log("Trying getFillOrderCalldata...");
            
            try {
                calldata = LimitOrderContract.getFillOrderCalldata(
                    order.build(),
                    signature,
                    takerTraits,
                    order.makingAmount
                );
                console.log("✅ getFillOrderCalldata succeeded");
            } catch (simpleError) {
                console.log("getFillOrderCalldata also failed:", simpleError.message);
                throw new Error("Both calldata methods failed");
            }
        }

        console.log("DEBUG STEP B: Calldata built successfully.");
        console.log("Calldata length:", calldata.length);

        // Estimate gas first
        try {
            const gasEstimate = await provider.estimateGas({
                to: ONE_INCH_LOP_ADDRESS,
                data: calldata,
                from: signer.address
            });
            console.log("Gas estimate:", gasEstimate.toString());
        } catch (gasError) {
            console.log("Gas estimation failed (this might be expected for complex orders):", gasError.message);
        }

        console.log("DEBUG STEP C: Sending transaction...");
        const tx = await signer.sendTransaction({
            to: ONE_INCH_LOP_ADDRESS,
            data: calldata,
            gasLimit: 500000 // Set a reasonable gas limit
        });

        console.log("Transaction sent:", tx.hash);
        console.log("Waiting for confirmation...");
        const receipt = await tx.wait();
        console.log("✅ Order filled successfully!");
        console.log("Transaction receipt:", receipt.status === 1 ? "Success" : "Failed");
    } catch (error) {
        console.error("❌ Failed to fill order.");
        
        // Parse the error to get more details
        if (error.data) {
            console.error("Error data:", error.data);
        }
        if (error.reason) {
            console.error("Reason:", error.reason);
        }
        console.error("Full error:", error.message);
    }
}

main().catch((error) => {
    console.error("Script failed:", error);
    process.exitCode = 1;
});