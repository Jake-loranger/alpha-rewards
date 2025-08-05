import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import 'dotenv/config';

const algorand = AlgorandClient.mainNet();
const indexer = algorand.client.indexer;
const ALPHA_ADDRESS = 'XUIBTKHE7ISNMCLJWXUOOK6X3OCP3GVV3Z4J33PHMYX6XXK3XWN3KDMMNI';
const TARGET_RECEIVER = process.env.TARGET_RECEIVER!;
let nextToken: string | undefined = undefined;
let amount = 0;

async function main() {
  if (!TARGET_RECEIVER) {
    console.error('TARGET_RECEIVER is not set in the environment variables.');
    return;
  }
	do {
    const req = indexer.lookupAccountTransactions(ALPHA_ADDRESS);
    if (nextToken) {
      req.nextToken(nextToken);
    }
    const response = await req.do();

    for (const txn of response.transactions) {
      if (
        txn.sender === ALPHA_ADDRESS &&
        txn.assetTransferTransaction &&
        txn.assetTransferTransaction.receiver === TARGET_RECEIVER &&
      Number(txn.assetTransferTransaction.assetId) === 31566704 // USDC Asset ID
      ) {
        amount += Number(txn.assetTransferTransaction.amount || 0);
      }
    }

    nextToken = response.nextToken;
  } while (nextToken);

  console.log(`Total amount received from ALPHA holdings: ${amount / 1000000} USDC`);
}

main().catch(console.error);