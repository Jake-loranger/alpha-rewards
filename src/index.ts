import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import 'dotenv/config';

const algorand = AlgorandClient.mainNet();
const indexer = algorand.client.indexer;
const ALPHA_ADDRESS = 'XUIBTKHE7ISNMCLJWXUOOK6X3OCP3GVV3Z4J33PHMYX6XXK3XWN3KDMMNI';
const COMPX_STAKING_ADDRESS = 'I7DUDGGAKTHDZQHA3KZBCNWMGYTSAO55FE62QPXTVCIAF7SYOM5ZMC2FCI';
const TARGET_RECEIVER = process.env.TARGET_RECEIVER!;
const ALPHA_ASSET_ID = 2726252423;
const USDC_ASSET_ID = 31566704;
const XUSD_ASSET_ID = 760037151;

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
  const alphaUSDC = await getSpecificAssetTransfers(ALPHA_ADDRESS, TARGET_RECEIVER, USDC_ASSET_ID, "Alpha", "USDC");
  const compxUSDC = await getSpecificAssetTransfers(COMPX_STAKING_ADDRESS, TARGET_RECEIVER, USDC_ASSET_ID, "CompX", "USDC");
  const compxXUSD = await getSpecificAssetTransfers(COMPX_STAKING_ADDRESS, TARGET_RECEIVER, XUSD_ASSET_ID, "CompX", "XUSD");
  
  return { alphaUSDC, compxUSDC, compxXUSD };
}

interface Trade {
  type: 'buy' | 'sell';
  alphaAmount: number;
  usdcAmount: number;
  timestamp: number;
  transactionGroup: string;
  transactions: string[];
  tradedAssetId?: number;
  price?: number;
  pnl?: number;
}

async function getAssetTransactions(assetId: number, assetName: string): Promise<any[]> {
  let nextToken: string | undefined = undefined;
  let allTransactions: any[] = [];
  let totalProcessed = 0;

  console.log(`\n--- Getting ${assetName} transactions ---`);
  
  do {
    const req = indexer.searchForTransactions()
      .txType('axfer')
      .assetID(assetId)
      .address(TARGET_RECEIVER);
    if (nextToken) {
      req.nextToken(nextToken);
    }
    const response = await req.do();
    
    // Include all transactions where TARGET_RECEIVER is involved (sent or received)
    const relevantTxns = response.transactions.filter(txn => {
      // Check direct asset transfers
      if (txn.assetTransferTransaction) {
        const receiver = txn.assetTransferTransaction.receiver;
        const sender = txn.assetTransferTransaction.sender || txn.sender;
        if (receiver === TARGET_RECEIVER || sender === TARGET_RECEIVER) {
          return true;
        }
      }
      
      // Check inner transactions
      if (txn.innerTxns) {
        return txn.innerTxns.some(innerTxn => {
          if (innerTxn.assetTransferTransaction && 
              Number(innerTxn.assetTransferTransaction.assetId) === assetId) {
            const innerReceiver = innerTxn.assetTransferTransaction.receiver;
            const innerSender = innerTxn.assetTransferTransaction.sender || innerTxn.sender;
            return innerReceiver === TARGET_RECEIVER || innerSender === TARGET_RECEIVER;
          }
          return false;
        });
      }
      return false;
    });
    
    allTransactions = allTransactions.concat(relevantTxns);
    totalProcessed += relevantTxns.length;
    console.log(`Processed ${relevantTxns.length} ${assetName} transactions (total: ${totalProcessed})`);
    nextToken = response.nextToken;
  } while (nextToken);

  return allTransactions;
}

function groupTransactionsByGroup(transactions: any[]): Map<string, any[]> {
  const groups = new Map<string, any[]>();
  
  for (const txn of transactions) {
    const groupId = extractGroupId(txn) || txn.id;
    if (!groups.has(groupId)) {
      groups.set(groupId, []);
    }
    groups.get(groupId)!.push(txn);
  }
  
  return groups;
}

function extractGroupId(txn: any): string | null {
  if (txn.group) {
    // Convert Uint8Array to base64 string
    return Buffer.from(txn.group).toString('base64');
  }
  return null;
}

