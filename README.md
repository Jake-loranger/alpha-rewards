# Alpha Rewards Calculator

This script calculates the total amount of USDC received from holding $ALPHA tokens on Algorand.

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
The script will output the total amount of USDC received by the target receiver from Alpha Arcade's distribution address.

## Notes
- Ensure the `TARGET_RECEIVER` environment variable is set correctly.
- The script uses the USDC asset ID `31566704` on the Algorand blockchain.

## License
This project is licensed under the MIT License.

