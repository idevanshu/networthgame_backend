const express = require('express');
const {Web3} = require('web3'); // Corrected Web3 import
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
const cors = require('cors');

const app = express();

// Configure CORS
app.use(cors({
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
    credentials: true,
    origin: '*' // Consider specifying origins in production
}));

// Middleware for parsing application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));
// Middleware for parsing application/json
app.use(express.json());

const prisma = new PrismaClient();
const redis = new Redis();

const infuraUrl = process.env.INFURA_URL || 'https://mainnet.infura.io/v3/8627168fd72846898c561bf658ff262a'; // Replace your Infura Project ID
const web3 = new Web3(infuraUrl);

// Generate a username from a wallet address
function generateUserName(address) {
    return `User${address.slice(2, 6)}`;
}

// Route for receiving and handling user data
app.post('/api/userdata', async (req, inres) => {
    const { address } = req.body;
    const name = generateUserName(address);

    try {
        const balance = await web3.eth.getBalance(address);
        const ethHoldings = web3.utils.fromWei(balance, 'ether');

        let user = await prisma.user.findUnique({
            where: { address }
        });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    address,
                    name,
                    ethHoldings: parseFloat(ethHoldings),
                    loginCount: 1,
                },
            });
        } else {
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

        res.json({ name, netWorth, multiplier });
    } catch (error) {
        console.error("Error fetching ETH balance or updating database:", error);
        res.status(500).send("Error fetching wallet information or updating database");
    }
});

// Leaderboard route to fetch and return leaderboard data
app.get('/api/leaderboard', async (req, res) => {
    try {
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

// Set the port for the Express application
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Export the app for testing purposes
module.exports = app;
