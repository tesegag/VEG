require('dotenv').config();
const path = require('path');
// Use the SAME mongoose instance the backend models use (backend/node_modules),
// otherwise connect() happens on one copy and queries on another and time out.
const mongoose = require(require.resolve('mongoose', { paths: [path.join(__dirname, '..', 'backend')] }));
const { runStartupBootstrap } = require('../backend/src/utils/bootstrap');
const { User, HouseWallet } = require('../backend/src/models');

/**
 * The backend also runs this bootstrap automatically on every boot
 * (index.js), so this script isn't strictly required — it exists as a
 * standalone way to verify DB connectivity and seed the admin/House Wallet
 * records BEFORE the first deploy, without needing the full server running.
 */
async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || 'bingo_db' });
  console.log('Connected to MongoDB');

  await runStartupBootstrap();

  const admin = await User.findOne({ telegramId: String(process.env.ADMIN_ID) });
  const house = await HouseWallet.findOne({ walletId: 'house' });

  console.log('Admin user:', admin ? { telegramId: admin.telegramId, isAdmin: admin.isAdmin } : 'NOT FOUND — check ADMIN_ID');
  console.log('House Wallet balance:', house ? house.balance : 'NOT FOUND');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
