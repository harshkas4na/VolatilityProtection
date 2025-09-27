// scripts/runTraderHedge.js
const { ethers } = require("ethers");
const { 
    LimitOrder,
    TakerTraits,
    LimitOrderContract,
    Address,
    Extension
} = require("@1inch/limit-order-sdk");
require("dotenv").config({ path: '../.env' });

async function main() {
    // --- 1. SETUP ---
    const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const signer = wallet; // This wallet will act as both the Trader and the Filler.
    const admin = wallet;  // This wallet will act as the RSC admin.

    console.log("Using Trader/Filler account:", signer.address);

    // --- CONTRACT ADDRESSES ---
    const ONE_INCH_LOP_ADDRESS = "0x111111125421ca6dc452d289314280a0f8842a65"; 
    // IMPORTANT: Use the address of your newly deployed TraderHedgeLOP contract
    const TRADER_HEDGE_LOP_ADDRESS = "YOUR_DEPLOYED_TRADER_HEDGE_LOP_ADDRESS"; 
    const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // We'll sell USDC
    const DAI_ADDRESS = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb";  // We'll buy DAI

    // --- ABIs ---
    const traderHedgeLopAbi = [
        "function demoSetter(address, address)",
        "function isHedgeActiveFor(address) view returns (uint256)"
    ];
    const erc20Abi = [
        "function approve(address, uint256) returns (bool)",
        "function balanceOf(address) view returns (uint256)"
    ];
    
    const traderHedgeContract = new ethers.Contract(TRADER_HEDGE_LOP_ADDRESS, traderHedgeLopAbi, admin);
    const traderHedgeInterface = new ethers.Interface(traderHedgeAbi);

    // --- 2. TRADER CREATES AND SIGNS THE HEDGE ORDER ---
    // The trader pre-signs an order to sell 0.1 USDC for 0.1 DAI.
    // This order is invalid until the RSC enables it.
    const order = new LimitOrder({
        makerAsset: new Address(USDC_ADDRESS),
        takerAsset: new Address(DAI_ADDRESS),
        makingAmount: ethers.parseUnits("0.1", 6).toString(),  // Selling 0.1 USDC (6 decimals)
        takingAmount: ethers.parseUnits("0.1", 18).toString(), // Asking for 0.1 DAI (18 decimals)
        maker: new Address(signer.address),
    });

    const chainId = (await provider.getNetwork()).chainId;
    const typedData = order.getTypedData(Number(chainId));
    const signature = await signer.signTypedData(
        typedData.domain,
        { Order: typedData.types.Order },
        typedData.message
    );
    console.log("Trader has signed the hedge order off-chain.");

    // --- 3. RSC SIMULATION: ENABLE THE HEDGE ---
    // Your Reactive Smart Contract would do this step automatically. We do it manually here.
    console.log(`RSC is enabling hedge for trader: ${signer.address}...`);
    try {
        const enableTx = await traderHedgeContract.demoSetter(ethers.ZeroAddress, signer.address);
        await enableTx.wait();
        console.log("✅ Hedge has been armed on-chain.");
    } catch (e) {
        console.error("❌ Failed to enable hedge.", e.message);
        return; // Exit if we can't enable the hedge
    }

    // --- 4. BUILD THE PREDICATE FOR THE FILLER ---
    // The filler's transaction will use this predicate to prove the hedge is active.
    const predicateCalldata = traderHedgeInterface.encodeFunctionData("isHedgeActiveFor", [
        signer.address // Check if hedge is active for the order's maker
    ]);

    const extension = new Extension({
        predicate: {
            target: TRADER_HEDGE_LOP_ADDRESS,
            data: predicateCalldata
        }
    });

    const takerTraits = TakerTraits.default().setExtension(extension.encode());

    // --- 5. FILLER EXECUTES THE HEDGE ORDER ---
    console.log("\nAttempting to fill the now-valid hedge order...");
    const makerAssetContract = new ethers.Contract(USDC_ADDRESS, erc20Abi, signer);

    // Check balance
    const usdcBalance = await makerAssetContract.balanceOf(signer.address);
    if (usdcBalance < order.makingAmount) {
        console.log(`❌ Insufficient USDC balance. Required: ${ethers.formatUnits(order.makingAmount, 6)}, Have: ${ethers.formatUnits(usdcBalance, 6)}`);
        return;
    }

    // Approve spending
    console.log("Approving USDC spending...");
    const approveTx = await makerAssetContract.approve(ONE_INCH_LOP_ADDRESS, order.makingAmount);
    await approveTx.wait();
    console.log("Approval successful.");
    
    // Build calldata for the fill transaction
    const calldata = LimitOrderContract.getFillOrderArgsCalldata(
        order.build(),
        signature,
        takerTraits,
        order.makingAmount
    );

    try {
        const tx = await signer.sendTransaction({
            to: ONE_INCH_LOP_ADDRESS,
            data: calldata,
            gasLimit: 500000 // A safe gas limit for fills with extensions
        });

        console.log("Fill transaction sent:", tx.hash);
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
            console.log("✅ Hedge order filled successfully!");
        } else {
            console.log("❌ Transaction reverted on-chain.");
        }
        
    } catch (error) {
        console.error("❌ Failed to fill order.");
        console.error("Reason:", error.reason || error.message);
    }
}

main().catch((error) => {
    console.error("Script failed:", error);
    process.exitCode = 1;
});