const express = require('express');
const { Web3 } = require('web3');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
const cors = require('cors');

const app = express();

// CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

const prisma = new PrismaClient();
const redis = new Redis();

const infuraUrl = process.env.INFURA_URL || 'https://mainnet.infura.io/v3/8627168fd72846898c561bf658ff262a'; // Replace with your Infura Project ID
const web3 = new Web3(infuraUrl);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function generateUserName(address) {
  return `User${address.slice(2, 6)}`;
}

app.options('/api/*', cors());

app.post('/api/userdata', async (req, res) => {
  const { address } = req.body;
  const name = generateUserName(address);

  console.log(`Received request for address: ${address}`);

  try {
    const balance = await web3.eth.getBalance(address);
    const ethHoldings = web3.utils.fromWei(balance, 'ether');
    console.log(`Fetched balance for ${address}: ${ethHoldings} ETH`);

    let user = await prisma.user.findUnique({
      where: { address }
    });

    if (!user) {
      console.log(`Creating new user for address: ${address}`);
      user = await prisma.user.create({
        data: {
          address,
          name,
          ethHoldings: parseFloat(ethHoldings),
          loginCount: 1,
        },
      });
    } else {
      console.log(`Updating existing user for address: ${address}`);
      user = await prisma.user.update({
        where: { address },
        data: {
          ethHoldings: parseFloat(ethHoldings),
          loginCount: user.loginCount + 1,
        },
      });
    }

    const multiplier = user.loginCount;
    const netWorth = user.ethHoldings * multiplier;

    await redis.set(address, JSON.stringify({ name, netWorth, multiplier }), 'EX', 3600);
    console.log(`Cached data for address: ${address}`);

    res.json({ name, netWorth, multiplier });
  } catch (error) {
    console.error("Error fetching ETH balance or updating database:", error);
    res.status(500).send("Error fetching wallet information or updating database");
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    console.log("Received request for leaderboard");
    const users = await prisma.user.findMany();
    const userList = users.map(user => ({
      name: user.name,
      netWorth: user.ethHoldings * user.loginCount,
      multiplier: user.loginCount
    }));
    userList.sort((a, b) => b.netWorth - a.netWorth);
    res.json(userList);
  } catch (error) {
    console.error("Error fetching leaderboard data:", error);
    res.status(500).send("Error fetching leaderboard data");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