function analyzeGroupForTrade(groupId: string, txns: any[]): Trade | null {
  let alphaReceived = 0;
  let alphaSent = 0;
  const otherAssetsReceived = new Map<number, number>(); // assetId -> amount
  const otherAssetsSent = new Map<number, number>(); // assetId -> amount
  const transactionIds: string[] = [];
  const timestamp = Math.min(...txns.map(t => t.roundTime || 0));
  
  for (const txn of txns) {
    transactionIds.push(txn.id);
    
    if (txn.assetTransferTransaction) {
      const assetId = Number(txn.assetTransferTransaction.assetId);
      const amount = Number(txn.assetTransferTransaction.amount || 0);
      const receiver = txn.assetTransferTransaction.receiver;
      const sender = txn.assetTransferTransaction.sender || txn.sender;
      
      if (assetId === ALPHA_ASSET_ID) {
        if (receiver === TARGET_RECEIVER) {
          alphaReceived += amount;
        } else if (sender === TARGET_RECEIVER) {
          alphaSent += amount;
        }
      } else {
        // Track other assets
        if (receiver === TARGET_RECEIVER) {
          otherAssetsReceived.set(assetId, (otherAssetsReceived.get(assetId) || 0) + amount);
        } else if (sender === TARGET_RECEIVER) {
          otherAssetsSent.set(assetId, (otherAssetsSent.get(assetId) || 0) + amount);
        }
      }
    }
    
    if (txn.innerTxns) {
      for (const innerTxn of txn.innerTxns) {
        if (innerTxn.assetTransferTransaction) {
          const assetId = Number(innerTxn.assetTransferTransaction.assetId);
          const amount = Number(innerTxn.assetTransferTransaction.amount || 0);
          const receiver = innerTxn.assetTransferTransaction.receiver;
          const sender = innerTxn.assetTransferTransaction.sender || innerTxn.sender;
          
          if (assetId === ALPHA_ASSET_ID) {
            if (receiver === TARGET_RECEIVER) {
              alphaReceived += amount;
            } else if (sender === TARGET_RECEIVER) {
              alphaSent += amount;
            }
          } else {
            // Track other assets
            if (receiver === TARGET_RECEIVER) {
              otherAssetsReceived.set(assetId, (otherAssetsReceived.get(assetId) || 0) + amount);
            } else if (sender === TARGET_RECEIVER) {
              otherAssetsSent.set(assetId, (otherAssetsSent.get(assetId) || 0) + amount);
            }
          }
        }
      }
    }
  }
  
  // Buy trade: received ALPHA and sent another asset (likely USDC)
  if (alphaReceived > 0 && otherAssetsSent.size > 0) {
    // Find the primary asset sent (usually USDC)
    const primaryAssetSent = Array.from(otherAssetsSent.entries()).reduce((max, current) => 
      current[1] > max[1] ? current : max
    );
    
    return {
      type: 'buy',
      alphaAmount: alphaReceived,
      usdcAmount: primaryAssetSent[1],
      timestamp,
      transactionGroup: groupId,
      transactions: transactionIds,
      tradedAssetId: primaryAssetSent[0]
    };
  }
  
  // Sell trade: sent ALPHA and received another asset (likely USDC)
  if (alphaSent > 0 && otherAssetsReceived.size > 0) {
    // Find the primary asset received (usually USDC)
    const primaryAssetReceived = Array.from(otherAssetsReceived.entries()).reduce((max, current) => 
      current[1] > max[1] ? current : max
    );
    
    return {
      type: 'sell',
      alphaAmount: alphaSent,
      usdcAmount: primaryAssetReceived[1],
      timestamp,
      transactionGroup: groupId,
      transactions: transactionIds,
      tradedAssetId: primaryAssetReceived[0]
    };
  }
  
  // If only ALPHA was sent/received without other assets, it's likely staking - ignore
  return null;
}

