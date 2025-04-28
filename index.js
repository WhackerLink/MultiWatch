/*
 * Copyright (C) 2024-2025 Caleb H. (K4PHP) caleb.k4php@gmail.com
 *
 * This file is part of the WhackerLink MultiWatch project.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
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
const __dirname  = path.dirname(__filename);

const app     = express();
const server  = http.createServer(app);
const io      = new Server(server);

const cfgIndex = process.argv.indexOf('-c');
if (cfgIndex === -1 || process.argv.length <= cfgIndex + 1) {
    console.error('Usage: node multiwatch.js -c config.yml');
    process.exit(1);
}
const configPath = process.argv[cfgIndex + 1];
const config     = yaml.load(fs.readFileSync(configPath, 'utf8'));

const restMap = config.restServers.reduce((m, rs) => {
    m[rs.name] = rs.url;
    return m;
}, {});

app.set('views',   path.join(__dirname, 'views'));
app.set('view engine','ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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
let sites   = new Map();

function makeUrl(network, endpointPath) {
    const base = restMap[network.restServer];
    if (!base) throw new Error(`Unknown restServer: ${network.restServer}`);
    const masterSegment = encodeURIComponent(network.name);
    return `${base}/api/${masterSegment}${endpointPath}`;
}

async function fetchVoiceChannelData() {
    const promises = config.networks.map(async net => {
        try {
            const url = makeUrl(net, '/voiceChannel/query');
            const res = await axios.get(url);
            return { name: net.name, data: res.data, status: 'connected' };
        } catch (e) {
            console.error(`voiceChannel fetch failed for ${net.name}:`, e.message);
            return { name: net.name, status: 'failed' };
        }
    });
    const all = await Promise.all(promises);
    io.emit('networkUpdate', all);
}

async function fetchAffiliationsData() {
    const promises = config.networks.map(async net => {
        try {
            const url = makeUrl(net, '/affiliations');
            const res = await axios.get(url);
            return { name: net.name, data: res.data, status: 'connected' };
        } catch (e) {
            console.error(`affiliations fetch failed for ${net.name}:`, e.message);
            return { name: net.name, status: 'failed' };
        }
    });
    const all = await Promise.all(promises);
    io.emit('affiliationsUpdate', all);
}

async function fetchAllData() {
    await Promise.all([
        fetchVoiceChannelData(),
        fetchAffiliationsData()
    ]);
}

async function sendCommand(cmd, payload, networkName) {
    const net = config.networks.find(n => n.name === networkName);
    if (!net) {
        console.error(`Unknown network: ${networkName}`);
        return io.emit('networkUpdate', { network: networkName, success: false });
    }

    try {
        const url = makeUrl(net, `/command/${cmd}`);
        const res = await axios.post(url, payload);
        io.emit('networkUpdate', { network: net.name, success: res.data.success });
    } catch (e) {
        console.error(`Error ${cmd} on ${net.name}:`, e.message);
        io.emit('networkUpdate', { network: net.name, success: false });
    }
}

setInterval(fetchAllData, 1000);

app.get('/',            (req, res) => res.render('index',        { networks: config.networks }));
app.get('/reports',     (req, res) => res.render('reports',      { reports, networks: config.networks, hideLocBcast: config.disableLocationBcastReports }));
app.get('/affiliations',(req, res) => res.render('affiliations', { networks: config.networks }));
app.get('/map/:networkName', (req, res) => {
    const net = config.networks.find(n => n.name === req.params.networkName);
    if (!net) return res.status(404).send('Network not found');
    sites.networkName = net.name;
    res.render('map', { network: net, networks: config.networks, sites: Array.from(sites.values()) });
});

config.networks.forEach(net => {
    const subApp    = express();
    const subServer = http.createServer(subApp);
    subApp.use(express.json());

    subApp.post('/', (req, res) => {
        const p = req.body;
        if ((!config.disableLocationBcast || p.Type !== 0x19) && p.Type !== 0x20 && p.Type !== 0x21) {
            reports.push(p);
            if (reports.length > 15) reports.shift();
            console.log(`${PacketTypes[p.Type]}, src:${p.SrcId}, dst:${p.DstId}, resp:${ResponseType[p.ResponseType]}`);
        }

        if (p.Type === 0x20) {
            if (!config.disableSiteBcast)
                console.log(`Site BCAST: count=${p.Sites.length}`);
            p.Sites.forEach(site => {
                const key = `site-${site.SiteID}`;
                const prev = sites.get(key);
                sites.set(key, { ...site, Status: prev?.Status ?? 'UP' });
            });
            sites.networkName = net.name;
            io.emit('site_update', Array.from(sites.values()));

        } else if (p.Type === 0x21) {
            const key = `site-${p.Site.SiteID}`;
            const prev = sites.get(key) || p.Site;
            sites.set(key, { ...prev, Status: p.Status });
            console.log(`Status ${p.Site.Name} is ${p.Status===0?'DOWN':p.Status===1?'UP':'FAIL'}`);
            sites.networkName = net.name;
            io.emit('site_update', Array.from(sites.values()));
        } else {
            p.networkName = net.name;
            io.emit('report', p);
        }

        res.sendStatus(200);
    });

    subServer.listen(net.listenPort, net.bindAddress, () => {
        console.log(`Listening for ${net.name} on ${net.bindAddress}:${net.listenPort}`);
    });
});

server.listen(config.listenPort, config.bindAddress, () => {
    console.log(`Multi Watch UI on http://${config.bindAddress}:${config.listenPort}`);
});

io.on('connection', sock => {
    sock.on('inhibit',   ({ dstId, network }) => sendCommand('inhibit',   { DstId: dstId }, network));
    sock.on('uninhibit', ({ dstId, network }) => sendCommand('uninhibit', { DstId: dstId }, network));
});
