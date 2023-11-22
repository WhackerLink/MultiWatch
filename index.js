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

const configFilePathIndex = process.argv.indexOf('-c');
if (configFilePathIndex === -1 || process.argv.length <= configFilePathIndex + 1) {
    console.error('Please provide the path to the configuration file using -c argument.');
    process.exit(1);
}

const configFilePath = process.argv[configFilePathIndex + 1];

const configFile = fs.readFileSync(configFilePath, 'utf8');
const config = yaml.load(configFile);

app.set('views', path.join(__dirname, 'views'))

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
