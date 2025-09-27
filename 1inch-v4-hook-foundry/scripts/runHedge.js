const { ethers } = require("ethers");
const { 
    LimitOrder,
    TakerTraits,
    LimitOrderContract,
    Address,
    MakerTraits
} = require("@1inch/limit-order-sdk");
require("dotenv").config({ path: '../.env' });

async function main() {
    // --- 1. SETUP ---
    const rpcProviders = [
        "https://mainnet.base.org",
        "https://base-mainnet.public.blastapi.io", 
        "https://1rpc.io/base",
        "https://base.blockpi.network/v1/rpc/public"
    ];
    
    let provider;
    for (const rpc of rpcProviders) {
        try {
            console.log(`Trying RPC: ${rpc}`);
            provider = new ethers.JsonRpcProvider(rpc);
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

    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const signer = wallet;
    console.log("Using account:", signer.address);

    // Base Mainnet addresses
    const ONE_INCH_LOP_ADDRESS = "0x111111125421ca6dc452d289314280a0f8842a65"; 
    const VOLATILITY_CHECKER_ADDRESS = "0x46d38CCB6B28CD7ed5e029DD835821260BC70914";
    const DYNAMIC_FEE_HOOK_ADDRESS = "0xDD91b0AE5cF2b63EC0809F90BC37F710e90a0080";
    const DAI_ADDRESS = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb";
    const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

    // --- 2. CREATE THE PREDICATE ---
    const VOLATILITY_THRESHOLD = 5000; // 0.5% fee
    
    // Step 1: Encode the call to your VolatilityChecker
    const volatilityCheckerAbi = ["function checkVolatility(address,uint24) view returns (uint256)"];
    const volatilityCheckerInterface = new ethers.Interface(volatilityCheckerAbi);
    
    const volatilityCalldata = volatilityCheckerInterface.encodeFunctionData("checkVolatility", [
        DYNAMIC_FEE_HOOK_ADDRESS,
        VOLATILITY_THRESHOLD,
    ]);

    // Step 2: Encode the call to 1inch's arbitraryStaticCall function
    const limitOrderAbi = ["function arbitraryStaticCall(address target, bytes calldata data) view returns (uint256)"];
    const limitOrderInterface = new ethers.Interface(limitOrderAbi);
    
    const predicateCalldata = limitOrderInterface.encodeFunctionData("arbitraryStaticCall", [
        VOLATILITY_CHECKER_ADDRESS,
        volatilityCalldata
    ]);

    console.log("Volatility calldata:", volatilityCalldata);
    console.log("Predicate calldata (arbitraryStaticCall):", predicateCalldata);

    // --- 3. BUILD ORDER WITH MAKERTRAITS ---
    
    // Create MakerTraits with extension support
    const makerTraits = MakerTraits.default()
        .withExtension()  // This sets the HAS_EXTENSION flag
        .withExpiration(Math.floor(Date.now() / 1000) + 3600); // 1 hour expiration

    console.log("MakerTraits with extension:", makerTraits.build());

    // Create the basic order first (without extension)
    const basicOrder = new LimitOrder({
        makerAsset: new Address(DAI_ADDRESS),
        takerAsset: new Address(USDC_ADDRESS),
        makingAmount: ethers.parseUnits("0.1", 18).toString(),
        takingAmount: ethers.parseUnits("0.1", 6).toString(),
        maker: new Address(signer.address),
        // Use the MakerTraits with extension flag
        makerTraits: makerTraits
    });

    // Try Method 1: Use the built-in predicate field
    console.log("\n🔧 Method 1: Using built-in predicate field");
    try {
        // Set the predicate directly on the order
        basicOrder.predicate = predicateCalldata;
        
        console.log("✅ Predicate set on order using built-in field");
        
        // Use simple taker traits without manual extension
        const takerTraits = TakerTraits.default();
        
        // Test signing and building
        const network = await provider.getNetwork();
        const chainId = Number(network.chainId);
        
        const typedData = basicOrder.getTypedData(chainId);
        const signature = await signer.signTypedData(
            typedData.domain,
            { Order: typedData.types.Order },
            typedData.message
        );
        
        console.log("✅ Order signed successfully with predicate");
        
        // Check balance and approve
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
        
        // Approve if needed
        const allowance = await makerAssetContract.allowance(signer.address, ONE_INCH_LOP_ADDRESS);
        if (allowance < ethers.parseUnits("0.1", 18)) {
            console.log("Approving DAI spending...");
            const approveTx = await makerAssetContract.approve(ONE_INCH_LOP_ADDRESS, ethers.MaxUint256);
            await approveTx.wait();
            console.log("✅ Approval successful");
        } else {
            console.log("✅ DAI already approved");
        }

        // Test the predicate directly
        console.log("\n🔍 Testing predicate...");
        const lopContract = new ethers.Contract(
            ONE_INCH_LOP_ADDRESS,
            ["function arbitraryStaticCall(address target, bytes calldata data) view returns (uint256)"],
            provider
        );
        
        const predicateResult = await lopContract.arbitraryStaticCall(
            VOLATILITY_CHECKER_ADDRESS,
            volatilityCalldata
        );
        
        console.log("Predicate result:", predicateResult.toString());
        
        if (predicateResult.toString() === "0") {
            console.log("⚠️  WARNING: Predicate returns 0 (volatility too low)");
            console.log("   Order will fail because volatility condition is not met");
            return;
        } else {
            console.log("✅ Predicate returns 1 (volatility condition met)");
        }

        // Build calldata and execute
        console.log("\n🚀 Building and executing order...");
        
        let calldata;
        try {
            calldata = LimitOrderContract.getFillOrderArgsCalldata(
                basicOrder.build(),
                signature,
                takerTraits,
                basicOrder.makingAmount
            );
            console.log("✅ Calldata built successfully");
        } catch (error) {
            console.log("getFillOrderArgsCalldata failed:", error.message);
            try {
                calldata = LimitOrderContract.getFillOrderCalldata(
                    basicOrder.build(),
                    signature,
                    takerTraits,
                    basicOrder.makingAmount
                );
                console.log("✅ getFillOrderCalldata succeeded");
            } catch (error2) {
                console.error("❌ Both calldata methods failed");
                console.error("Error 1:", error.message);
                console.error("Error 2:", error2.message);
                return;
            }
        }

        console.log("Calldata length:", calldata.length);

        // Estimate gas
        try {
            const gasEstimate = await provider.estimateGas({
                to: ONE_INCH_LOP_ADDRESS,
                data: calldata,
                from: signer.address
            });
            console.log("Gas estimate:", gasEstimate.toString());
        } catch (gasError) {
            console.log("Gas estimation failed:", gasError.message);
            if (gasError.data) {
                console.log("Error data:", gasError.data);
                if (gasError.data === '0x74896a7b') {
                    console.log("❌ Extension format error - trying alternative approach");
                    throw new Error("Extension format error");
                }
            }
        }

        // Send transaction
        const tx = await signer.sendTransaction({
            to: ONE_INCH_LOP_ADDRESS,
            data: calldata,
            gasLimit: 500000
        });

        console.log("Transaction sent:", tx.hash);
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
            console.log("✅ Order filled successfully!");
            console.log("Gas used:", receipt.gasUsed.toString());
        } else {
            console.log("❌ Transaction failed");
        }
        
    } catch (error) {
        console.log("❌ Method 1 failed:", error.message);
        
        // Method 2: Try without predicate for testing
        console.log("\n🔧 Method 2: Testing simple order without predicate");
        try {
            const simpleOrder = new LimitOrder({
                makerAsset: new Address(DAI_ADDRESS),
                takerAsset: new Address(USDC_ADDRESS),
                makingAmount: ethers.parseUnits("0.1", 18).toString(),
                takingAmount: ethers.parseUnits("0.1", 6).toString(),
                maker: new Address(signer.address),
            });

            const simpleTakerTraits = TakerTraits.default();
            const network = await provider.getNetwork();
            const chainId = Number(network.chainId);
            
            const simpleTypedData = simpleOrder.getTypedData(chainId);
            const simpleSignature = await signer.signTypedData(
                simpleTypedData.domain,
                { Order: simpleTypedData.types.Order },
                simpleTypedData.message
            );

            const simpleCalldata = LimitOrderContract.getFillOrderCalldata(
                simpleOrder.build(),
                simpleSignature,
                simpleTakerTraits,
                simpleOrder.makingAmount
            );

            console.log("✅ Simple order calldata built successfully");
            console.log("Simple calldata length:", simpleCalldata.length);

            // Test gas estimation for simple order
            const simpleGasEstimate = await provider.estimateGas({
                to: ONE_INCH_LOP_ADDRESS,
                data: simpleCalldata,
                from: signer.address
            });
            console.log("✅ Simple order gas estimate:", simpleGasEstimate.toString());
            
            console.log("✅ Simple order works - the issue is with predicate/extension handling");
            
        } catch (simpleError) {
            console.log("❌ Even simple order failed:", simpleError.message);
        }
    }
}

main().catch((error) => {
    console.error("Script failed:", error);
    process.exitCode = 1;
});