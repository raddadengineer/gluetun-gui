const express = require('express');
const cors = require('cors');
const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

// Hardcoded for local GUI, but perfectly limits unauthorized access
const JWT_SECRET = 'gluetun-gui-super-secret-key';
const ENV_PATH = path.join(__dirname, '.env');

// Initialize Docker instance
const docker = new Docker();

// Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    // Allow token to be passed via query string for Server-Sent Events (Logs)
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

    if (token == null) {
        console.error(`[Auth] No token provided for ${req.method} ${req.originalUrl}`);
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error(`[Auth] Token verification failed for ${req.method} ${req.originalUrl}:`, err.message);
            return res.status(403).json({ error: `Forbidden: ${err.message}` });
        }
        req.user = user;
        next();
    });
};

// Login Endpoint
app.post('/api/login', (req, res) => {
    const { password } = req.body;

    let expectedPassword = 'gluetun-admin';
    if (fs.existsSync(ENV_PATH)) {
        const data = fs.readFileSync(ENV_PATH, 'utf8');
        data.split('\n').forEach(line => {
            if (line.trim().startsWith('GUI_PASSWORD=')) {
                expectedPassword = line.split('=')[1].trim();
            }
        });
    }

    if (password === expectedPassword) {
        // Issue token valid for 24 hours
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, message: 'Authenticated Successfully' });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// All routes below require Authentication
app.get('/api/status', authenticateToken, async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = containers.find(c => c.Names.some(n => n.includes('gluetun')));

        if (!gluetun) {
            return res.status(404).json({ error: 'Gluetun container not found' });
        }

        const containerInfo = await docker.getContainer(gluetun.Id).inspect();

        res.json({
            status: containerInfo.State.Status,
            id: containerInfo.Id,
            env: containerInfo.Config.Env,
            image: containerInfo.Config.Image,
            startedAt: containerInfo.State.StartedAt
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/metrics', authenticateToken, async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = containers.find(c => c.Names.some(n => n.includes('gluetun')));

        if (!gluetun) {
            return res.status(404).json({ error: 'Gluetun container not found' });
        }

        const container = docker.getContainer(gluetun.Id);
        const stats = await container.stats({ stream: false });
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/restart', authenticateToken, async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = containers.find(c => c.Names.some(n => n.includes('gluetun')));

        if (!gluetun) {
            return res.status(404).json({ error: 'Gluetun container not found' });
        }

        const container = docker.getContainer(gluetun.Id);
        await container.restart();
        res.json({ message: 'Gluetun restarted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/stop', authenticateToken, async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = containers.find(c => c.Names.some(n => n.includes('gluetun')));

        if (!gluetun) {
            return res.status(404).json({ error: 'Gluetun container not found' });
        }

        const container = docker.getContainer(gluetun.Id);
        await container.stop();
        res.json({ message: 'Gluetun stopped successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/logs', authenticateToken, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let logStreams = [];

    try {
        const containers = await docker.listContainers({ all: true });
        
        const attachStream = async (containerName, prefix) => {
            const cInfo = containers.find(c => c.Names.some(n => n === `/${containerName}`));
            if (!cInfo) {
                res.write(`data: ${JSON.stringify(`[ERROR] ${containerName} container not found`)}\n\n`);
                return;
            }
            const container = docker.getContainer(cInfo.Id);
            const stream = await container.logs({ follow: true, stdout: true, stderr: true, tail: 100 });
            logStreams.push(stream);
            
            stream.on('data', (chunk) => {
                let payload = chunk;
                if (chunk.length >= 8 && chunk[0] <= 2) {
                    payload = chunk.slice(8);
                }
                const lines = payload.toString('utf8').split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        res.write(`data: ${JSON.stringify(`[${prefix}] ${line.replace(/\r/g, '')}`)}\n\n`);
                    }
                }
            });
        };

        await attachStream('gluetun', 'VPN');
        await attachStream('gluetun-gui', 'GUI');

        req.on('close', () => {
            logStreams.forEach(s => s.destroy());
        });
    } catch (err) {
        res.write(`data: ${JSON.stringify("[ERROR] " + err.message)}\n\n`);
    }
});

async function recreateGluetunContainer(newEnvObj) {
    const GLUETUN_ENV_PATH = '/gluetun.env';
    
    // Write the flat gluetun.env file
    const envLines = Object.entries(newEnvObj)
        .filter(([_, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(GLUETUN_ENV_PATH, envLines.join('\n') + '\n', 'utf8');

    // Recreate container via Dockerode
    const containers = await docker.listContainers({ all: true });
    const gluetunInfo = containers.find(c => c.Names.some(n => n.includes('gluetun') && !n.includes('gui')));
    
    if (gluetunInfo) {
        const oldContainer = docker.getContainer(gluetunInfo.Id);
        const inspectData = await oldContainer.inspect().catch(() => null);
        if (!inspectData) return 'Container inspect failed';

        await oldContainer.stop().catch(() => {});
        await oldContainer.remove().catch(() => {});

        const oldConfig = inspectData.Config;
        const hostConfig = inspectData.HostConfig;

        // Keep non-overlapping env vars from old container, add new ones
        const keysToReplace = new Set(Object.keys(newEnvObj));
        const filteredOldEnv = (oldConfig.Env || []).filter(e => !keysToReplace.has(e.split('=')[0]));
        const mergedEnv = [...filteredOldEnv, ...envLines];

        const createOpts = {
            name: inspectData.Name.replace(/^\//, ''),
            Image: oldConfig.Image,
            Env: mergedEnv,
            ExposedPorts: oldConfig.ExposedPorts,
            HostConfig: {
                ...hostConfig,
            },
            Labels: oldConfig.Labels,
        };

        const newContainer = await docker.createContainer(createOpts);
        await newContainer.start();
        return 'Gluetun recreated successfully.';
    }
    return 'Gluetun container not found. Restart via docker-compose required.';
}

app.get('/api/config', authenticateToken, (req, res) => {
    try {
        if (!fs.existsSync(ENV_PATH)) {
            return res.json({});
        }
        const data = fs.readFileSync(ENV_PATH, 'utf8');
        const config = {};
        data.split('\n').forEach(line => {
            if (line && line.includes('=')) {
                const parts = line.split('=');
                config[parts[0]] = parts.slice(1).join('=').trim();
            }
        });
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/config', authenticateToken, async (req, res) => {
    try {
        const config = req.body;
        let envContent = '';
        for (const [key, value] of Object.entries(config)) {
            if (value !== undefined && value !== null && value !== '') {
                envContent += `${key}=${value}\n`;
            }
        }
        // Save to GUI persistent .env
        fs.writeFileSync(ENV_PATH, envContent, 'utf8');
        
        // Exclude GUI-only keys from Gluetun environment
        const guiOnlyKeys = ['GUI_PASSWORD', 'PIA_USERNAME', 'PIA_PASSWORD', 'PIA_REGIONS', 'PIA_ROTATION_RETRIES', 'PIA_ROTATION_COUNT'];
        const gluetunEnv = { ...config };
        guiOnlyKeys.forEach(k => delete gluetunEnv[k]);
        
        // Map UI booleans to Gluetun ON/OFF flags
        Object.keys(gluetunEnv).forEach(k => {
           if (gluetunEnv[k] === 'true') gluetunEnv[k] = 'on';
           if (gluetunEnv[k] === 'false') gluetunEnv[k] = 'off';
        });

        // Gluetun requires custom provider for explicit WireGuard configs
        if (gluetunEnv.VPN_SERVICE_PROVIDER === 'private internet access' && gluetunEnv.VPN_TYPE === 'wireguard') {
            gluetunEnv.VPN_SERVICE_PROVIDER = 'custom';
        }

        // Recreate the container to apply changes immediately
        const msg = await recreateGluetunContainer(gluetunEnv);

        res.json({ message: `Settings saved to .env. ${msg}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PIA WireGuard Config Generation
let piaRefreshStatus = { state: 'idle', message: 'No generation attempted yet', lastGenerated: null, failCount: 0 };

app.get('/api/pia/status', authenticateToken, (req, res) => {
    res.json(piaRefreshStatus);
});

// Proxy PIA server list to avoid CORS issues in browser
app.get('/api/pia/regions', async (req, res) => {
    try {
        const https = require('https');
        const data = await new Promise((resolve, reject) => {
            https.get('https://serverlist.piaservers.net/vpninfo/servers/v6', (resp) => {
                let raw = '';
                resp.on('data', chunk => raw += chunk);
                resp.on('end', () => resolve(raw));
            }).on('error', reject);
        });
        const jsonStr = data.split('\n')[0];
        const parsed = JSON.parse(jsonStr);
        const regions = parsed.regions
            .filter(r => !r.offline)
            .map(r => ({ id: r.id, name: r.name, portForward: r.port_forward }))
            .sort((a, b) => a.name.localeCompare(b.name));
        res.json(regions);
    } catch (err) {
        console.error('[PIA-Regions] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch PIA regions' });
    }
});

app.post('/api/pia/generate', authenticateToken, async (req, res) => {
    const { PIA_USERNAME, PIA_PASSWORD, PIA_REGIONS, PIA_PORT_FORWARDING } = req.body;

    if (!PIA_USERNAME || !PIA_PASSWORD || !PIA_REGIONS) {
        return res.status(400).json({ error: 'PIA_USERNAME, PIA_PASSWORD, and at least one PIA_REGIONS are required.' });
    }

    const PIA_REGION = PIA_REGIONS.split(',')[0];

    piaRefreshStatus = { state: 'generating', message: 'Generating WireGuard config...', lastGenerated: null, failCount: 0 };

    const pfFlag = PIA_PORT_FORWARDING === 'true' ? ' -p' : '';
    const safeRegion = PIA_REGION.replace(/[^a-zA-Z0-9_-]/g, '');
    // pia-wg-config expects: pia-wg-config [flags] <username> <password>
    const cmd = `/usr/local/bin/pia-wg-config -o /config/wg0.conf -r ${safeRegion} -s -v${pfFlag} "${PIA_USERNAME}" "${PIA_PASSWORD}"`;

    console.log('[PIA-Generate] Running command:', cmd.replace(PIA_PASSWORD, '***'));

    try {
        const result = await new Promise((resolve, reject) => {
            exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
                console.log('[PIA-Generate] stdout:', stdout);
                console.log('[PIA-Generate] stderr:', stderr);
                if (error) {
                    reject(new Error(stderr || stdout || error.message));
                } else {
                    resolve(stdout + stderr);
                }
            });
        });

        // Parse the generated wg0.conf for WireGuard values
        let privateKey = '', address = '', endpoint = '', publicKey = '', serverName = null;
        try {
            if (fs.existsSync('/config/wg0.conf')) {
                const wgConf = fs.readFileSync('/config/wg0.conf', 'utf8');
                console.log('[PIA-Generate] Generated wg0.conf:', wgConf);

                const pkMatch = wgConf.match(/PrivateKey\s*=\s*(.+)/);
                if (pkMatch) privateKey = pkMatch[1].trim();

                const addrMatch = wgConf.match(/Address\s*=\s*(.+)/);
                if (addrMatch) address = addrMatch[1].trim();

                const epMatch = wgConf.match(/Endpoint\s*=\s*(.+)/);
                if (epMatch) endpoint = epMatch[1].trim();

                const pubMatch = wgConf.match(/PublicKey\s*=\s*(.+)/);
                if (pubMatch) publicKey = pubMatch[1].trim();

                const serverMatch = wgConf.match(/#\s*Server:\s*(.+)/);
                if (serverMatch) serverName = serverMatch[1].trim();
            }
        } catch (e) {
            console.error('[PIA-Generate] Error parsing wg0.conf:', e.message);
        }

        if (!privateKey) {
            throw new Error('Failed to parse PrivateKey from generated wg0.conf. The file may be corrupted.');
        }

        // Parse endpoint into IP and port
        let endpointIP = '', endpointPort = '1337';
        if (endpoint) {
            const epParts = endpoint.split(':');
            endpointIP = epParts[0];
            if (epParts[1]) endpointPort = epParts[1];
        }

        // Write Gluetun env file with parsed WireGuard values
        const GLUETUN_ENV_PATH = '/gluetun.env';
        const gluetunEnv = [
            'VPN_SERVICE_PROVIDER=custom',
            'VPN_TYPE=wireguard',
            `WIREGUARD_PRIVATE_KEY=${privateKey}`,
            `WIREGUARD_ADDRESSES=${address}`,
            `VPN_ENDPOINT_IP=${endpointIP}`,
            `VPN_ENDPOINT_PORT=${endpointPort}`,
            `WIREGUARD_PUBLIC_KEY=${publicKey}`,
        ].join('\n') + '\n';

        fs.writeFileSync(GLUETUN_ENV_PATH, gluetunEnv, 'utf8');
        console.log('[PIA-Generate] Wrote gluetun.env:', gluetunEnv);

        // Save PIA credentials to GUI .env for persistence
        let envVars = {};
        if (fs.existsSync(ENV_PATH)) {
            const data = fs.readFileSync(ENV_PATH, 'utf8');
            data.split('\n').forEach(line => {
                if (line && line.includes('=')) {
                    const parts = line.split('=');
                    envVars[parts[0]] = parts.slice(1).join('=').trim();
                }
            });
        }
        envVars.PIA_USERNAME = PIA_USERNAME;
        envVars.PIA_PASSWORD = PIA_PASSWORD;
        envVars.PIA_REGIONS = PIA_REGIONS;
        envVars.PIA_REGION_INDEX = '0';
        envVars.PIA_PORT_FORWARDING = PIA_PORT_FORWARDING || 'false';
        envVars.VPN_SERVICE_PROVIDER = 'private internet access';
        envVars.VPN_TYPE = 'wireguard';
        if (serverName) envVars.SERVER_NAMES = serverName;

        let newEnv = '';
        for (const [k, v] of Object.entries(envVars)) {
            newEnv += `${k}=${v}\n`;
        }
        fs.writeFileSync(ENV_PATH, newEnv, 'utf8');

        // Recreate Gluetun container with new WireGuard env vars via Dockerode
        const newEnvArray = [
            'VPN_SERVICE_PROVIDER=custom',
            'VPN_TYPE=wireguard',
            `WIREGUARD_PRIVATE_KEY=${privateKey}`,
            `WIREGUARD_ADDRESSES=${address}`,
            `VPN_ENDPOINT_IP=${endpointIP}`,
            `VPN_ENDPOINT_PORT=${endpointPort}`,
            `WIREGUARD_PUBLIC_KEY=${publicKey}`,
        ];

        let restartMsg = '';
        try {
            const containers = await docker.listContainers({ all: true });
            const gluetunInfo = containers.find(c => c.Names.some(n => n.includes('gluetun') && !n.includes('gui')));
            if (gluetunInfo) {
                const oldContainer = docker.getContainer(gluetunInfo.Id);
                const inspectData = await oldContainer.inspect();

                // Stop and remove old container
                await oldContainer.stop().catch(() => { });
                await oldContainer.remove().catch(() => { });

                // Rebuild config from inspected container, replacing env vars
                const oldConfig = inspectData.Config;
                const hostConfig = inspectData.HostConfig;

                // Merge: keep non-VPN/WG env vars from old config, add new VPN ones
                const keysToReplace = new Set(newEnvArray.map(e => e.split('=')[0]));
                const filteredOldEnv = (oldConfig.Env || []).filter(e => !keysToReplace.has(e.split('=')[0]));
                const mergedEnv = [...filteredOldEnv, ...newEnvArray];

                const createOpts = {
                    name: inspectData.Name.replace(/^\//, ''),
                    Image: oldConfig.Image,
                    Env: mergedEnv,
                    ExposedPorts: oldConfig.ExposedPorts,
                    HostConfig: {
                        ...hostConfig,
                        // Preserve existing mounts, port bindings, cap_add, devices
                    },
                    Labels: oldConfig.Labels,
                };

                const newContainer = await docker.createContainer(createOpts);
                await newContainer.start();
                restartMsg = ' Gluetun recreated with new WireGuard config.';
                console.log('[PIA-Generate] Gluetun container recreated successfully');
            } else {
                restartMsg = ' Warning: Gluetun container not found.';
            }
        } catch (restartErr) {
            console.error('[PIA-Generate] Gluetun recreate failed:', restartErr.message);
            restartMsg = ' Note: Please manually run "docker compose up -d gluetun" on the host to apply the new config.';
        }

        piaRefreshStatus = {
            state: 'success',
            message: `Config generated (key: ...${privateKey.slice(-8)})${serverName ? ` server: ${serverName}` : ''}.${restartMsg}`,
            lastGenerated: new Date().toISOString(),
            failCount: 0
        };

        res.json({
            message: `WireGuard config generated!${restartMsg} Private key and endpoint written to Gluetun env.`,
            serverName,
            generatedAt: piaRefreshStatus.lastGenerated
        });
    } catch (err) {
        piaRefreshStatus = {
            state: 'error',
            message: err.message,
            lastGenerated: null,
            failCount: piaRefreshStatus.failCount + 1
        };
        res.status(500).json({ error: 'Config generation failed: ' + err.message });
    }
});

// Serve React App in Production
const distPath = path.join(__dirname, 'public');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.use((req, res) => {
        if (!req.path.startsWith('/api/')) {
            res.sendFile(path.join(distPath, 'index.html'));
        } else {
            res.status(404).json({ error: 'API route not found' });
        }
    });
}

// Background PIA-Refresh Checker
let failCount = 0;
const FAIL_THRESHOLD = 3;
const CHECK_INTERVAL = 60 * 1000;
const HEALTHY_CHECK_INTERVAL = 30 * 60 * 1000;

async function executeFailoverRotation() {
    let envVars = {};
    if (fs.existsSync(ENV_PATH)) {
        const data = fs.readFileSync(ENV_PATH, 'utf8');
        data.split('\n').forEach(line => {
            if (line && line.includes('=')) {
                const parts = line.split('=');
                envVars[parts[0]] = parts.slice(1).join('=').trim();
            }
        });
    }

    const { PIA_USERNAME, PIA_PASSWORD, PIA_REGIONS, VPN_TYPE, PIA_PORT_FORWARDING } = envVars;
    if (!PIA_USERNAME || !PIA_PASSWORD || !PIA_REGIONS) {
        throw new Error('Missing PIA credentials or regions for failover.');
    }

    const regions = PIA_REGIONS.split(',').filter(Boolean);
    if (regions.length === 0) throw new Error('No regions configured.');

    let idx = parseInt(envVars.PIA_REGION_INDEX || '0', 10);
    idx = (idx + 1) % regions.length;
    envVars.PIA_REGION_INDEX = idx.toString();
    const targetRegion = regions[idx];

    let newEnvContent = '';
    for (const [k, v] of Object.entries(envVars)) {
        newEnvContent += `${k}=${v}\n`;
    }
    fs.writeFileSync(ENV_PATH, newEnvContent, 'utf8');

    console.log(`[Failover] Rotating to region: ${targetRegion} (Index: ${idx})`);

    const guiOnlyKeys = ['GUI_PASSWORD', 'PIA_USERNAME', 'PIA_PASSWORD', 'PIA_REGIONS', 'PIA_ROTATION_RETRIES', 'PIA_ROTATION_COUNT', 'PIA_REGION_INDEX'];
    const gluetunEnv = { ...envVars };
    guiOnlyKeys.forEach(k => delete gluetunEnv[k]);
    Object.keys(gluetunEnv).forEach(k => {
        if (gluetunEnv[k] === 'true') gluetunEnv[k] = 'on';
        if (gluetunEnv[k] === 'false') gluetunEnv[k] = 'off';
    });

    if (VPN_TYPE === 'wireguard' || !VPN_TYPE) {
        const pfFlag = PIA_PORT_FORWARDING === 'true' ? ' -p' : '';
        const safeRegion = targetRegion.replace(/[^a-zA-Z0-9_-]/g, '');
        const cmd = `/usr/local/bin/pia-wg-config -o /config/wg0.conf -r ${safeRegion} -s -v${pfFlag} "${PIA_USERNAME}" "${PIA_PASSWORD}"`;
        
        await new Promise((resolve, reject) => {
            exec(cmd, { timeout: 45000 }, (error, stdout, stderr) => {
                if (error) reject(new Error(stderr || stdout || error.message));
                else resolve(stdout + stderr);
            });
        });

        if (fs.existsSync('/config/wg0.conf')) {
            const wgConf = fs.readFileSync('/config/wg0.conf', 'utf8');
            const pkMatch = wgConf.match(/PrivateKey\s*=\s*(.+)/);
            if (pkMatch) gluetunEnv.WIREGUARD_PRIVATE_KEY = pkMatch[1].trim();

            const addrMatch = wgConf.match(/Address\s*=\s*(.+)/);
            if (addrMatch) gluetunEnv.WIREGUARD_ADDRESSES = addrMatch[1].trim();

            const epMatch = wgConf.match(/Endpoint\s*=\s*(.+)/);
            if (epMatch) {
                const epParts = epMatch[1].trim().split(':');
                gluetunEnv.VPN_ENDPOINT_IP = epParts[0];
                if (epParts[1]) gluetunEnv.VPN_ENDPOINT_PORT = epParts[1];
            }

            const pubMatch = wgConf.match(/PublicKey\s*=\s*(.+)/);
            if (pubMatch) gluetunEnv.WIREGUARD_PUBLIC_KEY = pubMatch[1].trim();

            gluetunEnv.VPN_SERVICE_PROVIDER = 'custom';
            gluetunEnv.VPN_TYPE = 'wireguard';
        }
    } else if (VPN_TYPE === 'openvpn') {
        gluetunEnv.SERVER_REGIONS = targetRegion;
    }

    return await recreateGluetunContainer(gluetunEnv);
}

app.post('/api/test-failover', authenticateToken, async (req, res) => {
    try {
        const result = await executeFailoverRotation();
        res.json({ message: 'Rotation executed successfully: ' + result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function checkVPN() {
    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = containers.find(c => c.Names.some(n => n.includes('gluetun') && !n.includes('gui')));
        if (!gluetun) return setTimeout(checkVPN, CHECK_INTERVAL);

        const container = docker.getContainer(gluetun.Id);
        const execContext = await container.exec({
            Cmd: ['sh', '-c', 'curl -s http://127.0.0.1:8000/v1/publicip/ip || echo "curl_failed"'],
            AttachStdout: true,
            AttachStderr: true
        });

        const stream = await execContext.start({ hijack: true, stdin: true });
        let output = await new Promise((resolve) => {
            let data = '';
            stream.on('data', chunk => {
                const payload = chunk.length >= 8 && chunk[0] <= 2 ? chunk.slice(8) : chunk;
                data += payload.toString('utf8');
            });
            stream.on('end', () => resolve(data.trim()));
        });

        if (output && output.includes('public_ip')) {
            failCount = 0;
            return setTimeout(checkVPN, HEALTHY_CHECK_INTERVAL);
        } else {
            failCount++;
        }
    } catch (err) {
        failCount++;
    }

    if (failCount >= FAIL_THRESHOLD) {
        console.log(`[PIA-Refresh] VPN failed ${failCount} times. Executing Auto-Failover Rotation...`);
        try {
            await executeFailoverRotation();
            failCount = 0;
        } catch (err) {
            console.error('[PIA-Refresh] Auto-Failover error:', err.message);
        }
    }
    setTimeout(checkVPN, CHECK_INTERVAL);
}

// Start checker after a short delay
setTimeout(checkVPN, 15000);

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Gluetun GUI API server running on http://localhost:${PORT}`);
});
