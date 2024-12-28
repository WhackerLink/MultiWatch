/*
* WhackerLink - Multi Watch
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <http://www.gnu.org/licenses/>.
*
* Copyright (C) 2023-2024 Caleb, K4PHP
*
*/

import express from 'express';
import http from 'http';
import yaml from 'js-yaml';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json())

app.set('view engine', 'ejs');

const PacketTypes = Object.freeze({
    0x0: "UNKOWN",
    0x1: "AUDIO_DATA",
    0x2: "GRP_AFF_REQ",
    0x3: "GRP_AFF_RSP",
    0x4: "AFF_UPDATE",
    0x5: "GRP_VCH_REQ",
    0x6: "GRP_VCH_RLS",
    0x7: "GRP_VCH_RSP",
    0x8: "U_REG_REQ",
    0x9: "U_REG_RSP",
    0x10: "U_DE_REG_REQ",
    0x11: "U_DE_REG_RSP",
    0x12: "EMRG_ALRM_REQ",
    0x13: "EMRG_ALRM_RSP",
    0x14: "CALL_ALRT",
    0x15: "CALL_ALRT_REQ",
    0x18: "REL_DEMAND",
    0x19: "LOC_BCAST",
    0x20: "SITE_BCAST",
    0x21: "STS_BCAST"
});

const ResponseType = Object.freeze({
    1: "GRANT",
    2: "REJECT",
    3: "DENY",
    4: "REFUSE",
    5: "FAIL",
    0xFF: "N/A"
});

let reports = [];
let sites = new Map();

async function fetchVoiceChannelData() {
    try {
        const networkDataPromises = config.networks.map(async (network) => {
            try {
                const response = await axios.get(`${network.url}/api/voiceChannel/query`);
                // console.log(response.data)
                return { name: network.name, data: response.data, status: 'connected' };
            } catch (error) {
                console.error(`Error fetching data from network ${network.name}:`, error);
                return { name: network.name, status: 'failed' };
            }
        });

        const networkData = await Promise.all(networkDataPromises);
        io.emit('networkUpdate', networkData);
    } catch (error) {
        //console.error('Error fetching voice channel data:', error);
    }
}

async function fetchAffiliationsData() {
    try {
        const networkDataPromises = config.networks.map(async (network) => {
            try {
                const response = await axios.get(`${network.url}/api/affiliations`);
                return { name: network.name, data: response.data, status: 'connected' };
            } catch (error) {
                console.error(`Error fetching affiliation data from network ${network.name}:`, error);
                return { name: network.name, status: 'failed' };
            }
        });

        const networkData = await Promise.all(networkDataPromises);
        io.emit('affiliationsUpdate', networkData);
    } catch (error) {
        //console.error('Error fetching affiliations data:', error);
    }
}

async function fetchAllData() {
    fetchVoiceChannelData();
    fetchAffiliationsData();
}

setInterval(fetchAllData, 1000);

app.get('/', (req, res) => {
    res.render('index', { networks: config.networks });
});

config.networks.forEach((network) => {
    const networkApp = express();
    const networkServer = http.createServer(networkApp);

    networkApp.use(express.json());

    networkApp.post('/', (req, res) => {
        // console.log(req.body);

        if ((!config.disableLocationBcast || req.body.Type !== 0x19) && req.body.Type !== 0x20 && req.body.Type !== 0x21) {
            reports.push(req.body);
            if (reports.length > 15) reports.shift();
            console.log(`${PacketTypes[req.body.Type]}, srcId: ${req.body.SrcId}, dstId: ${req.body.DstId}, ResponseType: ${ResponseType[req.body.ResponseType]}`);
        }

        if (req.body.Type === 0x20) { // 0x20 = site bcast
            if (!config.disableSiteBcast) {
                console.log(`Site Broadcast: Site Count: ${req.body.Sites.length}`);
            }

            req.body.Sites.forEach((site) => {
                const siteKey = `site-${site.SiteID}`;

                const existingSite = sites.get(siteKey);
                const updatedSite = {
                    ...site,
                    Status: existingSite ? existingSite.Status : "UP",
                };

                sites.set(siteKey, updatedSite);
            });

            sites.networkName = network.name;

            io.emit("site_update", Array.from(sites.values()));
        } else if (req.body.Type === 0x21) { // 0x21 = sts bcast
            const site = req.body.Site;
            const status = req.body.Status;

            const siteKey = `site-${site.SiteID}`;
            if (sites.has(siteKey)) {
                const existingSite = sites.get(siteKey);
                sites.set(siteKey, { ...existingSite, Status: status });
            } else {
                sites.set(siteKey, { ...site, Status: status });
            }

            console.log(`Status Update: ${site.Name} is ${status === 0 ? "DOWN" : status === 1 ? "UP" : "FAILSOFT"}`);

            sites.networkName = network.name;

            io.emit("site_update", Array.from(sites.values()));
        } else {
            req.body.networkName = network.name;

            io.emit("report", req.body);
        }

        res.status(200).send();
    });

    networkServer.listen(network.listenPort, network.bindAddress, () => {
        console.log(`Network listener for ${network.name} started on http://${network.bindAddress}:${network.listenPort}`);
    });
});

app.get('/reports', (req, res) => {
    res.render('reports', { reports, networks: config.networks, hideLocBcast: config.disableLocationBcastReports });
});

app.get('/affiliations', (req, res) => {
    res.render('affiliations', { networks: config.networks });
});

app.get('/map/:networkName', (req, res) => {
    const networkName = req.params.networkName;
    const network = config.networks.find(n => n.name === networkName);

    sites.networkName = req.params.networkName;

    if (!network) {
        return res.status(404).send('Network not found');
    }

    res.render('map', { network, networks: config.networks, sites: Array.from(sites.values()) });
});

server.listen(config.listenPort, config.bindAddress, () => {
    console.log(`Multi Watch started on http://${config.bindAddress}:${config.listenPort}`);
});