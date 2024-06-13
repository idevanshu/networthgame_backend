const express = require('express');
const {Web3} = require('web3'); 
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const app = express();

// Custom CORS Middleware
const allowCors = fn => async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, PATCH, DELETE, POST, PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRFToken, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    return await fn(req, res);
};

const prisma = new PrismaClient();
const redis = new Redis();  // Ensure configuration is correct for your environment
const infuraUrl = process.env.INFURA_URL || 'https://mainnet.infura.io/v3/8627168fd72846898c561bf658ff262a'; // Ensure this is secured
const web3 = new Web3(infuraUrl);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function generateUserName(address) {
    return `User${address.slice(2, 6)}`;
}

app.post('/api/userdata', allowCors(async (req, res) => {
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
}));

app.get('/api/leaderboard', allowCors(async (req, res) => {
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
}));

module.exports = app;
