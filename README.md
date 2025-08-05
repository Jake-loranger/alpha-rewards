# Alpha Rewards Calculator

This script calculates the total amount of USDC received from holding $ALPHA tokens. It uses the Algorand blockchain to fetch and analyze transactions.

## Features
- Fetches transactions from the Algorand blockchain.
- Filters transactions based on sender, receiver, and asset ID.
- Calculates the total amount of USDC received.

## Prerequisites
- Node.js installed on your system.
- An Algorand account address to use as the target receiver.

## Setup
1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd alpha-rewards
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the project root and set the `TARGET_RECEIVER` environment variable:
   ```env
   TARGET_RECEIVER=YOUR_ALGORAND_ADDRESS
   ```

## Usage
Run the script using the following command:
```bash
npm run start
```

## Output
The script will output the total amount of USDC received by the target receiver from the ALPHA address, in ALGO units.

## Notes
- Ensure the `TARGET_RECEIVER` environment variable is set correctly.
- The script uses the USDC asset ID `31566704` on the Algorand blockchain.

## License
This project is licensed under the MIT License.
