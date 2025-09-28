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
    console.log("🚀 Starting TraderHedge demonstration...\n");

    // --- 1. SETUP PROVIDER ---
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
            console.log(`✅ Connected to: ${rpc}`);
            break;
        } catch (error) {
            console.log(`❌ Failed: ${rpc}`);
            continue;
        }
    }

    if (!provider) {
        throw new Error("Could not connect to any RPC provider");
    }

    // --- 2. SETUP WALLET ---
    if (!process.env.PRIVATE_KEY) {
        throw new Error("PRIVATE_KEY not found in .env file");
    }

    const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log(`🔑 Using account: ${signer.address}`);

    // Check ETH balance
    const ethBalance = await provider.getBalance(signer.address);
    console.log(`💰 ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);

    // --- 3. CONTRACT ADDRESSES ---
    const ONE_INCH_LOP_ADDRESS = "0x111111125421ca6dc452d289314280a0f8842a65";
    const TRADER_HEDGE_LOP_ADDRESS = "0xc7213e5aA8077387b18bc05D705d99841b5f1CA9";
    const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const DAI_ADDRESS = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb";

    // --- 4. SETUP CONTRACTS ---
    const traderHedgeAbi = [
        "function demoSetter(address, address)",
        "function isHedgeActiveFor(address) view returns (uint256)",
        "function activeHedger() view returns (address)"
    ];

    const erc20Abi = [
        "function approve(address, uint256) returns (bool)",
        "function balanceOf(address) view returns (uint256)",
        "function allowance(address, address) view returns (uint256)",
        "function decimals() view returns (uint8)"
    ];

    const traderHedgeContract = new ethers.Contract(TRADER_HEDGE_LOP_ADDRESS, traderHedgeAbi, signer);
    const usdcContract = new ethers.Contract(USDC_ADDRESS, erc20Abi, signer);

    // --- 5. CHECK BALANCES ---
    console.log("\n📊 Checking token balances...");
    const usdcBalance = await usdcContract.balanceOf(signer.address);
    const usdcDecimals = await usdcContract.decimals();
    console.log(`USDC Balance: ${ethers.formatUnits(usdcBalance, usdcDecimals)} USDC`);

    const sellingAmount = ethers.parseUnits("0.1", usdcDecimals);
    if (usdcBalance < sellingAmount) {
        throw new Error(`Insufficient USDC. Need: 0.1, Have: ${ethers.formatUnits(usdcBalance, usdcDecimals)}`);
    }

    // --- 6. CREATE AND SIGN ORDER ---
    console.log("\n📝 Creating limit order...");
    const order = new LimitOrder({
        makerAsset: new Address(USDC_ADDRESS),
        takerAsset: new Address(DAI_ADDRESS),
        makingAmount: ethers.parseUnits("0.1", 6).toString(),  // 0.1 USDC
        takingAmount: ethers.parseUnits("0.1", 18).toString(), // 0.1 DAI
        maker: new Address(signer.address),
    });

    const chainId = (await provider.getNetwork()).chainId;
    const typedData = order.getTypedData(Number(chainId));
    const signature = await signer.signTypedData(
        typedData.domain,
        { Order: typedData.types.Order },
        typedData.message
    );
    console.log("✅ Order signed successfully");
}

main().catch((error) => {
    console.error("\n💥 Script failed:", error.message);
    process.exitCode = 1;
});