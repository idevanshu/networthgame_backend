const express = require('express');
const { Web3 } = require('web3');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const app = express();

// Define CORS Middleware to allow requests from all domains
const corsMiddleware = (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // Allow all domains
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(204);
    } else {
        next();
    }
};

// Apply CORS middleware before your routes
app.use(corsMiddleware);

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL);  // Configured via environment variable
const infuraUrl = process.env.INFURA_URL || 'https://mainnet.infura.io/v3/your-project-id'; // Ensure this is secured

redis.on('error', (err) => {
    console.error('Redis error:', err);
});

const web3 = new Web3(infuraUrl);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function generateUserName(address) {
    return `User${address.slice(2, 6)}`;
}

app.post('/api/userdata', async (req, res) => {
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

        return res.json({ name, netWorth, multiplier });
    } catch (error) {
        console.error("Error fetching ETH balance or updating database:", error);
        return res.status(500).send(`Error fetching wallet information or updating database: ${error.message}`);
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const users = await prisma.user.findMany();
        const userList = users.map(user => ({
            name: user.name,
            netWorth: user.ethHoldings * user.loginCount,
            multiplier: user.loginCount
        }));
        userList.sort((a, b) => b.netWorth - a.netWorth);

        return res.json(userList);
    } catch (error) {
        console.error("Error fetching leaderboard data:", error);
        return res.status(500).send(`Error fetching leaderboard data: ${error.message}`);
    }
});


module.exports = app;