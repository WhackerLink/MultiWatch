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
    0: "UNKOWN",
    1: "AUDIO_DATA",
    2: "GRP_AFF_REQ",
    3: "GRP_AFF_RSP",
    4: "AFF_UPDATE",
    5: "GRP_VCH_REQ",
    6: "GRP_VCH_RLS",
    7: "GRP_VCH_RSP",
    8: "U_REG_REQ",
    9: "U_REG_RSP",
    10: "U_DE_REG_REQ",
    11: "U_DE_REG_RSP",
    12: "EMRG_ALRM_REQ",
    13: "EMRG_ALRM_RSP",
    14: "CALL_ALRT",
    15: "CALL_ALRT_REQ"
});

const ResponseType = Object.freeze({
    1: "GRANT",
    2: "REJECT",
    3: "DENY",
    4: "REFUSE",
    5: "FAIL",
    0xFF: "N/A"
});

async function fetchVoiceChannelData() {
    try {
        const networkDataPromises = config.networks.map(async (network) => {
            try {
                const response = await axios.get(`${network.url}/api/voiceChannel/query`);
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

app.post('/', (req, res) => {
    // console.log(req.body);
    console.log(`${PacketTypes[req.body.Type]}, srcId: ${req.body.SrcId}, dstId: ${req.body.DstId}, ResponseType: ${ResponseType[req.body.ResponseType]}`);
    io.emit("report", req.body);
    res.status(200).send();
});

app.get('/reports', (req, res) => {
    res.render('reports', { ResponseType, PacketTypes });
});

app.get('/affiliations', (req, res) => {
    res.render('affiliations');
});

server.listen(config.listenPort, config.bindAddress, () => {
    console.log(`Multi Watch started on http://${config.bindAddress}:${config.listenPort}`);
});