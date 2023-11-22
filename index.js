/*
    Written by Caleb, KO4UYJ
    Discord: _php_
    Email: ko4uyj@gmail.com
 */

import express from 'express';
import http from 'http';
import yaml from 'js-yaml';
import { Server } from 'socket.io';
import { io as socketClient } from 'socket.io-client';
import fs from 'fs';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const configFile = fs.readFileSync("config.yml", 'utf8');
const config = yaml.load(configFile);

app.set('view engine', 'ejs');

const networkSockets = [];

config.networks.forEach(network => {
    const netSocket = socketClient(network.url, {
        query: { token: network.token }
    });

    netSocket.on('updateChannels', (data) => {
        io.emit('networkUpdate', { network: network.name, data });
    });

    netSocket.on('connect', () => {
        console.log(`Connected to network: ${network.name}`);
    });

    networkSockets.push(netSocket);
});
io.on('connection', (clientSocket) => {
    networkSockets.forEach(netSocket => {
        netSocket.emit('REQUEST_CHANNEL_UPDATES');
    });
});

app.get('/', (req, res) => {
    res.render('index', { networks: config.networks });
});

server.listen(config.listenPort, config.bindAddress, () => {
    console.log('Multi Watch started on', config.bindAddress, ':', config.listenPort);
});
