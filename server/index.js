const express = require('express');
const cors = require('cors');
const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

// Hardcoded for local GUI, but perfectly limits unauthorized access
const JWT_SECRET = 'gluetun-gui-super-secret-key';

// ─── Data Directory ───────────────────────────────────────────────────────────
// DATA_DIR env var centralises all persistent state under one folder.
// Falls back to legacy paths for backward compatibility.
const DATA_DIR = process.env.DATA_DIR || null;
if (DATA_DIR && !fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[Init] Created data directory: ${DATA_DIR}`);
}

const ENV_PATH = DATA_DIR
    ? path.join(DATA_DIR, 'gui-config.env')
    : path.join(__dirname, '.env');
const SESSIONS_PATH = DATA_DIR
    ? path.join(DATA_DIR, 'sessions.json')
    : path.join(__dirname, 'sessions.json');
const GLUETUN_ENV_PATH = DATA_DIR
    ? path.join(DATA_DIR, 'gluetun.env')
    : '/gluetun.env';
const WG_CONFIG_DIR = DATA_DIR
    ? path.join(DATA_DIR, 'wireguard')
    : '/config';
if (DATA_DIR && !fs.existsSync(WG_CONFIG_DIR)) {
    fs.mkdirSync(WG_CONFIG_DIR, { recursive: true });
}

// Migrate legacy files into DATA_DIR if they exist
if (DATA_DIR) {
    const legacyEnv = path.join(__dirname, '.env');
    if (fs.existsSync(legacyEnv) && !fs.existsSync(ENV_PATH)) {
        fs.copyFileSync(legacyEnv, ENV_PATH);
        console.log('[Init] Migrated legacy .env → gui-config.env');
    }
    const legacySessions = path.join(__dirname, 'sessions.json');
    if (fs.existsSync(legacySessions) && !fs.existsSync(SESSIONS_PATH)) {
        fs.copyFileSync(legacySessions, SESSIONS_PATH);
        console.log('[Init] Migrated legacy sessions.json');
    }
}

console.log(`[Init] ENV_PATH: ${ENV_PATH}`);
console.log(`[Init] SESSIONS_PATH: ${SESSIONS_PATH}`);
console.log(`[Init] GLUETUN_ENV_PATH: ${GLUETUN_ENV_PATH}`);
console.log(`[Init] WG_CONFIG_DIR: ${WG_CONFIG_DIR}`);

// ─── Session Tracking ─────────────────────────────────────────────────────────
let sessions = [];
let currentSession = null;
let lastKnownContainerId = null;
// baselines: { tun0: { rx, tx }, eth0: { rx, tx } } at session start
let sessionBaselines = {};

function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_PATH)) {
            sessions = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
            // Keep last 100 sessions
            if (sessions.length > 100) sessions = sessions.slice(-100);
            // Find any previously active session and mark it ended (server restart)
            sessions = sessions.map(s => s.active ? { ...s, active: false, endedAt: s.endedAt || new Date().toISOString() } : s);
            saveSessions();
        }
    } catch (e) {
        console.error('[Sessions] Failed to load sessions.json:', e.message);
        sessions = [];
    }
}

function saveSessions() {
    try {
        fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2), 'utf8');
    } catch (e) {
        console.error('[Sessions] Failed to save sessions.json:', e.message);
    }
}

function startNewSession(containerId, startedAt, envVars) {
    // Close previous session
    if (currentSession) {
        currentSession.active = false;
        currentSession.endedAt = new Date().toISOString();
    }

    currentSession = {
        id: `sess_${Date.now()}`,
        containerId,
        startedAt: startedAt || new Date().toISOString(),
        endedAt: null,
        active: true,
        provider: envVars.VPN_SERVICE_PROVIDER || 'unknown',
        vpnType: envVars.VPN_TYPE || 'wireguard',
        region: envVars.SERVER_COUNTRIES || envVars.SERVER_REGIONS || envVars.SERVER_NAMES || 'auto',
        // interface-level bytes delta (filled by updateCurrentSession)
        interfaces: {}
    };

    sessions.push(currentSession);
    sessionBaselines = {}; // reset baselines for new session
    saveSessions();
    console.log(`[Sessions] New session started: ${currentSession.id}`);
}

async function updateCurrentSession(networks) {
    if (!currentSession) return;
    
    if (networks) {
        const ifaces = Object.keys(networks);
        ifaces.forEach(iface => {
            const net = networks[iface];
            if (!sessionBaselines[iface]) {
                sessionBaselines[iface] = { rx: net.rx_bytes, tx: net.tx_bytes };
            }
            const rxDelta = Math.max(0, net.rx_bytes - sessionBaselines[iface].rx);
            const txDelta = Math.max(0, net.tx_bytes - sessionBaselines[iface].tx);
            currentSession.interfaces[iface] = { rx: rxDelta, tx: txDelta };
        });
    }

    if (!currentSession.publicIp || !currentSession.serverIp || currentSession.location === 'auto') {
        try {
            const containers = await docker.listContainers({ all: true });
            const gluetun = containers.find(c => c.Names.some(n => n.includes('gluetun')));
            if (gluetun) {
                const logsStream = await docker.getContainer(gluetun.Id).logs({ follow: false, stdout: true, stderr: true, tail: 300 });
                const logs = logsStream.toString('utf8');
                
                const serverMatches = logs.match(/Connecting to ([\d\.]+)/g);
                if (serverMatches) {
                    const lastServer = serverMatches[serverMatches.length - 1];
                    currentSession.serverIp = lastServer.match(/Connecting to ([\d\.]+)/)[1];
                }
                
                const ipMatches = logs.match(/Public IP address is ([\d\.]+) \((.*?)\s*-\s*source:/g);
                if (ipMatches) {
                    const lastIpLog = ipMatches[ipMatches.length - 1];
                    const ipExtracted = lastIpLog.match(/Public IP address is ([\d\.]+) \((.*?)\s*-\s*source:/);
                    if (ipExtracted) {
                        currentSession.publicIp = ipExtracted[1];
                        currentSession.location = ipExtracted[2].trim();
                    }
                }
            }
        } catch (e) {
            console.error('[Sessions] Error parsing gluetun logs:', e.message);
        }
    }

    // Throttle saves: only write every ~30s
    const now = Date.now();
    if (!currentSession._lastSave || now - currentSession._lastSave > 30000) {
        currentSession._lastSave = now;
        saveSessions();
    }
}

// Load persisted sessions on startup
loadSessions();

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

        // ── Session tracking: detect new container (restart/recreate) ──
        if (containerInfo.State.Status === 'running' && containerInfo.Id !== lastKnownContainerId) {
            lastKnownContainerId = containerInfo.Id;
            const envVars = {};
            (containerInfo.Config.Env || []).forEach(e => {
                const [k, ...rest] = e.split('=');
                envVars[k] = rest.join('=');
            });
            startNewSession(containerInfo.Id, containerInfo.State.StartedAt, envVars);
        }

        res.json({
            status: containerInfo.State.Status,
            id: containerInfo.Id,
            env: containerInfo.Config.Env,
            image: containerInfo.Config.Image,
            startedAt: containerInfo.State.StartedAt,
            currentSession
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

        // Update session bandwidth accounting with per-interface data and IP checking
        await updateCurrentSession(stats.networks);

        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Session History API ────────────────────────────────────────────────────────
app.get('/api/sessions', authenticateToken, (req, res) => {
    // Return sessions newest-first, strip internal _lastSave field
    const clean = [...sessions].reverse().map(({ _lastSave, ...s }) => s);
    res.json(clean);
});

app.delete('/api/sessions/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    if (currentSession && currentSession.id === id) {
        return res.status(400).json({ error: 'Cannot delete the active session.' });
    }
    sessions = sessions.filter(s => s.id !== id);
    saveSessions();
    res.json({ message: 'Session deleted.' });
});

app.delete('/api/sessions', authenticateToken, (req, res) => {
    // Clear all except the active one
    sessions = currentSession ? [currentSession] : [];
    saveSessions();
    res.json({ message: 'Session history cleared.' });
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
    // Write the flat gluetun.env backup file
    const envLines = Object.entries(newEnvObj)
        .filter(([_, v]) => v !== undefined && v !== null && v.toString().trim() !== '' && v !== 'undefined')
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
        let filteredOldEnv = (oldConfig.Env || []).filter(e => !keysToReplace.has(e.split('=')[0]));

        // Drop server params from old config if they were not explicitly passed in the new config
        // NOTE: SERVER_NAMES is preserved if passed in newEnvObj to support PIA custom port forwarding
        const serverParams = ['SERVER_COUNTRIES', 'SERVER_REGIONS', 'SERVER_CITIES', 'SERVER_HOSTNAMES'];
        serverParams.forEach(k => {
            if (!newEnvObj[k]) filteredOldEnv = filteredOldEnv.filter(e => e.split('=')[0] !== k);
        });
        if (!newEnvObj['SERVER_NAMES']) {
            filteredOldEnv = filteredOldEnv.filter(e => e.split('=')[0] !== 'SERVER_NAMES');
        }

        // Drop irrelevant protocol parameters
        if (newEnvObj.VPN_TYPE === 'wireguard') {
            filteredOldEnv = filteredOldEnv.filter(e => !e.split('=')[0].startsWith('OPENVPN_'));
        } else if (newEnvObj.VPN_TYPE === 'openvpn') {
            filteredOldEnv = filteredOldEnv.filter(e => !e.split('=')[0].startsWith('WIREGUARD_'));
        }

        // Drop legacy mullvad and prep GODEBUG for old Go CN certificate support
        filteredOldEnv = filteredOldEnv.map(e => {
            if (e.startsWith('DNS_UPSTREAM_RESOLVERS=') || e.startsWith('DOT_PROVIDERS=')) {
                return e.split('=')[0] + '=' + e.split('=')[1].split(',').map(s => s.trim().toLowerCase() === 'mullvad' ? 'quad9' : s).join(',');
            }
            return e;
        }).filter(e => !e.startsWith('GODEBUG='));

        const mergedEnv = [...filteredOldEnv, ...envLines, 'GODEBUG=x509ignoreCN=0'];

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

        // Migrate deprecated env var names to current Gluetun equivalents before sending to GUI
        const deprecatedMap = {
            'VPN_ENDPOINT_IP':    config.VPN_TYPE === 'openvpn' ? 'OPENVPN_ENDPOINT_IP'    : 'WIREGUARD_ENDPOINT_IP',
            'VPN_ENDPOINT_PORT':  config.VPN_TYPE === 'openvpn' ? 'OPENVPN_ENDPOINT_PORT'  : 'WIREGUARD_ENDPOINT_PORT',
            'DOT_PROVIDERS':      'DNS_UPSTREAM_RESOLVERS',
            'DNS_ADDRESS':        'DNS_UPSTREAM_PLAIN_ADDRESSES',
            'DOT_CACHING':        'DNS_CACHING',
        };
        let didMigrate = false;
        Object.entries(deprecatedMap).forEach(([oldKey, newKey]) => {
            if (config[oldKey]) {
                if (!config[newKey]) config[newKey] = config[oldKey];
                delete config[oldKey];
                didMigrate = true;
            }
        });

        // Ensure DNS_UPSTREAM_PLAIN_ADDRESSES has port suffix
        if (config.DNS_UPSTREAM_PLAIN_ADDRESSES) {
            const fixed = config.DNS_UPSTREAM_PLAIN_ADDRESSES
                .split(',')
                .map(ip => ip.trim())
                .filter(Boolean)
                .map(ip => ip.match(/^(\d{1,3}\.){3}\d{1,3}$/) ? `${ip}:53` : ip)
                .join(',');
            if (fixed !== config.DNS_UPSTREAM_PLAIN_ADDRESSES) {
                config.DNS_UPSTREAM_PLAIN_ADDRESSES = fixed;
                didMigrate = true;
            }
        }

        // Clean spaces and migrate deprecated mullvad DOT provider
        if (config.DNS_UPSTREAM_RESOLVERS) {
            const fixed = config.DNS_UPSTREAM_RESOLVERS
                .split(',')
                .map(s => s.trim())
                .filter(Boolean)
                .map(s => s.toLowerCase() === 'mullvad' ? 'quad9' : s)
                .filter((s, idx, arr) => arr.indexOf(s) === idx)
                .join(',');
            if (fixed !== config.DNS_UPSTREAM_RESOLVERS) {
                config.DNS_UPSTREAM_RESOLVERS = fixed;
                didMigrate = true;
            }
        }

        // Persist migrated values back to .env so Gluetun never sees stale/deprecated vars
        if (didMigrate) {
            let newEnv = '';
            for (const [k, v] of Object.entries(config)) {
                if (v !== undefined && v !== null && v.toString().trim() !== '') {
                    newEnv += `${k}=${v}\n`;
                }
            }
            fs.writeFileSync(ENV_PATH, newEnv, 'utf8');
            console.log('[Config] Migrated deprecated env vars and persisted to .env');
        }

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
            if (value !== undefined && value !== null && value.toString().trim() !== '' && value !== 'undefined') {
                envContent += `${key}=${value}\n`;
            }
        }
        // Save to GUI persistent .env
        fs.writeFileSync(ENV_PATH, envContent, 'utf8');
        
        // Exclude GUI-only keys from Gluetun environment
        const guiOnlyKeys = ['GUI_PASSWORD', 'PIA_USERNAME', 'PIA_PASSWORD', 'PIA_REGIONS', 'PIA_WG_REGIONS', 'PIA_OPENVPN_REGIONS', 'PIA_ROTATION_RETRIES', 'PIA_ROTATION_COUNT', 'PIA_REGION_INDEX'];
        const gluetunEnv = { ...config };
        guiOnlyKeys.forEach(k => delete gluetunEnv[k]);

        // Drop any empty string configurations to prevent container faults
        Object.keys(gluetunEnv).forEach(k => {
            const val = gluetunEnv[k];
            if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) {
                delete gluetunEnv[k];
            }
        });
        
        // Map UI booleans to Gluetun ON/OFF flags
        Object.keys(gluetunEnv).forEach(k => {
           if (gluetunEnv[k] === 'true') gluetunEnv[k] = 'on';
           if (gluetunEnv[k] === 'false') gluetunEnv[k] = 'off';
        });

        // Migrate deprecated env var names to current Gluetun equivalents
        const deprecatedMap = {
            'VPN_ENDPOINT_IP':    gluetunEnv.VPN_TYPE === 'openvpn' ? 'OPENVPN_ENDPOINT_IP'    : 'WIREGUARD_ENDPOINT_IP',
            'VPN_ENDPOINT_PORT':  gluetunEnv.VPN_TYPE === 'openvpn' ? 'OPENVPN_ENDPOINT_PORT'  : 'WIREGUARD_ENDPOINT_PORT',
            'DOT_PROVIDERS':      'DNS_UPSTREAM_RESOLVERS',
            'DNS_ADDRESS':        'DNS_UPSTREAM_PLAIN_ADDRESSES',
            'DOT_CACHING':        'DNS_CACHING',
        };
        Object.entries(deprecatedMap).forEach(([oldKey, newKey]) => {
            if (gluetunEnv[oldKey] && !gluetunEnv[newKey]) {
                gluetunEnv[newKey] = gluetunEnv[oldKey];
            }
            delete gluetunEnv[oldKey];
        });

        // Ensure plain DNS addresses contain a port
        if (gluetunEnv.DNS_UPSTREAM_PLAIN_ADDRESSES) {
            gluetunEnv.DNS_UPSTREAM_PLAIN_ADDRESSES = gluetunEnv.DNS_UPSTREAM_PLAIN_ADDRESSES
                .split(',')
                .map(ip => ip.trim())
                .map(ip => {
                    // Append :53 if it's an IPv4 address without a port
                    if (ip && ip.match(/^(\d{1,3}\.){3}\d{1,3}$/)) {
                        return `${ip}:53`;
                    }
                    return ip;
                })
                .join(',');
        }

        // Clean spaces and drop discontinued mullvad string
        if (gluetunEnv.DNS_UPSTREAM_RESOLVERS) {
            gluetunEnv.DNS_UPSTREAM_RESOLVERS = gluetunEnv.DNS_UPSTREAM_RESOLVERS
                .split(',')
                .map(s => s.trim())
                .filter(Boolean)
                .map(s => s.toLowerCase() === 'mullvad' ? 'quad9' : s)
                .filter((s, idx, arr) => arr.indexOf(s) === idx)
                .join(',');
        }

        // Clean WIREGUARD_ADDRESSES to ensure it's IPv4 only (e.g., discard IPv6 CIDRs from PIA)
        if (gluetunEnv.WIREGUARD_ADDRESSES) {
            const addrs = gluetunEnv.WIREGUARD_ADDRESSES.split(',').map(a => a.trim());
            let ipv4 = addrs.find(a => a.includes('.'));
            if (!ipv4) ipv4 = addrs[0];
            if (ipv4 && !ipv4.includes('/')) ipv4 += '/32';
            gluetunEnv.WIREGUARD_ADDRESSES = ipv4;
        }

        // Strip env vars that are not real Gluetun vars (legacy GUI artifacts)
        ['FIREWALL', 'FIREWALL_DEBUG', 'DOT'].forEach(k => delete gluetunEnv[k]);

        // Gluetun requires custom provider for explicit WireGuard configs
        if (gluetunEnv.VPN_SERVICE_PROVIDER === 'private internet access' && gluetunEnv.VPN_TYPE === 'wireguard') {
            gluetunEnv.VPN_SERVICE_PROVIDER = 'custom';
        }

        // Generic auto-discovery params should be stripped for custom provider,
        // but we MUST allow SERVER_NAMES if it was explicitly provided (required for PIA port forwarding).
        if ((gluetunEnv.VPN_SERVICE_PROVIDER || '').toLowerCase() === 'custom') {
            const genericFilters = ['SERVER_COUNTRIES', 'SERVER_REGIONS', 'SERVER_CITIES', 'SERVER_HOSTNAMES'];
            genericFilters.forEach(k => delete gluetunEnv[k]);
            if (!config.SERVER_NAMES) delete gluetunEnv.SERVER_NAMES;
        }

        // Strip OpenVPN settings if using WireGuard, and vice-versa
        if (gluetunEnv.VPN_TYPE === 'wireguard') {
            Object.keys(gluetunEnv).forEach(k => {
                if (k.startsWith('OPENVPN_')) delete gluetunEnv[k];
            });
        } else if (gluetunEnv.VPN_TYPE === 'openvpn') {
            Object.keys(gluetunEnv).forEach(k => {
                if (k.startsWith('WIREGUARD_')) delete gluetunEnv[k];
            });
        }

        // Recreate the container to apply changes immediately
        const msg = await recreateGluetunContainer(gluetunEnv);

        res.json({ message: `Settings saved to .env. ${msg}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Shared Servers Caching Logic ───────────────────────────────────────────
let gluetunServersCache = null;
let lastServerFetchTime = 0;

async function fetchGluetunServers() {
    if (gluetunServersCache && Date.now() - lastServerFetchTime < 86400000) {
        return gluetunServersCache;
    }
    return new Promise((resolve, reject) => {
        https.get('https://raw.githubusercontent.com/qdm12/gluetun/master/internal/storage/servers.json', (res) => {
            if (res.statusCode !== 200) return reject(new Error('Failed to fetch servers.json'));
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    gluetunServersCache = JSON.parse(data);
                    lastServerFetchTime = Date.now();
                    resolve(gluetunServersCache);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

app.get('/api/helpers/servers', authenticateToken, async (req, res) => {
    try {
        const { provider, vpnType, country, region } = req.query;
        if (!provider) return res.status(400).json({ error: 'Missing provider' });

        const result = {
            countries: new Set(),
            regions: new Set(),
            cities: new Set(),
            hostnames: new Set(),
            server_names: new Set()
        };

        // Standardize VPN type if not provided, else filter dynamically
        const targetVpnType = vpnType === 'wireguard' ? 'wireguard' : 'openvpn';

        // PIA WireGuard relies natively on the API since it's dynamic
        if (provider === 'private internet access' && targetVpnType === 'wireguard') {
            const data = await new Promise((resolve, reject) => {
                https.get('https://serverlist.piaservers.net/vpninfo/servers/v6', (resp) => {
                    let raw = '';
                    resp.on('data', chunk => raw += chunk);
                    resp.on('end', () => resolve(raw));
                }).on('error', reject);
            });
            const jsonStr = data.split('\n')[0];
            const parsed = JSON.parse(jsonStr);
            const regions = parsed.regions.filter(r => !r.offline);
            return res.json({
                countries: [],
                regions: regions.map(r => r.name).sort((a, b) => a.localeCompare(b)),
                cities: [],
                hostnames: [],
                server_names: regions.map(r => r.id).sort()
            });
        }

        // Fetch Master Gluetun servers.json
        const serversData = await fetchGluetunServers();
        const providerData = serversData[provider];
        if (!providerData || !providerData.servers) {
            return res.json({
                countries: [], regions: [], cities: [], hostnames: [], server_names: []
            });
        }

        // Support cascading filters: ?country=X restricts regions/cities/hostnames/names
        // ?region=Y further restricts cities/hostnames/names
        const filterCountries = country ? country.split(',').map(c => c.trim().toLowerCase()) : null;
        const filterRegions = region ? region.split(',').map(r => r.trim().toLowerCase()) : null;

        providerData.servers.forEach(s => {
            if (s.vpn && s.vpn !== targetVpnType) return;

            // Always collect all countries (unfiltered)
            if (s.country) result.countries.add(s.country);

            // Filter regions by selected countries
            const countryMatch = !filterCountries || (s.country && filterCountries.includes(s.country.toLowerCase()));
            if (s.region && countryMatch) result.regions.add(s.region);

            // Filter cities/hostnames/names by selected countries AND regions
            const regionMatch = !filterRegions || (s.region && filterRegions.includes(s.region.toLowerCase()));
            if (countryMatch && regionMatch) {
                if (s.city) result.cities.add(s.city);
                if (s.hostname) result.hostnames.add(s.hostname);
                if (s.server_name) result.server_names.add(s.server_name);
                if (s.name) result.server_names.add(s.name);
            }
        });

        res.json({
            countries: Array.from(result.countries).sort((a, b) => a.localeCompare(b)),
            regions: Array.from(result.regions).sort((a, b) => a.localeCompare(b)),
            cities: Array.from(result.cities).sort((a, b) => a.localeCompare(b)),
            hostnames: Array.from(result.hostnames).sort((a, b) => a.localeCompare(b)),
            server_names: Array.from(result.server_names).sort((a, b) => a.localeCompare(b))
        });
    } catch (err) {
        console.error('[Helper-Servers] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch server data' });
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
    const wgConfPath = path.join(WG_CONFIG_DIR, 'wg0.conf');
    const cmd = `/usr/local/bin/pia-wg-config -o ${wgConfPath} -r ${safeRegion} -s -v${pfFlag} "${PIA_USERNAME}" "${PIA_PASSWORD}"`;

    console.log('[PIA-Generate] Running command:', cmd.replace(PIA_PASSWORD, '***'));

    try {
        const result = await new Promise((resolve, reject) => {
            exec(cmd, { timeout: 30000, env: { ...process.env, GODEBUG: 'x509ignoreCN=0' } }, (error, stdout, stderr) => {
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
            if (fs.existsSync(wgConfPath)) {
                const wgConf = fs.readFileSync(wgConfPath, 'utf8');
                console.log('[PIA-Generate] Generated wg0.conf:', wgConf);

                const pkMatch = wgConf.match(/PrivateKey\s*=\s*(.+)/);
                if (pkMatch) privateKey = pkMatch[1].trim();

                const addrMatch = wgConf.match(/Address\s*=\s*(.+)/);
                if (addrMatch) {
                    const addrs = addrMatch[1].trim().split(',').map(a => a.trim());
                    let ipv4 = addrs.find(a => a.includes('.'));
                    if (!ipv4) ipv4 = addrs[0];
                    address = ipv4.includes('/') ? ipv4 : ipv4 + '/32';
                }

                const epMatch = wgConf.match(/Endpoint\s*=\s*(.+)/);
                if (epMatch) endpoint = epMatch[1].trim();

                const pubMatch = wgConf.match(/PublicKey\s*=\s*(.+)/);
                if (pubMatch) publicKey = pubMatch[1].trim();

                // Extract ServerCommonName - used to pin Gluetun for port forwarding
                const serverMatch = wgConf.match(/ServerCommonName\s*=\s*(.+)/i);
                if (serverMatch) {
                    serverName = serverMatch[1].trim();
                } else {
                    // Fallback to our custom header if ServerCommonName isn't a native field
                    const headerMatch = wgConf.match(/#\s*Server:\s*(.+)/);
                    if (headerMatch) serverName = headerMatch[1].trim();
                }
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
        const parsedVars = {
            VPN_SERVICE_PROVIDER: 'custom',
            VPN_TYPE: 'wireguard',
            WIREGUARD_PRIVATE_KEY: privateKey,
            WIREGUARD_ADDRESSES: address,
            WIREGUARD_ENDPOINT_IP: endpointIP,
            WIREGUARD_ENDPOINT_PORT: endpointPort,
            WIREGUARD_PUBLIC_KEY: publicKey,
        };
        
        const gluetunEnv = Object.entries(parsedVars)
            .filter(([_, v]) => v !== undefined && v !== null && v.toString().trim() !== '' && v !== 'undefined')
            .map(([k, v]) => `${k}=${v}`)
            .join('\n') + '\n';

        fs.writeFileSync(GLUETUN_ENV_PATH, gluetunEnv, 'utf8');
        console.log('[PIA-Generate] Wrote gluetun env to:', GLUETUN_ENV_PATH);

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
            `WIREGUARD_ENDPOINT_IP=${endpointIP}`,
            `WIREGUARD_ENDPOINT_PORT=${endpointPort}`,
            `WIREGUARD_PUBLIC_KEY=${publicKey}`,
        ];
        if (serverName) {
            newEnvArray.push(`SERVER_NAMES=${serverName}`);
            console.log(`[PIA-Generate] Syncing SERVER_NAMES=${serverName} for port forwarding support.`);
        }

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
                let filteredOldEnv = (oldConfig.Env || []).filter(e => !keysToReplace.has(e.split('=')[0]));
                
                // Aggressively strip generic server params and openvpn params from the old env
                // But ALLOW SERVER_NAMES if it's explicitly in our newEnvArray (synced from wg0.conf)
                const forbiddenKeysForCustom = new Set(['SERVER_COUNTRIES', 'SERVER_REGIONS', 'SERVER_CITIES', 'SERVER_HOSTNAMES']);
                filteredOldEnv = filteredOldEnv.filter(e => {
                    const key = e.split('=')[0];
                    if (forbiddenKeysForCustom.has(key)) return false;
                    // Only strip SERVER_NAMES if it's NOT in our new replacement set
                    if (key === 'SERVER_NAMES' && !keysToReplace.has('SERVER_NAMES')) return false;
                    if (key.startsWith('OPENVPN_')) return false;
                    return true;
                });

                // Scrub obsolete mullvad provider from old environment
                filteredOldEnv = filteredOldEnv.map(e => {
                    if (e.startsWith('DNS_UPSTREAM_RESOLVERS=') || e.startsWith('DOT_PROVIDERS=')) {
                        return e.split('=')[0] + '=' + e.split('=')[1].split(',').map(s => s.trim().toLowerCase() === 'mullvad' ? 'quad9' : s).join(',');
                    }
                    return e;
                });

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

// ─── Monitoring State ────────────────────────────────────────────────────────
let failCount = 0;
let pfFailCount = 0;
let lastForwardedPort = null;
const FAIL_THRESHOLD = 3;
const CHECK_INTERVAL = 60 * 1000;          // 1 minute when failing
const HEALTHY_INTERVAL = 15 * 60 * 1000;    // 15 minutes when healthy

async function checkVPN() {
    let monitoringData = {
        connected: false,
        portForwarding: false,
        publicIp: null,
        port: null,
        timestamp: new Date().toISOString()
    };

    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = containers.find(c => c.Names.some(n => n.includes('gluetun') && !n.includes('gui')));
        
        if (!gluetun) {
            console.log('[Monitor] Gluetun container not found. Retrying...');
            return setTimeout(checkVPN, CHECK_INTERVAL);
        }

        const containerId = gluetun.Id;
        const container = docker.getContainer(containerId);
        const inspectData = await container.inspect();
        
        if (inspectData.State.Status !== 'running') {
            console.log(`[Monitor] Gluetun is not running (Status: ${inspectData.State.Status}).`);
            failCount++;
        } else {
            // 1. Check Connectivity via Gluetun API (most reliable)
            const getIpCmd = `wget -qO- --timeout=5 http://localhost:8000/v1/publicip/ip`;
            const ipExec = await container.exec({ Cmd: ['sh', '-c', getIpCmd], AttachStdout: true, AttachStderr: true });
            const ipStream = await ipExec.start();
            
            const ipOutput = await new Promise((resolve) => {
                let data = '';
                ipStream.on('data', chunk => data += chunk.toString());
                ipStream.on('end', () => resolve(data));
                setTimeout(() => resolve(''), 7000);
            });

            if (ipOutput.includes('"public_ip"')) {
                const match = ipOutput.match(/"public_ip":"([^"]+)"/);
                monitoringData.publicIp = match ? match[1] : 'unknown';
                monitoringData.connected = true;
                failCount = 0;
                console.log(`[Monitor] VPN Connected. Public IP: ${monitoringData.publicIp}`);
            } else {
                failCount++;
                console.log(`[Monitor] Connectivity check failed (${failCount}/${FAIL_THRESHOLD})`);
            }

            // 2. Check Port Forwarding if enabled
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

            if (envVars.PIA_PORT_FORWARDING === 'true' && monitoringData.connected) {
                const getPortCmd = `wget -qO- --timeout=5 http://localhost:8000/v1/portforward`;
                const portExec = await container.exec({ Cmd: ['sh', '-c', getPortCmd], AttachStdout: true, AttachStderr: true });
                const portStream = await portExec.start();
                
                const portOutput = await new Promise((resolve) => {
                    let data = '';
                    portStream.on('data', chunk => data += chunk.toString());
                    portStream.on('end', () => resolve(data));
                    setTimeout(() => resolve(''), 7000);
                });

                if (portOutput.includes('"port"')) {
                    const match = portOutput.match(/"port":([0-9]+)/);
                    const port = match ? parseInt(match[1], 10) : 0;
                    if (port > 0) {
                        monitoringData.port = port;
                        monitoringData.portForwarding = true;
                        pfFailCount = 0;
                        
                        if (lastForwardedPort && lastForwardedPort !== port) {
                            console.log(`[Monitor] Port changed: ${lastForwardedPort} -> ${port}`);
                        }
                        lastForwardedPort = port;
                        console.log(`[Monitor] Port Forwarding Active: ${port}`);
                    } else {
                        pfFailCount++;
                        console.log(`[Monitor] Port Forwarding reported port 0 (${pfFailCount}/${FAIL_THRESHOLD})`);
                    }
                } else {
                    pfFailCount++;
                    console.log(`[Monitor] Port Forwarding check failed (${pfFailCount}/${FAIL_THRESHOLD})`);
                }
            }
        }
    } catch (err) {
        console.error('[Monitor] Loop error:', err.message);
        failCount++;
    }

    // 3. Handle Failures
    if (failCount >= FAIL_THRESHOLD || pfFailCount >= FAIL_THRESHOLD) {
        console.log(`[Monitor] Persistent failure detected (Fail: ${failCount}, PF-Fail: ${pfFailCount}). Executing Auto-Failover...`);
        try {
            await executeFailoverRotation();
            failCount = 0;
            pfFailCount = 0;
        } catch (err) {
            console.error('[Monitor] Failover failed:', err.message);
        }
        return setTimeout(checkVPN, CHECK_INTERVAL);
    }

    // 4. Schedule next check
    const nextInterval = (failCount > 0 || pfFailCount > 0) ? CHECK_INTERVAL : HEALTHY_INTERVAL;
    setTimeout(checkVPN, nextInterval);
}

app.get('/api/pia/monitoring', authenticateToken, (req, res) => {
    // Collect the most recent monitoring state
    res.json({
        failCount,
        pfFailCount,
        lastForwardedPort,
        checkInterval: (failCount > 0 || pfFailCount > 0) ? CHECK_INTERVAL : HEALTHY_INTERVAL
    });
});

// Start checker after a short delay
setTimeout(checkVPN, 15000);

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Gluetun GUI API server running on http://localhost:${PORT}`);
});