async function getAssetInfo(assetId: number): Promise<{name: string, unitName: string, decimals: number} | null> {
  try {
    const response = await indexer.lookupAssetByID(assetId).do();
    return {
      name: response.asset.params.name || `Asset ${assetId}`,
      unitName: response.asset.params.unitName || '',
      decimals: response.asset.params.decimals || 6
    };
  } catch (error) {
    return { name: `Asset ${assetId}`, unitName: '', decimals: 6 };
  }
}

function calculateProfitLoss(trades: Trade[]): {totalProfit: number, totalBought: number, totalSold: number, totalAlphaBought: number, totalAlphaSold: number, remainingAlpha: number, trades: Array<Trade & {price: number, runningTotal: number}>} {
  const tradesWithPrice = trades.map(trade => ({
    ...trade,
    price: trade.usdcAmount / trade.alphaAmount,
    runningTotal: 0
  }));
  
  tradesWithPrice.sort((a, b) => a.timestamp - b.timestamp);
  
  let totalBought = 0;
  let totalSold = 0;
  let totalAlphaBought = 0;
  let totalAlphaSold = 0;
  let remainingAlpha = 0;
  let runningSpent = 0;
  
  for (const trade of tradesWithPrice) {
    if (trade.type === 'buy') {
      totalBought += trade.usdcAmount;
      totalAlphaBought += trade.alphaAmount;
      remainingAlpha += trade.alphaAmount;
      runningSpent += trade.usdcAmount;
    } else {
      totalSold += trade.usdcAmount;
      totalAlphaSold += trade.alphaAmount;
      remainingAlpha -= trade.alphaAmount;
      runningSpent -= trade.usdcAmount;
    }
    trade.runningTotal = runningSpent;
  }
  
  const totalProfit = totalSold - totalBought;
  
  return { totalProfit, totalBought, totalSold, totalAlphaBought, totalAlphaSold, remainingAlpha, trades: tradesWithPrice };
}

async function analyzeTrades(): Promise<{totalProfit: number, totalBought: number, totalSold: number, totalAlphaBought: number, totalAlphaSold: number, remainingAlpha: number, trades: Array<Trade & {price: number, runningTotal: number}>}> {
  console.log(`\n--- Analyzing ALPHA<->USDC Trades ---`);
  
  // Get all ALPHA and USDC transactions involving the user (both sent and received)
  const [alphaTxns, usdcTxns] = await Promise.all([
    getAssetTransactions(ALPHA_ASSET_ID, 'ALPHA'),
    getAssetTransactions(USDC_ASSET_ID, 'USDC')
  ]);
  
  // Combine and group all transactions by group ID
  const allTransactions = [...alphaTxns, ...usdcTxns];
  const transactionGroups = groupTransactionsByGroup(allTransactions);
  
  console.log(`Found ${transactionGroups.size} transaction groups to analyze`);
  
  // Analyze each group for potential trades
  const trades: Trade[] = [];
  for (const [groupId, txns] of transactionGroups) {
    const trade = analyzeGroupForTrade(groupId, txns);
    if (trade) {
      trades.push(trade);
    }
  }
  
  console.log(`Found ${trades.length} ALPHA<->USDC trades`);
  
  return calculateProfitLoss(trades);
}


