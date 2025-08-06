import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import 'dotenv/config';

const algorand = AlgorandClient.mainNet();
const indexer = algorand.client.indexer;
const ALPHA_ADDRESS = 'XUIBTKHE7ISNMCLJWXUOOK6X3OCP3GVV3Z4J33PHMYX6XXK3XWN3KDMMNI';
const COMPX_STAKING_ADDRESS = 'I7DUDGGAKTHDZQHA3KZBCNWMGYTSAO55FE62QPXTVCIAF7SYOM5ZMC2FCI';
const TARGET_RECEIVER = process.env.TARGET_RECEIVER!;

async function getSpecificAssetTransfers(fromAddress: string, toAddress: string, assetId: number, addressName: string, assetName: string): Promise<number> {
  let nextToken: string | undefined = undefined;
  let amount = 0;
  let totalTransactions = 0;

  console.log(`\n--- Checking ${addressName} -> Target ${assetName} transfers ---`);
  
  do {
    // Filter for specific asset transfers between addresses
    const req = indexer.searchForTransactions()
      .txType('axfer')
      .assetID(assetId)
      .address(fromAddress)
      .address(toAddress);
    if (nextToken) {
      req.nextToken(nextToken);
    }
    const response = await req.do();
    totalTransactions += response.transactions.length;
    console.log(`Processing ${response.transactions.length} ${assetName} transactions (total: ${totalTransactions})`);

    for (const txn of response.transactions) {
      // Check direct asset transfers
      if (
        txn.sender === fromAddress &&
        txn.assetTransferTransaction &&
        txn.assetTransferTransaction.receiver === toAddress &&
        Number(txn.assetTransferTransaction.assetId) === assetId
      ) {
        const transferAmount = Number(txn.assetTransferTransaction.amount || 0);
        amount += transferAmount;
        console.log(`Found ${addressName} direct ${assetName} transfer: ${transferAmount / 1000000} ${assetName} (txn: ${txn.id})`);
      }
      
      // Check inner transactions
      if (txn.innerTxns) {
        for (const innerTxn of txn.innerTxns) {
          if (
            innerTxn.assetTransferTransaction &&
            innerTxn.assetTransferTransaction.receiver === toAddress &&
            Number(innerTxn.assetTransferTransaction.assetId) === assetId &&
            (innerTxn.assetTransferTransaction.sender === fromAddress || innerTxn.sender === fromAddress)
          ) {
            const transferAmount = Number(innerTxn.assetTransferTransaction.amount || 0);
            amount += transferAmount;
            console.log(`Found ${addressName} inner ${assetName} transfer: ${transferAmount / 1000000} ${assetName} (parent txn: ${txn.id})`);
          }
        }
      }
    }

    nextToken = response.nextToken;
  } while (nextToken);

  console.log(`${addressName} ${assetName} total transactions processed: ${totalTransactions}`);
  return amount;
}

async function getAllIncomingAssets(): Promise<{alphaUSDC: number, compxUSDC: number, compxXUSD: number}> {
  const alphaUSDC = await getSpecificAssetTransfers(ALPHA_ADDRESS, TARGET_RECEIVER, 31566704, "Alpha", "USDC");
  const compxUSDC = await getSpecificAssetTransfers(COMPX_STAKING_ADDRESS, TARGET_RECEIVER, 31566704, "CompX", "USDC");
  const compxXUSD = await getSpecificAssetTransfers(COMPX_STAKING_ADDRESS, TARGET_RECEIVER, 760037151, "CompX", "XUSD");
  
  return { alphaUSDC, compxUSDC, compxXUSD };
}

async function main() {
  if (!TARGET_RECEIVER) {
    console.error('TARGET_RECEIVER is not set in the environment variables.');
    return;
  }

  const { alphaUSDC, compxUSDC, compxXUSD } = await getAllIncomingAssets();
  const totalUSDC = alphaUSDC + compxUSDC;

  console.log(`\n=== SUMMARY ===`);
  console.log(`USDC from ALPHA holdings: ${alphaUSDC / 1000000} USDC`);
  console.log(`USDC from CompX Staking: ${compxUSDC / 1000000} USDC`);
  console.log(`XUSD from CompX Staking: ${compxXUSD / 1000000} XUSD`);
  console.log(`Total USDC received: ${totalUSDC / 1000000} USDC`);
}

main().catch(console.error);