async function main() {
  if (!TARGET_RECEIVER) {
    console.error('TARGET_RECEIVER is not set in the environment variables.');
    return;
  }

  const { alphaUSDC, compxUSDC, compxXUSD } = await getAllIncomingAssets();
  const totalUSDC = alphaUSDC + compxUSDC;

  const { totalProfit, totalBought, totalSold, totalAlphaBought, totalAlphaSold, remainingAlpha, trades } = await analyzeTrades();

  console.log(`\n=== REWARDS SUMMARY ===`);
  console.log(`USDC from ALPHA holdings: ${alphaUSDC / 1000000} USDC`);
  console.log(`USDC from CompX Staking: ${compxUSDC / 1000000} USDC`);
  console.log(`XUSD from CompX Staking: ${compxXUSD / 1000000} XUSD`);
  console.log(`Total USDC received: ${totalUSDC / 1000000} USDC`);

  if (trades.length > 0) {
    console.log(`\n=== TRADE DETAILS ===`);
    
    // Get asset info for all unique traded assets
    const uniqueAssetIds = [...new Set(trades.map(t => t.tradedAssetId).filter(id => id !== undefined))];
    const assetInfoMap = new Map<number, {name: string, unitName: string, decimals: number}>();
    
    for (const assetId of uniqueAssetIds) {
      const info = await getAssetInfo(assetId!);
      if (info) {
        assetInfoMap.set(assetId!, info);
      }
    }
    
    trades.forEach((trade, index) => {
      const date = new Date(trade.timestamp * 1000).toISOString().split('T')[0];
      const alphaAmount = (trade.alphaAmount / 1000000).toFixed(2);
      const runningTotal = (trade.runningTotal / 1000000).toFixed(2);
      
      let assetName = 'UNKNOWN';
      let assetAmount = '0.00';
      let price = '0.00000000';
      
      if (trade.tradedAssetId && assetInfoMap.has(trade.tradedAssetId)) {
        const assetInfo = assetInfoMap.get(trade.tradedAssetId)!;
        assetName = assetInfo.unitName || assetInfo.name;
        const decimals = assetInfo.decimals;
        assetAmount = (trade.usdcAmount / Math.pow(10, decimals)).toFixed(2);
        price = (trade.usdcAmount / trade.alphaAmount).toFixed(8);
      }
      
      // Show sells as negative values
      const displayAmount = trade.type === 'sell' ? `-${assetAmount}` : assetAmount;
      
      console.log(`${index + 1}. ${date} - ${trade.type.toUpperCase()}: ${alphaAmount} ALPHA @ ${price} ${assetName}/ALPHA (${displayAmount} ${assetName}) [Running: ${runningTotal} ${assetName}]`);
      console.log(`   Transactions: ${trade.transactions.join(', ')}`);
      console.log(`   Group: ${trade.transactionGroup}`);
      if (trade.tradedAssetId) {
        console.log(`   Traded Asset ID: ${trade.tradedAssetId}`);
      }
    });
    
    const buys = trades.filter(t => t.type === 'buy');
    const sells = trades.filter(t => t.type === 'sell');
    
    console.log(`\n=== TRADING SUMMARY ===`);
    console.log(`Total trades: ${trades.length}`);
    console.log(`Total USDC spent (buys): ${(totalBought / 1000000).toFixed(2)} USDC`);
    console.log(`Total USDC received (sells): ${(totalSold / 1000000).toFixed(2)} USDC`);
    console.log(`Total ALPHA bought: ${(totalAlphaBought / 1000000).toFixed(2)} ALPHA`);
    console.log(`Total ALPHA sold: ${(totalAlphaSold / 1000000).toFixed(2)} ALPHA`);
    console.log(`Trading P&L: ${(totalProfit / 1000000).toFixed(2)} USDC`);
    console.log(`Remaining ALPHA balance: ${(remainingAlpha / 1000000).toFixed(2)} ALPHA`);
    
    console.log(`\n=== TRADE STATISTICS ===`);
    console.log(`Buy trades: ${buys.length}`);
    console.log(`Sell trades: ${sells.length}`);
    
    if (buys.length > 0) {
      const avgBuyPrice = buys.reduce((sum, t) => sum + (t.usdcAmount / t.alphaAmount), 0) / buys.length;
      console.log(`Average buy price: ${avgBuyPrice.toFixed(8)} USDC/ALPHA`);
    }
    
    if (sells.length > 0) {
      const avgSellPrice = sells.reduce((sum, t) => sum + (t.usdcAmount / t.alphaAmount), 0) / sells.length;
      console.log(`Average sell price: ${avgSellPrice.toFixed(8)} USDC/ALPHA`);
    }
  }

  console.log(`\n=== OVERALL SUMMARY ===`);
  console.log(`Total rewards: ${totalUSDC / 1000000} USDC + ${compxXUSD / 1000000} XUSD`);
  console.log(`Trading P&L: ${(totalProfit / 1000000).toFixed(2)} USDC`);
  console.log(`Combined value: ${((totalUSDC + totalProfit) / 1000000).toFixed(2)} USDC + ${compxXUSD / 1000000} XUSD`);
}

main().catch(console.error);