const express = require('express');
const cors = require('cors');
const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { exec, execFile } = require('child_process');
const https = require('https');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

// Public: safe metadata for the About page (no secrets)
app.get('/api/about', async (req, res) => {
    try {
        res.json(await getAboutInfo());
    } catch (e) {
        res.status(500).json({ error: e.message || 'Failed to load about info' });
    }
});

// ─── Build / version metadata (for About page) ────────────────────────────────
let cachedAbout = null;
async function getAboutInfo() {
    if (cachedAbout) return cachedAbout;

    const readJson = (p) => {
        try {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch {
            return null;
        }
    };

    const readText = (p) => {
        try {
            return fs.readFileSync(p, 'utf8');
        } catch {
            return null;
        }
    };

    const parseLatestChangelogRelease = (mdText) => {
        if (!mdText) return null;
        const lines = String(mdText).split(/\r?\n/);
        for (const line of lines) {
            // Skip Unreleased; return the first bracketed version heading.
            // Examples:
            // ## [0.1.0] — 2026-04-19
            // ## [1.2.3]
            const m = line.match(/^##\s+\[(?!Unreleased\])([^\]]+)\]\s*(?:—\s*([0-9]{4}-[0-9]{2}-[0-9]{2}))?/);
            if (!m) continue;
            const version = (m[1] || '').trim();
            const date = (m[2] || '').trim() || null;
            return { version, date, line: line.trim() };
        }
        return null;
    };

    const serverPkg = readJson(path.join(__dirname, 'package.json'));
    // When serving the built SPA, the app package.json is not shipped; best-effort read if present.
    const appPkg = readJson(path.join(__dirname, '..', 'app', 'package.json'));
    // In the runtime image, Dockerfile copies CHANGELOG.md into /usr/src/app/CHANGELOG.md.
    // In a dev checkout, CHANGELOG.md is at repo root (one level above server/).
    const changelogText =
        readText(path.join(__dirname, 'CHANGELOG.md')) ||
        readText(path.join(__dirname, '..', 'CHANGELOG.md')) ||
        null;
    const changelogLatest = parseLatestChangelogRelease(changelogText);

    const env = process.env;
    const info = {
        name: 'gluetun-gui',
        serverVersion: serverPkg?.version || null,
        appVersion: appPkg?.version || null,
        release: env.GLUETUN_GUI_RELEASE || changelogLatest?.version || null,
        changelogLatest: changelogLatest || null,
        git: {
            sha: env.GLUETUN_GUI_GIT_SHA || null,
            ref: env.GLUETUN_GUI_GIT_REF || null,
            committedAt: env.GLUETUN_GUI_GIT_COMMITTED_AT || null,
        },
        build: {
            builtAt: env.GLUETUN_GUI_BUILD_TIME || null,
        },
    };

    const hasGit = !!(info.git.sha || info.git.ref || info.git.committedAt);
    if (!hasGit && fs.existsSync(path.join(__dirname, '..', '.git'))) {
        // Best-effort: if running from a git checkout (dev), try to read current commit.
        const run = (args) =>
            new Promise((resolve) => {
                execFile('git', args, { cwd: path.join(__dirname, '..') }, (err, stdout) => {
                    if (err) return resolve(null);
                    const s = String(stdout || '').trim();
                    resolve(s || null);
                });
            });

        const sha = await run(['rev-parse', 'HEAD']);
        const ref = await run(['rev-parse', '--abbrev-ref', 'HEAD']);
        const committedAt = await run(['log', '-1', '--format=%cI']);

        info.git.sha = sha;
        info.git.ref = ref;
        info.git.committedAt = committedAt;
    }

    cachedAbout = info;
    return info;
}

const JWT_SECRET =
    process.env.JWT_SECRET && String(process.env.JWT_SECRET).trim()
        ? String(process.env.JWT_SECRET).trim()
        : 'gluetun-gui-super-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN && String(process.env.JWT_EXPIRES_IN).trim() ? String(process.env.JWT_EXPIRES_IN).trim() : '24h';

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
const VPN_CONNECTIVITY_STATE_PATH = DATA_DIR
    ? path.join(DATA_DIR, 'vpn-connectivity-state.json')
    : path.join(__dirname, 'vpn-connectivity-state.json');
const HOMELAB_STATE_PATH = DATA_DIR
    ? path.join(DATA_DIR, 'gui-homelab-state.json')
    : path.join(__dirname, 'gui-homelab-state.json');
const CONFIG_DIFF_HISTORY_PATH = DATA_DIR
    ? path.join(DATA_DIR, 'config-diff-history.json')
    : path.join(__dirname, 'config-diff-history.json');
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
        // Best-effort "server" label. For PIA WireGuard + port forwarding we pin SERVER_NAMES.
        server: envVars.SERVER_NAMES ||
            envVars.SERVER_HOSTNAMES ||
            envVars.SERVER_REGIONS ||
            envVars.SERVER_COUNTRIES ||
            envVars.SERVER_CITIES ||
            null,
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
            const gluetun = findGluetunEngineContainer(containers);
            if (gluetun) {
                let logs = '';
                try {
                    const logsStream = await docker.getContainer(gluetun.Id).logs({ follow: false, stdout: true, stderr: true, tail: 300 });
                    logs = logsStream.toString('utf8');
                } catch (e) {
                    // Container can be recreated between list and logs; ignore expected 404 race.
                    if ((e.message || '').includes('no such container') || e.statusCode === 404) return;
                    throw e;
                }
                
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
            if ((e.message || '').includes('no such container') || e.statusCode === 404) return;
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

function findGluetunEngineContainer(containers) {
    // Prefer exact compose name `/gluetun`, otherwise fall back to "gluetun but not gui"
    return (
        containers.find(c => (c.Names || []).some(n => n === '/gluetun')) ||
        containers.find(c => (c.Names || []).some(n => n.includes('gluetun') && !n.includes('gui')))
    );
}

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
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        res.json({ token, message: 'Authenticated Successfully' });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// All routes below require Authentication
app.get('/api/status', authenticateToken, async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = findGluetunEngineContainer(containers);

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

        const guiEnv = readGuiEnv();
        // Prefer GUI-selected provider label for display (e.g. PIA WireGuard uses VPN_SERVICE_PROVIDER=custom in container)
        const displayProvider = guiEnv.VPN_SERVICE_PROVIDER || null;

        const lastVpnConnectivityCheck = loadVpnConnectivityState();
        let imageUpdate = null;
        try {
            const imgName = containerInfo.Config.Image;
            const localDigest = extractLocalImageDigest(containerInfo);
            const { remoteDigest, error } = await fetchDockerHubManifestDigest(imgName);
            const norm = (d) => (d ? String(d).replace(/^sha256:/i, '').toLowerCase() : '');
            imageUpdate = {
                localDigest,
                remoteDigest: remoteDigest || null,
                updateAvailable: !!(localDigest && remoteDigest && norm(localDigest) !== norm(remoteDigest)),
                checkError: error || null,
                checkedAt: new Date().toISOString(),
            };
        } catch (e) {
            imageUpdate = { checkError: e.message, checkedAt: new Date().toISOString() };
        }

        res.json({
            status: containerInfo.State.Status,
            id: containerInfo.Id,
            env: containerInfo.Config.Env,
            image: containerInfo.Config.Image,
            imageId: containerInfo.Image || null,
            containerName: (containerInfo.Name || '').replace(/^\//, ''),
            startedAt: containerInfo.State.StartedAt,
            currentSession,
            gui: {
                VPN_SERVICE_PROVIDER: guiEnv.VPN_SERVICE_PROVIDER || null,
                VPN_TYPE: guiEnv.VPN_TYPE || null,
                PIA_PORT_FORWARDING: guiEnv.PIA_PORT_FORWARDING || null,
            },
            displayProvider,
            lastVpnConnectivityCheck,
            imageUpdate,
            homelab: loadHomelabState(),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/metrics', authenticateToken, async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = findGluetunEngineContainer(containers);

        if (!gluetun) {
            return res.status(404).json({ error: 'Gluetun container not found' });
        }

        const container = docker.getContainer(gluetun.Id);
        const stats = await container.stats({ stream: false });

        // Enrich network interfaces from inside the container.
        // Docker's stats can omit tunnel devices (e.g. tun0) depending on engine/platform.
        try {
            const devExec = await container.exec({ Cmd: ['sh', '-c', 'cat /proc/net/dev 2>/dev/null || true'], AttachStdout: true, AttachStderr: true });
            const devStream = await devExec.start();
            const devText = await collectExecOutput(devStream, 3500);
            const procIfaces = {};
            // /proc/net/dev format:
            // Inter-| Receive ... | Transmit ...
            //  tun0: 123 0 0 0 0 0 0 0 456 0 0 0 0 0 0 0
            for (const line of String(devText || '').split(/\r?\n/)) {
                const m = line.match(/^\s*([^:]+):\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+/);
                if (!m) continue;
                const iface = m[1].trim();
                if (!iface || iface === 'lo') continue;
                const rx = Number(m[2]);
                const tx = Number(m[10]);
                if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;
                procIfaces[iface] = { rx_bytes: rx, tx_bytes: tx };
            }
            if (stats && typeof stats === 'object') {
                const merged = { ...(stats.networks || {}) };
                Object.entries(procIfaces).forEach(([iface, v]) => {
                    merged[iface] = { ...(merged[iface] || {}), ...v };
                });
                stats.networks = merged;
            }
        } catch {
            // ignore enrichment errors; base docker stats will still work
        }

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
        
        const mode = String(req.query.mode || '');
        const liveOnly = mode === 'live' || String(req.query.from || '') === 'now';
        let tailN = parseInt(String(req.query.tail || '100'), 10);
        if (!Number.isFinite(tailN) || tailN < 1) tailN = 100;
        if (tailN > 5000) tailN = 5000;
        const logOpts = { follow: true, stdout: true, stderr: true, timestamps: false };
        if (liveOnly) {
            logOpts.since = Math.floor(Date.now() / 1000);
        } else {
            logOpts.tail = tailN;
        }

        const attachStream = async (containerName, prefix) => {
            const cInfo = containers.find(c => c.Names.some(n => n === `/${containerName}`));
            if (!cInfo) {
                res.write(`data: ${JSON.stringify(`[ERROR] ${containerName} container not found`)}\n\n`);
                return;
            }
            const container = docker.getContainer(cInfo.Id);
            const stream = await container.logs(logOpts);
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
    const gluetunInfo = findGluetunEngineContainer(containers);

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

app.get('/api/config', authenticateToken, async (req, res) => {
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

        let didPiaOpenVpnRegionMigrate = false;
        const provL = String(config.VPN_SERVICE_PROVIDER || '').toLowerCase();
        const isPiaOv =
            provL.includes('private internet access') &&
            String(config.VPN_TYPE || '').toLowerCase() === 'openvpn' &&
            config.PIA_OPENVPN_REGIONS;
        if (isPiaOv) {
            try {
                const aliasMap = await getPiaOpenVpnAliasToRegionMap();
                const raw = config.PIA_OPENVPN_REGIONS.split(',').map((s) => s.trim()).filter(Boolean);
                const seen = new Set();
                const normalized = [];
                for (const r of raw) {
                    const canon = aliasMap.get(r.toLowerCase());
                    if (canon && !seen.has(canon)) {
                        seen.add(canon);
                        normalized.push(canon);
                    }
                }
                let joined = normalized.join(',');
                if (joined && joined !== config.PIA_OPENVPN_REGIONS) {
                    config.PIA_OPENVPN_REGIONS = joined;
                    didPiaOpenVpnRegionMigrate = true;
                    console.log('[Config] Migrated PIA OpenVPN selection to Gluetun region labels for GUI + .env');
                }
                if (isPiaOpenVpnPortForwardingEnabled(config) && config.PIA_OPENVPN_REGIONS) {
                    const pfSet = await getPiaOpenVpnPfRegionSet();
                    const tokens = config.PIA_OPENVPN_REGIONS.split(',').map((s) => s.trim()).filter(Boolean);
                    const pfOk = tokens.filter((t) => pfSet.has(t));
                    const pfJoined = pfOk.join(',');
                    if (pfJoined && pfJoined !== config.PIA_OPENVPN_REGIONS) {
                        config.PIA_OPENVPN_REGIONS = pfJoined;
                        didPiaOpenVpnRegionMigrate = true;
                        let idx = parseInt(config.PIA_REGION_INDEX || '0', 10);
                        if (Number.isNaN(idx) || idx < 0 || idx >= pfOk.length) config.PIA_REGION_INDEX = '0';
                        console.log('[Config] Dropped non-PF PIA OpenVPN regions (port forwarding on); persisted to .env');
                    }
                }
            } catch (e) {
                console.warn('[Config] PIA OpenVPN region migrate on GET skipped:', e.message);
            }
        }

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

        // Gluetun parses UPDATER_PERIOD with Go duration syntax; bare "12" errors — treat bare numbers as hours
        if (config.UPDATER_PERIOD !== undefined && config.UPDATER_PERIOD !== null && String(config.UPDATER_PERIOD).trim() !== '') {
            const before = String(config.UPDATER_PERIOD).trim();
            const after = normalizeGluetunUpdaterPeriod(config.UPDATER_PERIOD);
            if (after !== before) {
                config.UPDATER_PERIOD = after;
                didMigrate = true;
                console.log('[Config] Migrated UPDATER_PERIOD for Gluetun:', JSON.stringify(before), '→', after);
            }
        }

        // Persist migrated values back to .env so Gluetun never sees stale/deprecated vars
        if (didMigrate || didPiaOpenVpnRegionMigrate) {
            let newEnv = '';
            for (const [k, v] of Object.entries(config)) {
                if (v !== undefined && v !== null && v.toString().trim() !== '') {
                    newEnv += `${k}=${v}\n`;
                }
            }
            fs.writeFileSync(ENV_PATH, newEnv, 'utf8');
            console.log('[Config] Migrated env vars and persisted to .env');
        }

        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/** Gluetun expects Go duration strings (e.g. 24h, 30m). Bare integers error at parse time. */
function normalizeGluetunUpdaterPeriod(value) {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    if (s === '') return '';
    if (s === '0') return '0';
    if (/[a-zA-Zµ]+$/.test(s)) return s;
    if (/^-?\d+(\.\d+)?$/.test(s)) return `${s}h`;
    return s;
}

/** Persist GUI .env and recreate Gluetun (same pipeline as POST /api/config). */
async function applyGuiConfiguration(config) {
    // PIA OpenVPN: Gluetun reads OPENVPN_USER/PASSWORD, not PIA_* (those are GUI-only and stripped below).
    const prov = String(config.VPN_SERVICE_PROVIDER || '').toLowerCase();
    const isPia = prov.includes('private internet access');
    const isOpenVpn = String(config.VPN_TYPE || '').toLowerCase() === 'openvpn';
    if (isPia && isOpenVpn) {
        if (!String(config.OPENVPN_USER || '').trim() && config.PIA_USERNAME) {
            config.OPENVPN_USER = config.PIA_USERNAME;
        }
        if (!String(config.OPENVPN_PASSWORD || '').trim() && config.PIA_PASSWORD) {
            config.OPENVPN_PASSWORD = config.PIA_PASSWORD;
        }
        // Never pass generic SERVER_* from the UI into PIA OpenVPN — they are often WireGuard ids (montreal427).
        ['SERVER_REGIONS', 'SERVER_COUNTRIES', 'SERVER_CITIES', 'SERVER_HOSTNAMES', 'SERVER_NAMES'].forEach((k) => {
            delete config[k];
        });
        if (config.PIA_OPENVPN_REGIONS) {
            await sanitizePiaOpenVpnServerSelection(config);
        }
    }

    if (config.UPDATER_PERIOD !== undefined && config.UPDATER_PERIOD !== null && String(config.UPDATER_PERIOD).trim() !== '') {
        const before = String(config.UPDATER_PERIOD).trim();
        const after = normalizeGluetunUpdaterPeriod(config.UPDATER_PERIOD);
        if (after !== before) {
            config.UPDATER_PERIOD = after;
            console.log('[Config] NORMALIZE UPDATER_PERIOD for Gluetun:', JSON.stringify(before), '→', after);
        }
    }

    const beforeGui = parseEnvFileToMap(ENV_PATH);

    let envContent = '';
    for (const [key, value] of Object.entries(config)) {
        if (value !== undefined && value !== null && value.toString().trim() !== '' && value !== 'undefined') {
            envContent += `${key}=${value}\n`;
        }
    }
    fs.writeFileSync(ENV_PATH, envContent, 'utf8');

    const guiOnlyKeys = [
        'GUI_PASSWORD',
        'PIA_USERNAME',
        'PIA_PASSWORD',
        'PIA_REGIONS',
        'PIA_WG_REGIONS',
        'PIA_OPENVPN_REGIONS',
        'PIA_ROTATION_RETRIES',
        'PIA_ROTATION_COUNT',
        'PIA_REGION_INDEX',
        'GUI_NOTIFY_WEBHOOK_URL',
        'GUI_NOTIFY_WEBHOOK_SECRET',
        'GUI_NOTIFY_QUIET_ENABLED',
        'GUI_NOTIFY_QUIET_START',
        'GUI_NOTIFY_QUIET_END',
        'GUI_BACKUP_INTERVAL_HOURS',
        'GUI_BACKUP_RETENTION',
        'GUI_DIFF_HISTORY_MAX',
    ];
    const gluetunEnv = { ...config };
    guiOnlyKeys.forEach(k => delete gluetunEnv[k]);

    Object.keys(gluetunEnv).forEach(k => {
        const val = gluetunEnv[k];
        if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) {
            delete gluetunEnv[k];
        }
    });

    Object.keys(gluetunEnv).forEach(k => {
        if (gluetunEnv[k] === 'true') gluetunEnv[k] = 'on';
        if (gluetunEnv[k] === 'false') gluetunEnv[k] = 'off';
    });

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

    if (gluetunEnv.DNS_UPSTREAM_PLAIN_ADDRESSES) {
        gluetunEnv.DNS_UPSTREAM_PLAIN_ADDRESSES = gluetunEnv.DNS_UPSTREAM_PLAIN_ADDRESSES
            .split(',')
            .map(ip => ip.trim())
            .map(ip => {
                if (ip && ip.match(/^(\d{1,3}\.){3}\d{1,3}$/)) {
                    return `${ip}:53`;
                }
                return ip;
            })
            .join(',');
    }

    if (gluetunEnv.DNS_UPSTREAM_RESOLVERS) {
        gluetunEnv.DNS_UPSTREAM_RESOLVERS = gluetunEnv.DNS_UPSTREAM_RESOLVERS
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(s => s.toLowerCase() === 'mullvad' ? 'quad9' : s)
            .filter((s, idx, arr) => arr.indexOf(s) === idx)
            .join(',');
    }

    if (gluetunEnv.WIREGUARD_ADDRESSES) {
        const addrs = gluetunEnv.WIREGUARD_ADDRESSES.split(',').map(a => a.trim());
        let ipv4 = addrs.find(a => a.includes('.'));
        if (!ipv4) ipv4 = addrs[0];
        if (ipv4 && !ipv4.includes('/')) ipv4 += '/32';
        gluetunEnv.WIREGUARD_ADDRESSES = ipv4;
    }

    ['FIREWALL', 'FIREWALL_DEBUG', 'DOT'].forEach(k => delete gluetunEnv[k]);

    if (gluetunEnv.VPN_SERVICE_PROVIDER === 'private internet access' && gluetunEnv.VPN_TYPE === 'wireguard') {
        gluetunEnv.VPN_SERVICE_PROVIDER = 'custom';
    }

    if ((gluetunEnv.VPN_SERVICE_PROVIDER || '').toLowerCase() === 'custom') {
        const genericFilters = ['SERVER_COUNTRIES', 'SERVER_REGIONS', 'SERVER_CITIES', 'SERVER_HOSTNAMES'];
        genericFilters.forEach(k => delete gluetunEnv[k]);
        if (!config.SERVER_NAMES) delete gluetunEnv.SERVER_NAMES;
    }

    if (gluetunEnv.VPN_TYPE === 'wireguard') {
        Object.keys(gluetunEnv).forEach(k => {
            if (k.startsWith('OPENVPN_')) delete gluetunEnv[k];
        });

        if (gluetunEnv.PIA_PORT_FORWARDING === 'on' || gluetunEnv.VPN_PORT_FORWARDING === 'on') {
            const apiUser = config.PIA_USERNAME || config.OPENVPN_USER;
            const apiPass = config.PIA_PASSWORD || config.OPENVPN_PASSWORD;
            if (apiUser && apiPass) {
                gluetunEnv.VPN_PORT_FORWARDING_PROVIDER = 'private internet access';
                gluetunEnv.VPN_PORT_FORWARDING_USERNAME = apiUser;
                gluetunEnv.VPN_PORT_FORWARDING_PASSWORD = apiPass;
            }
        }
    } else if (gluetunEnv.VPN_TYPE === 'openvpn') {
        Object.keys(gluetunEnv).forEach(k => {
            if (k.startsWith('WIREGUARD_')) delete gluetunEnv[k];
        });

        if ((gluetunEnv.VPN_SERVICE_PROVIDER || '').toLowerCase().includes('private internet access')) {
            ['SERVER_REGIONS', 'SERVER_COUNTRIES', 'SERVER_CITIES', 'SERVER_HOSTNAMES', 'SERVER_NAMES'].forEach((k) => {
                delete gluetunEnv[k];
            });
            if (config.PIA_OPENVPN_REGIONS) {
                const regions = config.PIA_OPENVPN_REGIONS.split(',').map(s => s.trim()).filter(Boolean);
                let activeIndex = parseInt(config.PIA_REGION_INDEX || '0', 10);
                if (isNaN(activeIndex) || activeIndex < 0 || activeIndex >= regions.length) activeIndex = 0;

                if (regions.length > 0) {
                    gluetunEnv.SERVER_REGIONS = regions[activeIndex];
                    console.log(`[Config] Injected SERVER_REGIONS=${gluetunEnv.SERVER_REGIONS} from PIA_OPENVPN_REGIONS index ${activeIndex}`);
                }
            }
        }
    }

    const beforeGluetun = parseEnvFileToMap(GLUETUN_ENV_PATH);
    const containerDiff = computeConfigDiff(beforeGluetun, gluetunEnv);
    const recreateMessage = await recreateGluetunContainer(gluetunEnv);
    const afterGui = parseEnvFileToMap(ENV_PATH);
    const guiChanges = computeConfigDiff(beforeGui, afterGui);
    if (guiChanges.length) appendConfigDiffHistory(guiChanges);
    mergeHomelabState({ lastConfigSaveAt: new Date().toISOString() });
    return {
        message: recreateMessage,
        containerDiff,
        guiChangeCount: guiChanges.length,
    };
}

function parseEnvImportText(raw) {
    const config = {};
    const lines = String(raw).replace(/\r\n/g, '\n').split('\n');
    for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq === -1) continue;
        const key = t.slice(0, eq).trim();
        const val = t.slice(eq + 1);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            throw new Error(`Invalid env key: ${key}`);
        }
        config[key] = val;
    }
    if (Object.keys(config).length === 0) {
        throw new Error('No KEY=value pairs found in import.');
    }
    return config;
}

function redactEnvTextForExport(text) {
    const exact = /^(GUI_PASSWORD|PIA_PASSWORD|OPENVPN_PASSWORD|WIREGUARD_PRIVATE_KEY|WIREGUARD_PRESHARED_KEY|OPENVPN_KEY_PASSPHRASE|VPN_PORT_FORWARDING_PASSWORD|HTTPPROXY_PASSWORD|SHADOWSOCKS_PASSWORD|PUBLICIP_API_TOKEN|UPDATER_PROTONVPN_PASSWORD|OPENVPN_KEY|OPENVPN_ENCRYPTED_KEY|OPENVPN_CERT)$/i;
    const loose = /PASSWORD|_SECRET$|_TOKEN$|PRIVATE_KEY|PRESHARED/i;
    return text.split('\n').map(line => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return line;
        const eq = line.indexOf('=');
        if (eq === -1) return line;
        const key = line.slice(0, eq).trim();
        if (exact.test(key) || loose.test(key)) {
            return `${key}=__REDACTED__`;
        }
        return line;
    }).join('\n');
}

function shouldRedactKeyForDiff(key) {
    const exact = /^(GUI_PASSWORD|PIA_PASSWORD|OPENVPN_PASSWORD|WIREGUARD_PRIVATE_KEY|WIREGUARD_PRESHARED_KEY|OPENVPN_KEY_PASSPHRASE|VPN_PORT_FORWARDING_PASSWORD|HTTPPROXY_PASSWORD|SHADOWSOCKS_PASSWORD|PUBLICIP_API_TOKEN|UPDATER_PROTONVPN_PASSWORD|OPENVPN_KEY|OPENVPN_ENCRYPTED_KEY|OPENVPN_CERT|GUI_NOTIFY_WEBHOOK_SECRET)$/i;
    const loose = /PASSWORD|_SECRET$|_TOKEN$|PRIVATE_KEY|PRESHARED/i;
    return exact.test(key) || loose.test(key);
}

function parseEnvFileToMap(envPath) {
    const o = {};
    if (!fs.existsSync(envPath)) return o;
    fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
        if (line && line.includes('=')) {
            const parts = line.split('=');
            o[parts[0]] = parts.slice(1).join('=').trim();
        }
    });
    return o;
}

function computeConfigDiff(currentFlat, proposedFlat) {
    const keys = new Set([...Object.keys(currentFlat || {}), ...Object.keys(proposedFlat || {})]);
    const changes = [];
    for (const k of keys) {
        if (k.startsWith('_')) continue;
        const a = currentFlat[k] !== undefined && currentFlat[k] !== null ? String(currentFlat[k]) : '';
        const b = proposedFlat[k] !== undefined && proposedFlat[k] !== null ? String(proposedFlat[k]) : '';
        if (a === b) continue;
        changes.push({
            key: k,
            before: shouldRedactKeyForDiff(k) ? (a ? '__REDACTED__' : '') : a,
            after: shouldRedactKeyForDiff(k) ? (b ? '__REDACTED__' : '') : b,
        });
    }
    changes.sort((x, y) => x.key.localeCompare(y.key));
    return changes;
}

function loadVpnConnectivityState() {
    try {
        if (!fs.existsSync(VPN_CONNECTIVITY_STATE_PATH)) return null;
        return JSON.parse(fs.readFileSync(VPN_CONNECTIVITY_STATE_PATH, 'utf8'));
    } catch (e) {
        return null;
    }
}

function loadHomelabState() {
    try {
        if (!fs.existsSync(HOMELAB_STATE_PATH)) return {};
        const j = JSON.parse(fs.readFileSync(HOMELAB_STATE_PATH, 'utf8'));
        return j && typeof j === 'object' ? j : {};
    } catch {
        return {};
    }
}

function mergeHomelabState(patch) {
    try {
        const cur = loadHomelabState();
        const next = { ...cur, ...patch };
        fs.writeFileSync(HOMELAB_STATE_PATH, JSON.stringify(next, null, 2), 'utf8');
    } catch (e) {
        console.error('[Homelab] Failed to persist state:', e.message);
    }
}

function appendConfigDiffHistory(changes) {
    if (!DATA_DIR || !changes || !changes.length) return;
    const gui = readGuiEnv();
    const max = Math.min(200, Math.max(5, parseInt(String(gui.GUI_DIFF_HISTORY_MAX || '30'), 10) || 30));
    let arr = [];
    try {
        if (fs.existsSync(CONFIG_DIFF_HISTORY_PATH)) {
            arr = JSON.parse(fs.readFileSync(CONFIG_DIFF_HISTORY_PATH, 'utf8'));
        }
    } catch {
        arr = [];
    }
    if (!Array.isArray(arr)) arr = [];
    arr.push({
        at: new Date().toISOString(),
        changeCount: changes.length,
        changes,
    });
    arr = arr.slice(-max);
    fs.writeFileSync(CONFIG_DIFF_HISTORY_PATH, JSON.stringify(arr, null, 2), 'utf8');
}

function parseHmToMinutes(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
}

function isWebhookQuietNow(gui) {
    const raw = String(gui.GUI_NOTIFY_QUIET_ENABLED || '').toLowerCase();
    if (!['on', 'true', '1', 'yes'].includes(raw)) return false;
    const start = parseHmToMinutes(gui.GUI_NOTIFY_QUIET_START || '22:00');
    const end = parseHmToMinutes(gui.GUI_NOTIFY_QUIET_END || '07:00');
    if (start === null || end === null) return false;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    if (start === end) return false;
    if (start < end) return cur >= start && cur < end;
    return cur >= start || cur < end;
}

function pruneOldBackups(backupsDir, retention) {
    try {
        if (!fs.existsSync(backupsDir)) return;
        const files = fs
            .readdirSync(backupsDir)
            .filter((f) => f.endsWith('.tar.gz'))
            .map((f) => {
                const p = path.join(backupsDir, f);
                const st = fs.statSync(p);
                return { p, f, m: st.mtimeMs };
            })
            .sort((a, b) => b.m - a.m);
        for (let i = retention; i < files.length; i++) {
            fs.unlinkSync(files[i].p);
        }
    } catch (e) {
        console.error('[Backup] Prune failed:', e.message);
    }
}

function runDataBackup() {
    return new Promise((resolve) => {
        if (!DATA_DIR) {
            resolve({ ok: false, error: 'DATA_DIR not set' });
            return;
        }
        const backupsDir = path.join(DATA_DIR, 'backups');
        try {
            if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
        } catch (e) {
            resolve({ ok: false, error: e.message });
            return;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
        const filename = `gluetun-gui-backup-${stamp}.tar.gz`;
        const outPath = path.join(backupsDir, filename);
        const members = [];
        for (const rel of ['gui-config.env', 'sessions.json', 'vpn-connectivity-state.json', 'gluetun.env']) {
            if (fs.existsSync(path.join(DATA_DIR, rel))) members.push(rel);
        }
        if (fs.existsSync(path.join(DATA_DIR, 'wireguard'))) members.push('wireguard');
        if (members.length === 0) {
            resolve({ ok: false, error: 'No files to back up' });
            return;
        }
        const gui = readGuiEnv();
        const retention = Math.min(500, Math.max(1, parseInt(String(gui.GUI_BACKUP_RETENTION || '10'), 10) || 10));
        const args = ['-czf', outPath, '-C', DATA_DIR, ...members];
        execFile('tar', args, { timeout: 120000 }, (err) => {
            if (err) {
                mergeHomelabState({ lastBackupError: err.message, lastBackupAt: new Date().toISOString() });
                resolve({ ok: false, error: err.message });
                return;
            }
            pruneOldBackups(backupsDir, retention);
            const at = new Date().toISOString();
            mergeHomelabState({
                lastBackupAt: at,
                lastBackupError: null,
                lastBackupFile: filename,
            });
            resolve({ ok: true, filename, path: outPath, savedAt: at });
        });
    });
}

function saveVpnConnectivityState(obj) {
    try {
        fs.writeFileSync(VPN_CONNECTIVITY_STATE_PATH, JSON.stringify(obj, null, 2), 'utf8');
        mergeHomelabState({
            lastVpnConnectivityProbeAt: obj.at || new Date().toISOString(),
        });
    } catch (e) {
        console.error('[VPN-Check] Failed to persist state:', e.message);
    }
}

let imageDigestCache = { at: 0, imageRef: null, remoteDigest: null, error: null };

function extractLocalImageDigest(inspect) {
    const digests = inspect?.RepoDigests || [];
    const cfgImg = inspect?.Config?.Image || '';
    const base = cfgImg.includes(':') && !cfgImg.endsWith(':latest') ? cfgImg.split(':')[0] : cfgImg.replace(/:latest$/, '');
    const match = digests.find((d) => base && d.startsWith(base.split('@')[0])) || digests[0];
    const m = match && match.match(/(sha256:[a-f0-9]{64})/i);
    if (m) return m[1];
    const id = inspect?.Image || '';
    const m2 = typeof id === 'string' && id.includes('sha256:') ? id.match(/(sha256:[a-f0-9]{64})/i) : null;
    return m2 ? m2[1] : null;
}

function parseImageRepoAndTag(imageStr) {
    if (!imageStr || typeof imageStr !== 'string') return null;
    let s = imageStr.replace(/^docker\.io\//, '');
    const at = s.indexOf('@');
    if (at !== -1) s = s.slice(0, at);
    const lastColon = s.lastIndexOf(':');
    const lastSlash = s.lastIndexOf('/');
    const hasTag = lastColon > lastSlash;
    const repo = hasTag ? s.slice(0, lastColon) : s;
    const tag = hasTag ? s.slice(lastColon + 1) : 'latest';
    return { repo, tag };
}

async function fetchDockerHubManifestDigest(imageStr) {
    const parsed = parseImageRepoAndTag(imageStr);
    if (!parsed) return { remoteDigest: null, error: 'bad-image' };
    const { repo, tag } = parsed;
    const scopeRepo = repo.split('/')[0];
    if (scopeRepo.includes('.')) {
        return { remoteDigest: null, error: 'non-docker-hub-registry' };
    }
    const now = Date.now();
    const cacheKey = `${repo}:${tag}`;
    if (
        imageDigestCache.imageRef === cacheKey &&
        now - imageDigestCache.at < 3600000 &&
        imageDigestCache.remoteDigest
    ) {
        return { remoteDigest: imageDigestCache.remoteDigest, error: imageDigestCache.error };
    }
    try {
        const token = await new Promise((resolve, reject) => {
            const scope = encodeURIComponent(`repository:${repo}:pull`);
            const u = `https://auth.docker.io/token?service=registry.docker.io&scope=${scope}`;
            https.get(u, (r) => {
                let d = '';
                r.on('data', (c) => (d += c));
                r.on('end', () => {
                    try {
                        resolve(JSON.parse(d).token);
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject);
        });
        const digest = await new Promise((resolve, reject) => {
            const opts = {
                hostname: 'registry-1.docker.io',
                path: `/v2/${repo}/manifests/${encodeURIComponent(tag)}`,
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.docker.distribution.manifest.v2+json',
                },
            };
            https.get(opts, (r) => {
                let body = '';
                r.on('data', (c) => (body += c));
                r.on('end', () => {
                    const dh = r.headers['docker-content-digest'];
                    if (r.statusCode === 200 && dh) resolve(dh);
                    else reject(new Error(`registry HTTP ${r.statusCode}`));
                });
            }).on('error', reject);
        });
        imageDigestCache = { at: now, imageRef: cacheKey, remoteDigest: digest, error: null };
        return { remoteDigest: digest, error: null };
    } catch (e) {
        imageDigestCache = { at: now, imageRef: cacheKey, remoteDigest: null, error: e.message };
        return { remoteDigest: null, error: e.message };
    }
}

const NOTIFY_THROTTLE_MS = 120000;
let notifyWebhookLastByEvent = {};
let lastMissingContainerWebhookAt = 0;

function notifyWebhook(event, payload) {
    const gui = readGuiEnv();
    const url = String(gui.GUI_NOTIFY_WEBHOOK_URL || '').trim();
    if (!url) return;
    if (isWebhookQuietNow(gui)) {
        console.log('[Notify] Webhook suppressed (quiet hours):', event);
        return;
    }
    const now = Date.now();
    if (event === 'gluetun_container_missing') {
        if (now - lastMissingContainerWebhookAt < 5 * 60 * 1000) return;
        lastMissingContainerWebhookAt = now;
    } else {
        const t = notifyWebhookLastByEvent[event] || 0;
        if (now - t < NOTIFY_THROTTLE_MS) return;
        notifyWebhookLastByEvent[event] = now;
    }
    let u;
    try {
        u = new URL(url);
    } catch (e) {
        console.error('[Notify] Invalid GUI_NOTIFY_WEBHOOK_URL:', e.message);
        return;
    }
    const secret = String(gui.GUI_NOTIFY_WEBHOOK_SECRET || '').trim();
    const body = JSON.stringify({
        event,
        source: 'gluetun-gui',
        timestamp: new Date().toISOString(),
        ...(payload && typeof payload === 'object' ? payload : {}),
    });
    const opts = {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
        },
    };
    if (secret) opts.headers.Authorization = `Bearer ${secret}`;
    const lib = u.protocol === 'https:' ? https : http;
    const reqOut = lib.request(opts, (resOut) => {
        const code = resOut.statusCode || 0;
        const ok = code >= 200 && code < 300;
        mergeHomelabState({
            lastWebhook: {
                at: new Date().toISOString(),
                ok,
                event,
                statusCode: code,
                error: null,
            },
        });
        resOut.resume();
    });
    reqOut.on('error', (e) => {
        console.error('[Notify] Webhook error:', e.message);
        mergeHomelabState({
            lastWebhook: {
                at: new Date().toISOString(),
                ok: false,
                event,
                statusCode: null,
                error: e.message,
            },
        });
    });
    reqOut.write(body);
    reqOut.end();
    console.log('[Notify] POST webhook:', event);
}

app.post('/api/config/preview-diff', authenticateToken, (req, res) => {
    try {
        const current = parseEnvFileToMap(ENV_PATH);
        const proposed = req.body && typeof req.body === 'object' ? req.body : {};
        const changes = computeConfigDiff(current, proposed);
        res.json({ changes, changeCount: changes.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/config/diff-history', authenticateToken, (req, res) => {
    try {
        if (!fs.existsSync(CONFIG_DIFF_HISTORY_PATH)) {
            return res.json({ entries: [] });
        }
        const raw = JSON.parse(fs.readFileSync(CONFIG_DIFF_HISTORY_PATH, 'utf8'));
        const entries = Array.isArray(raw) ? raw : [];
        res.json({ entries });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/config/export', authenticateToken, (req, res) => {
    try {
        if (!fs.existsSync(ENV_PATH)) {
            return res.status(404).json({ error: 'No saved GUI configuration file yet.' });
        }
        let text = fs.readFileSync(ENV_PATH, 'utf8');
        if (req.query.redact === '1' || req.query.redact === 'true') {
            text = redactEnvTextForExport(text);
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="gluetun-gui-config.env"');
        res.send(text.endsWith('\n') ? text : `${text}\n`);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/config/import', authenticateToken, async (req, res) => {
    try {
        const { envText, dryRun } = req.body || {};
        if (!envText || typeof envText !== 'string') {
            return res.status(400).json({ error: 'Body must include envText (string).' });
        }
        const config = parseEnvImportText(envText);
        if (dryRun) {
            return res.json({ ok: true, keyCount: Object.keys(config).length });
        }
        const out = await applyGuiConfiguration(config);
        res.json({
            message: `Imported and saved. ${out.message}`,
            keyCount: Object.keys(config).length,
            containerDiff: out.containerDiff,
            guiChangeCount: out.guiChangeCount,
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/config', authenticateToken, async (req, res) => {
    try {
        const out = await applyGuiConfiguration(req.body);
        res.json({
            message: `Settings saved to .env. ${out.message}`,
            containerDiff: out.containerDiff,
            guiChangeCount: out.guiChangeCount,
        });
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
        const url = 'https://raw.githubusercontent.com/qdm12/gluetun/master/internal/storage/servers.json';
        const opts = {
            headers: { 'User-Agent': 'gluetun-gui/1.0 (+https://github.com/qdm12/gluetun)' },
        };
        https.get(url, opts, (res) => {
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

function isPiaProviderName(provider) {
    return String(provider || '').trim().toLowerCase() === 'private internet access';
}

/** Resolve GUI `VPN_SERVICE_PROVIDER` to a Gluetun `servers.json` provider block (keys are lowercase, e.g. `private internet access`). */
function findServersJsonProvider(serversData, provider) {
    const raw = String(provider || '').trim();
    if (!raw) return null;
    const direct = serversData[raw];
    if (direct && typeof direct === 'object' && Array.isArray(direct.servers)) return direct;
    const low = raw.toLowerCase();
    for (const key of Object.keys(serversData)) {
        if (key === 'version') continue;
        const block = serversData[key];
        if (!block || typeof block !== 'object' || !Array.isArray(block.servers)) continue;
        if (key.toLowerCase() === low) return block;
    }
    return null;
}

/**
 * Lowercased alias (Gluetun `server_name`, optional `name`, or region label) → canonical PIA OpenVPN **region**
 * string for `SERVER_REGIONS`. Gluetun validates PIA OpenVPN against these region labels, not internal hostnames.
 */
async function getPiaOpenVpnAliasToRegionMap() {
    const serversData = await fetchGluetunServers();
    const providerData = serversData['private internet access'];
    const map = new Map();
    if (!providerData?.servers) return map;
    for (const s of providerData.servers) {
        if (s.vpn && s.vpn !== 'openvpn') continue;
        const region = s.region;
        if (!region || typeof region !== 'string') continue;
        map.set(region.toLowerCase(), region);
        if (s.server_name) map.set(String(s.server_name).toLowerCase(), region);
        if (s.name) map.set(String(s.name).toLowerCase(), region);
    }
    return map;
}

/** Regions that have at least one PIA OpenVPN server with `port_forward: true` in Gluetun's servers.json (matches Gluetun's PF-only filter). */
async function getPiaOpenVpnPfRegionSet() {
    const serversData = await fetchGluetunServers();
    const providerData = serversData['private internet access'];
    const regions = new Set();
    if (!providerData?.servers) return regions;
    for (const s of providerData.servers) {
        if (s.vpn && s.vpn !== 'openvpn') continue;
        if (s.port_forward === true && s.region) regions.add(s.region);
    }
    return regions;
}

function isPiaOpenVpnPortForwardingEnabled(config) {
    return (
        config.VPN_PORT_FORWARDING === 'on' ||
        config.PIA_PORT_FORWARDING === 'true' ||
        config.PIA_PORT_FORWARDING === 'on'
    );
}

/**
 * Normalize PIA_OPENVPN_REGIONS to Gluetun region labels (deduped). Accepts legacy `server_name` tokens (e.g. berlin422).
 */
async function sanitizePiaOpenVpnServerSelection(config) {
    const raw = (config.PIA_OPENVPN_REGIONS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (raw.length === 0) return;

    let aliasToRegion;
    try {
        aliasToRegion = await getPiaOpenVpnAliasToRegionMap();
    } catch (e) {
        console.error('[Config] PIA OpenVPN sanitize: servers.json fetch failed:', e.message);
        throw new Error(
            'Could not load Gluetun server list to validate PIA OpenVPN servers. Check network, then save again.',
        );
    }
    if (aliasToRegion.size === 0) {
        throw new Error('Gluetun servers.json contained no PIA OpenVPN servers.');
    }

    const normalized = [];
    const seen = new Set();
    for (const r of raw) {
        const canon = aliasToRegion.get(r.toLowerCase());
        if (canon && !seen.has(canon)) {
            seen.add(canon);
            normalized.push(canon);
        }
    }

    const dropped = raw.filter((r) => !aliasToRegion.has(r.toLowerCase()));
    if (dropped.length) {
        console.warn('[Config] Removed invalid PIA OpenVPN token(s) (not in Gluetun list):', dropped.join(', '));
    }

    if (normalized.length === 0) {
        throw new Error(
            'PIA OpenVPN failover list has no valid Gluetun regions. Use labels such as "DE Berlin" or legacy server codes from servers.json. ' +
                'WireGuard region IDs (e.g. montreal427) are not valid for OpenVPN. Fetch the list in Settings and save.',
        );
    }

    if (isPiaOpenVpnPortForwardingEnabled(config)) {
        let pfRegions;
        try {
            pfRegions = await getPiaOpenVpnPfRegionSet();
        } catch (e) {
            console.error('[Config] PIA OpenVPN PF region list failed:', e.message);
            throw new Error('Could not load Gluetun server list for port-forwarding regions. Check network, then save again.');
        }
        const pfFiltered = normalized.filter((r) => pfRegions.has(r));
        const droppedPf = normalized.filter((r) => !pfRegions.has(r));
        if (droppedPf.length) {
            console.warn(
                '[Config] Removed PIA OpenVPN region(s) with no OpenVPN port-forwarding servers in Gluetun data (VPN port forwarding is on):',
                droppedPf.join(', '),
            );
        }
        if (pfFiltered.length === 0) {
            throw new Error(
                'VPN port forwarding is enabled, but none of your selected regions have PIA OpenVPN servers marked for port forwarding in Gluetun. ' +
                    'US state regions are often missing that flag—try CA Montreal, DE Berlin, NL Netherlands, etc., turn off port forwarding, or use PIA WireGuard for US + PF.',
            );
        }
        normalized.length = 0;
        normalized.push(...pfFiltered);
    }

    config.PIA_OPENVPN_REGIONS = normalized.join(',');
    let idx = parseInt(config.PIA_REGION_INDEX || '0', 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= normalized.length) {
        config.PIA_REGION_INDEX = '0';
    }
}

app.get('/api/helpers/servers', authenticateToken, async (req, res) => {
    try {
        const { provider: providerRaw, vpnType, country, region, portForwardOnly } = req.query;
        const provider = typeof providerRaw === 'string' ? providerRaw : Array.isArray(providerRaw) ? providerRaw[0] : '';
        if (!provider) {
            console.warn('[ServerList] /api/helpers/servers: rejected (missing provider)');
            return res.status(400).json({ error: 'Missing provider' });
        }

        console.log(
            '[ServerList] /api/helpers/servers request:',
            JSON.stringify({
                provider,
                vpnType: vpnType || null,
                portForwardOnly: portForwardOnly === '1' || portForwardOnly === 'true' || false,
                country: country || null,
                region: region || null,
            }),
        );

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
        if (isPiaProviderName(provider) && targetVpnType === 'wireguard') {
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
            const offline = parsed.regions.length - regions.length;
            console.log(
                `[ServerList] /api/helpers/servers: PIA WireGuard → ${regions.length} online regions from PIA API (${offline} offline skipped)`,
            );
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
        const providerData = findServersJsonProvider(serversData, provider);
        if (!providerData) {
            console.warn(`[ServerList] /api/helpers/servers: unknown provider (no servers.json match): "${provider}"`);
            return res.json({
                countries: [],
                regions: [],
                cities: [],
                hostnames: [],
                server_names: [],
                unknownProvider: true,
            });
        }

        // PIA OpenVPN: Gluetun `SERVER_REGIONS` must be human-readable region labels (e.g. "DE Berlin"), not `server_name` (e.g. berlin422).
        if (isPiaProviderName(provider) && targetVpnType === 'openvpn') {
            const pfOnly = portForwardOnly === '1' || portForwardOnly === 'true';
            const filterCountries = country ? country.split(',').map((c) => c.trim().toLowerCase()) : null;
            const filterRegions = region ? region.split(',').map((r) => r.trim().toLowerCase()) : null;
            const countrySet = new Set();
            const regionSet = new Set();
            for (const s of providerData.servers) {
                if (s.vpn && s.vpn !== 'openvpn') continue;
                if (pfOnly && s.port_forward !== true) continue;
                if (s.country) countrySet.add(s.country);
                const countryMatch =
                    !filterCountries || (s.country && filterCountries.includes(s.country.toLowerCase()));
                const regionMatch =
                    !filterRegions || (s.region && filterRegions.includes(s.region.toLowerCase()));
                if (countryMatch && regionMatch && s.region) regionSet.add(s.region);
            }
            const regionsSorted = Array.from(regionSet).sort((a, b) => a.localeCompare(b));
            console.log(
                `[ServerList] /api/helpers/servers: PIA OpenVPN → ${regionsSorted.length} region labels from Gluetun servers.json` +
                    (pfOnly ? ' (port-forward filter on)' : ''),
            );
            return res.json({
                countries: Array.from(countrySet).sort((a, b) => a.localeCompare(b)),
                regions: regionsSorted,
                cities: [],
                hostnames: [],
                server_names: regionsSorted,
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

        const payload = {
            countries: Array.from(result.countries).sort((a, b) => a.localeCompare(b)),
            regions: Array.from(result.regions).sort((a, b) => a.localeCompare(b)),
            cities: Array.from(result.cities).sort((a, b) => a.localeCompare(b)),
            hostnames: Array.from(result.hostnames).sort((a, b) => a.localeCompare(b)),
            server_names: Array.from(result.server_names).sort((a, b) => a.localeCompare(b))
        };
        console.log(
            `[ServerList] /api/helpers/servers: ${provider} / ${targetVpnType} → countries=${payload.countries.length} regions=${payload.regions.length} cities=${payload.cities.length} hostnames=${payload.hostnames.length} server_names=${payload.server_names.length}`,
        );
        res.json(payload);
    } catch (err) {
        console.error('[ServerList] /api/helpers/servers failed:', err.message, err.stack || '');
        res.status(500).json({ error: 'Failed to fetch server data' });
    }
});

// ── GUI .env helpers (PIA failover / rotation) ───────────────────────────────
function readGuiEnv() {
    const o = {};
    if (!fs.existsSync(ENV_PATH)) return o;
    fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach(line => {
        if (line && line.includes('=')) {
            const parts = line.split('=');
            o[parts[0]] = parts.slice(1).join('=').trim();
        }
    });
    return o;
}

function writeGuiEnv(obj) {
    let s = '';
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined && v !== null && v.toString().trim() !== '') s += `${k}=${v}\n`;
    }
    fs.writeFileSync(ENV_PATH, s, 'utf8');
}

/**
 * Run pia-wg-config, write Gluetun env + GUI .env, recreate Gluetun container.
 * @param {string} opts.PIA_REGION — region id passed to pia-wg-config -r
 */
async function applyPiaWireguardFromCredentials({
    PIA_USERNAME,
    PIA_PASSWORD,
    PIA_REGION,
    PIA_PORT_FORWARDING = 'false',
    PIA_REGIONS,
    PIA_REGION_INDEX = '0',
}) {
    const pfFlag = PIA_PORT_FORWARDING === 'true' || PIA_PORT_FORWARDING === 'on' ? ' -p' : '';
    const safeRegion = PIA_REGION.replace(/[^a-zA-Z0-9_-]/g, '');
    const wgConfPath = path.join(WG_CONFIG_DIR, 'wg0.conf');
    const cmd = `/usr/local/bin/pia-wg-config -o ${wgConfPath} -r ${safeRegion} -s -v${pfFlag} "${PIA_USERNAME}" "${PIA_PASSWORD}"`;

    console.log('[PIA-WG] Running command:', cmd.replace(PIA_PASSWORD, '***'));

    await new Promise((resolve, reject) => {
        exec(cmd, { timeout: 30000, env: { ...process.env, GODEBUG: 'x509ignoreCN=0' } }, (error, stdout, stderr) => {
            console.log('[PIA-WG] stdout:', stdout);
            console.log('[PIA-WG] stderr:', stderr);
            if (error) reject(new Error(stderr || stdout || error.message));
            else resolve(stdout + stderr);
        });
    });

    let privateKey = '', address = '', endpoint = '', publicKey = '', serverName = null;
    if (fs.existsSync(wgConfPath)) {
        const wgConf = fs.readFileSync(wgConfPath, 'utf8');
        console.log('[PIA-WG] Generated wg0.conf:', wgConf);

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

        const serverMatch = wgConf.match(/ServerCommonName\s*=\s*(.+)/i);
        if (serverMatch) {
            serverName = serverMatch[1].trim();
        } else {
            const headerMatch = wgConf.match(/#\s*Server:\s*(.+)/);
            if (headerMatch) serverName = headerMatch[1].trim();
        }
    }

    if (!privateKey) {
        throw new Error('Failed to parse PrivateKey from generated wg0.conf. The file may be corrupted.');
    }

    let endpointIP = '', endpointPort = '1337';
    if (endpoint) {
        const epParts = endpoint.split(':');
        endpointIP = epParts[0];
        if (epParts[1]) endpointPort = epParts[1];
    }

    const parsedVars = {
        VPN_SERVICE_PROVIDER: 'custom',
        VPN_TYPE: 'wireguard',
        WIREGUARD_PRIVATE_KEY: privateKey,
        WIREGUARD_ADDRESSES: address,
        WIREGUARD_ENDPOINT_IP: endpointIP,
        WIREGUARD_ENDPOINT_PORT: endpointPort,
        WIREGUARD_PUBLIC_KEY: publicKey,
    };

    const gluetunEnvFile = Object.entries(parsedVars)
        .filter(([_, v]) => v !== undefined && v !== null && v.toString().trim() !== '' && v !== 'undefined')
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n';

    fs.writeFileSync(GLUETUN_ENV_PATH, gluetunEnvFile, 'utf8');
    console.log('[PIA-WG] Wrote gluetun env to:', GLUETUN_ENV_PATH);

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
    envVars.PIA_REGION_INDEX = PIA_REGION_INDEX;
    envVars.PIA_PORT_FORWARDING = PIA_PORT_FORWARDING || 'false';
    envVars.VPN_SERVICE_PROVIDER = 'private internet access';
    envVars.VPN_TYPE = 'wireguard';
    if (serverName) envVars.SERVER_NAMES = serverName;

    let newEnv = '';
    for (const [k, v] of Object.entries(envVars)) {
        newEnv += `${k}=${v}\n`;
    }
    fs.writeFileSync(ENV_PATH, newEnv, 'utf8');

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
        console.log(`[PIA-WG] Syncing SERVER_NAMES=${serverName} for port forwarding support.`);
    }

    let restartMsg = '';
    const containers = await docker.listContainers({ all: true });
    const gluetunInfo = containers.find(c => c.Names.some(n => n.includes('gluetun') && !n.includes('gui')));
    if (gluetunInfo) {
        const oldContainer = docker.getContainer(gluetunInfo.Id);
        const inspectData = await oldContainer.inspect();

        await oldContainer.stop().catch(() => { });
        await oldContainer.remove().catch(() => { });

        const oldConfig = inspectData.Config;
        const hostConfig = inspectData.HostConfig;

        const keysToReplace = new Set(newEnvArray.map(e => e.split('=')[0]));
        let filteredOldEnv = (oldConfig.Env || []).filter(e => !keysToReplace.has(e.split('=')[0]));

        const forbiddenKeysForCustom = new Set(['SERVER_COUNTRIES', 'SERVER_REGIONS', 'SERVER_CITIES', 'SERVER_HOSTNAMES']);
        filteredOldEnv = filteredOldEnv.filter(e => {
            const key = e.split('=')[0];
            if (forbiddenKeysForCustom.has(key)) return false;
            if (key === 'SERVER_NAMES' && !keysToReplace.has('SERVER_NAMES')) return false;
            if (key.startsWith('OPENVPN_')) return false;
            return true;
        });

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
            HostConfig: { ...hostConfig },
            Labels: oldConfig.Labels,
        };

        const newContainer = await docker.createContainer(createOpts);
        await newContainer.start();
        restartMsg = ' Gluetun recreated with new WireGuard config.';
        console.log('[PIA-WG] Gluetun container recreated successfully');
    } else {
        restartMsg = ' Warning: Gluetun container not found.';
    }

    return { privateKey, serverName, restartMsg };
}

// PIA WireGuard Config Generation
let piaRefreshStatus = { state: 'idle', message: 'No generation attempted yet', lastGenerated: null, failCount: 0 };

app.get('/api/pia/status', authenticateToken, (req, res) => {
    res.json(piaRefreshStatus);
});

// Proxy PIA server list to avoid CORS issues in browser
app.get('/api/pia/regions', async (req, res) => {
    try {
        const https = require('https');
        const portForwardOnly = req.query.portForwardOnly === '1' || req.query.portForwardOnly === 'true';
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
            .filter(r => (portForwardOnly ? !!r.port_forward : true))
            .map(r => ({ id: r.id, name: r.name, portForward: r.port_forward }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const offline = parsed.regions.length - regions.length;
        console.log(
            `[ServerList] /api/pia/regions: ${regions.length} WireGuard regions from PIA (${offline} offline/PF filtered)`,
        );
        res.json(regions);
    } catch (err) {
        console.error('[ServerList] /api/pia/regions failed:', err.message, err.stack || '');
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

    try {
        const { privateKey, serverName, restartMsg } = await applyPiaWireguardFromCredentials({
            PIA_USERNAME,
            PIA_PASSWORD,
            PIA_REGION,
            PIA_PORT_FORWARDING: PIA_PORT_FORWARDING || 'false',
            PIA_REGIONS,
            PIA_REGION_INDEX: '0',
        });

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
    // Important: do not swallow /api routes defined below
    app.use((req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        return res.sendFile(path.join(distPath, 'index.html'));
    });
}

// ─── Monitoring State ────────────────────────────────────────────────────────
let failCount = 0;
let pfFailCount = 0;
let lastForwardedPort = null;
let lastMonitoringSnapshot = null;
let prevCheckVpnFailCount = 0;
let prevCheckVpnPfFailCount = 0;
const FAIL_THRESHOLD = 3;
const CHECK_INTERVAL = 60 * 1000;          // 1 minute when failing
const HEALTHY_INTERVAL = 15 * 60 * 1000;    // 15 minutes when healthy

/** Docker exec attach returns multiplexed stdout/stderr (8-byte header per frame). Strip to plain text. */
function demuxDockerExecOutput(buf) {
    if (!buf || !buf.length) return '';
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    // Not Docker multiplex (JSON etc. starts with `{` or ASCII text)
    if (b[0] !== 1 && b[0] !== 2) return b.toString('utf8');
    let out = Buffer.alloc(0);
    let offset = 0;
    while (offset < b.length) {
        if (b.length - offset < 8) {
            out = Buffer.concat([out, b.subarray(offset)]);
            break;
        }
        const streamType = b[offset];
        const size = b.readUInt32BE(offset + 4);
        if ((streamType === 1 || streamType === 2) && size > 0 && offset + 8 + size <= b.length) {
            out = Buffer.concat([out, b.subarray(offset + 8, offset + 8 + size)]);
            offset += 8 + size;
        } else {
            out = Buffer.concat([out, b.subarray(offset)]);
            break;
        }
    }
    return out.toString('utf8');
}

async function collectExecOutput(stream, timeoutMs = 7000) {
    const chunks = [];
    await new Promise((resolve) => {
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', resolve);
        stream.on('error', resolve);
        setTimeout(resolve, timeoutMs);
    });
    return demuxDockerExecOutput(Buffer.concat(chunks));
}

function envArrayToMap(envArr) {
    const o = {};
    for (const e of envArr || []) {
        const s = String(e);
        const i = s.indexOf('=');
        if (i > 0) o[s.slice(0, i)] = s.slice(i + 1);
    }
    return o;
}

function extractIPv4FromExecOutput(text) {
    if (!text) return null;
    const t = text.trim();
    const line = t.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(line)) return line;
    const m = t.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
    return m ? m[1] : null;
}

/**
 * Resolve public IP from inside Gluetun: control server → HTTPS JSON → plain HTTP (OpenVPN bring-up often needs the last).
 */
async function execResolvePublicIp(container, vpnTypeMon) {
    const isOv = vpnTypeMon === 'openvpn';
    const ctrlTimeout = isOv ? 10 : 5;
    const httpsTimeout = isOv ? 20 : 10;
    const plainTimeout = isOv ? 22 : 14;
    const collectCtrl = isOv ? 16000 : 11000;
    const collectHttps = isOv ? 25000 : 14000;
    const collectPlain = isOv ? 26000 : 16000;

    const getIpCmd = `wget -qO- --timeout=${ctrlTimeout} http://127.0.0.1:8000/v1/publicip/ip`;
    const ipExec = await container.exec({ Cmd: ['sh', '-c', getIpCmd], AttachStdout: true, AttachStderr: true });
    const ipStream = await ipExec.start();
    const ipOutput = await collectExecOutput(ipStream, collectCtrl);

    const isAuthError = /Authentication Failed/i.test(ipOutput) || /\b401\b/.test(ipOutput);
    if (ipOutput.includes('"public_ip"') && !isAuthError) {
        const match = ipOutput.match(/"public_ip":"([^"]+)"/);
        return { ok: true, publicIp: match ? match[1] : null, method: 'gluetun-control-server', preview: '' };
    }

    const ipifyCmd = `wget -qO- --timeout=${httpsTimeout} https://api.ipify.org?format=json`;
    const ipifyExec = await container.exec({ Cmd: ['sh', '-c', ipifyCmd], AttachStdout: true, AttachStderr: true });
    const ipifyStream = await ipifyExec.start();
    const ipifyOut = await collectExecOutput(ipifyStream, collectHttps);
    if (ipifyOut.includes('"ip"')) {
        const match = ipifyOut.match(/"ip":"([^"]+)"/);
        return { ok: true, publicIp: match ? match[1] : null, method: 'ipify', preview: '' };
    }

    const plainCmd =
        `wget -qO- --timeout=${plainTimeout} http://ipv4.icanhazip.com 2>/dev/null || wget -qO- --timeout=${plainTimeout} http://checkip.amazonaws.com 2>/dev/null`;
    const plainExec = await container.exec({ Cmd: ['sh', '-c', plainCmd], AttachStdout: true, AttachStderr: true });
    const plainStream = await plainExec.start();
    const plainOut = await collectExecOutput(plainStream, collectPlain);
    const plainIp = extractIPv4FromExecOutput(plainOut);
    if (plainIp) {
        return { ok: true, publicIp: plainIp, method: 'http-plain-ip', preview: '' };
    }

    const preview = (isAuthError ? ipOutput : `${ipifyOut} ${plainOut}`)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return { ok: false, publicIp: null, method: 'all-probes-failed', preview };
}

/**
 * One-shot outbound check from inside the Gluetun container (does not touch monitor counters).
 */
async function probeOutboundVpn(container) {
    try {
        const insp = await container.inspect();
        const envMap = envArrayToMap(insp.Config.Env);
        const vpnTypeMon = String(envMap.VPN_TYPE || 'wireguard').toLowerCase();
        const r = await execResolvePublicIp(container, vpnTypeMon);
        if (r.ok) return { ok: true, publicIp: r.publicIp, method: r.method };
        return { ok: false, method: r.method || 'probe', detail: r.preview || 'empty response' };
    } catch (e) {
        return { ok: false, method: 'error', detail: e.message };
    }
}

async function restartGluetunContainerHelper() {
    const containers = await docker.listContainers({ all: true });
    const gluetun = findGluetunEngineContainer(containers);
    if (!gluetun) {
        console.log('[Failover] Gluetun container not found for restart.');
        return;
    }
    await docker.getContainer(gluetun.Id).restart();
    console.log('[Failover] Gluetun container restarted.');
}

/**
 * Advance PIA_REGION_INDEX and reconnect (WireGuard: regenerate; OpenVPN PIA: new SERVER_REGIONS).
 */
async function executeFailoverRotation() {
    const env = readGuiEnv();
    const vpnType = (env.VPN_TYPE || 'wireguard').toLowerCase();

    const wgRegions = (env.PIA_WG_REGIONS || env.PIA_REGIONS || '').split(',').map(s => s.trim()).filter(Boolean);
    // OpenVPN must use PIA_OPENVPN_REGIONS only — PIA_REGIONS often holds WireGuard ids (e.g. montreal427 vs montreal420)
    const ovRegions = (env.PIA_OPENVPN_REGIONS || '').split(',').map(s => s.trim()).filter(Boolean);
    const regions = vpnType === 'openvpn'
        ? ovRegions
        : (wgRegions.length ? wgRegions : ovRegions);

    if (!regions.length) {
        console.log('[Failover] No regions in GUI env; restarting Gluetun only.');
        await restartGluetunContainerHelper();
        return;
    }

    let idx = parseInt(env.PIA_REGION_INDEX || '0', 10);
    if (isNaN(idx) || idx < 0) idx = 0;
    const nextIdx = (idx + 1) % regions.length;
    env.PIA_REGION_INDEX = String(nextIdx);
    writeGuiEnv(env);

    const targetRegion = regions[nextIdx];
    console.log(`[Failover] Rotating to index ${nextIdx}/${regions.length - 1}: ${targetRegion}`);

    if (regions.length === 1) {
        console.log('[Failover] Only one region configured; restarting Gluetun.');
        await restartGluetunContainerHelper();
        return;
    }

    if (vpnType === 'wireguard' && env.PIA_USERNAME && env.PIA_PASSWORD) {
        await applyPiaWireguardFromCredentials({
            PIA_USERNAME: env.PIA_USERNAME,
            PIA_PASSWORD: env.PIA_PASSWORD,
            PIA_REGION: targetRegion,
            PIA_PORT_FORWARDING: env.PIA_PORT_FORWARDING || 'false',
            PIA_REGIONS: env.PIA_WG_REGIONS || env.PIA_REGIONS || regions.join(','),
            PIA_REGION_INDEX: String(nextIdx),
        });
        return;
    }

    if (vpnType === 'openvpn' && (env.VPN_SERVICE_PROVIDER || '').toLowerCase().includes('private internet access')) {
        try {
            const aliasToRegion = await getPiaOpenVpnAliasToRegionMap();
            const canon = aliasToRegion.get(String(targetRegion).toLowerCase());
            if (!canon) {
                console.error(
                    `[Failover] Invalid PIA OpenVPN region "${targetRegion}". Update PIA_OPENVPN_REGIONS in Settings (region labels or legacy server codes) and save.`,
                );
                await restartGluetunContainerHelper();
                return;
            }
            if (isPiaOpenVpnPortForwardingEnabled(env)) {
                const pfSet = await getPiaOpenVpnPfRegionSet();
                if (!pfSet.has(canon)) {
                    console.error(
                        `[Failover] "${canon}" has no OpenVPN port-forwarding servers in Gluetun data while VPN port forwarding is on. Re-save Settings with PF-capable regions (e.g. CA Montreal).`,
                    );
                    await restartGluetunContainerHelper();
                    return;
                }
            }
            await recreateGluetunContainer({ SERVER_REGIONS: canon });
        } catch (e) {
            console.error('[Failover] OpenVPN server list check failed:', e.message);
            await restartGluetunContainerHelper();
        }
        return;
    }

    console.log('[Failover] No PIA rotation path matched; restarting Gluetun.');
    await restartGluetunContainerHelper();
}

async function checkVPN() {
    mergeHomelabState({ lastMonitorTickAt: new Date().toISOString() });

    let monitoringData = {
        connected: false,
        portForwarding: false,
        publicIp: null,
        port: null,
        timestamp: new Date().toISOString()
    };

    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = findGluetunEngineContainer(containers);

        if (!gluetun) {
            console.log('[Monitor] Gluetun container not found. Retrying...');
            notifyWebhook('gluetun_container_missing', { message: 'Gluetun engine container not found' });
            return setTimeout(checkVPN, CHECK_INTERVAL);
        }

        const containerId = gluetun.Id;
        const container = docker.getContainer(containerId);
        const inspectData = await container.inspect();

        const envMap = envArrayToMap(inspectData.Config.Env);
        const vpnTypeMon = String(envMap.VPN_TYPE || 'wireguard').toLowerCase();

        // OpenVPN needs longer than WireGuard before outbound HTTPS is reliable; skip counting failures during bring-up.
        const startedAtMs = inspectData?.State?.StartedAt ? Date.parse(inspectData.State.StartedAt) : 0;
        const ageMs = startedAtMs ? (Date.now() - startedAtMs) : 0;
        const warmupMs = vpnTypeMon === 'openvpn' ? 120000 : 25000;
        const isWarmingUp = ageMs > 0 && ageMs < warmupMs;

        if (inspectData.State.Status !== 'running') {
            console.log(`[Monitor] Gluetun is not running (Status: ${inspectData.State.Status}).`);
            failCount++;
        } else {
            if (isWarmingUp) {
                console.log(
                    `[Monitor] Skipping connectivity check during warm-up (${Math.round(ageMs / 1000)}s / ${Math.round(warmupMs / 1000)}s, ${vpnTypeMon}).`,
                );
                lastMonitoringSnapshot = { ...monitoringData, timestamp: new Date().toISOString(), warmup: true, vpnType: vpnTypeMon };
                return setTimeout(checkVPN, CHECK_INTERVAL);
            }

            const ipResult = await execResolvePublicIp(container, vpnTypeMon);
            if (ipResult.ok) {
                monitoringData.publicIp = ipResult.publicIp || 'unknown';
                monitoringData.connected = true;
                if (prevCheckVpnFailCount >= FAIL_THRESHOLD) {
                    notifyWebhook('vpn_connectivity_recovered', {
                        publicIp: monitoringData.publicIp,
                        method: ipResult.method,
                    });
                }
                failCount = 0;
                console.log(`[Monitor] VPN Connected (${ipResult.method}). Public IP: ${monitoringData.publicIp}`);
            } else {
                failCount++;
                const preview = (ipResult.preview || '').replace(/\s+/g, ' ').slice(0, 160);
                console.log(
                    `[Monitor] Connectivity check failed (${failCount}/${FAIL_THRESHOLD}) [${vpnTypeMon}]${preview ? ` — ${preview}` : ''}`,
                );
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

            const piaPfEnabled = envVars.PIA_PORT_FORWARDING === 'true' || envVars.PIA_PORT_FORWARDING === 'on';
            const vpnPfEnabled = String(envVars.VPN_PORT_FORWARDING || '').toLowerCase() === 'on' || String(envVars.VPN_PORT_FORWARDING || '').toLowerCase() === 'true';
            const pfEnabled = piaPfEnabled || vpnPfEnabled;
            if (pfEnabled && monitoringData.connected) {
                const getPortCmd = `wget -qO- --timeout=5 http://127.0.0.1:8000/v1/portforward`;
                const portExec = await container.exec({ Cmd: ['sh', '-c', getPortCmd], AttachStdout: true, AttachStderr: true });
                const portStream = await portExec.start();

                const portOutput = await collectExecOutput(portStream);

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
                    // Fallback: read forwarded port from status file inside container.
                    // Gluetun commonly writes it to /tmp/gluetun/forwarded_port (see VPN_PORT_FORWARDING_STATUS_FILE).
                    const statusFile = '/tmp/gluetun/forwarded_port';
                    const fileCmd = `sh -lc 'test -f ${statusFile} && cat ${statusFile} || true'`;
                    const fileExec = await container.exec({ Cmd: ['sh', '-c', fileCmd], AttachStdout: true, AttachStderr: true });
                    const fileStream = await fileExec.start();
                    const fileOut = (await collectExecOutput(fileStream)).trim();
                    const filePort = fileOut.match(/([0-9]{2,6})/) ? parseInt(fileOut.match(/([0-9]{2,6})/)[1], 10) : 0;

                    if (filePort > 0) {
                        monitoringData.port = filePort;
                        monitoringData.portForwarding = true;
                        pfFailCount = 0;
                        if (lastForwardedPort && lastForwardedPort !== filePort) {
                            console.log(`[Monitor] Port changed: ${lastForwardedPort} -> ${filePort}`);
                        }
                        lastForwardedPort = filePort;
                        console.log(`[Monitor] Port Forwarding Active (file): ${filePort}`);
                    } else if (
                        // If control server is auth-protected and file isn't available, don't count as failure.
                        // Gluetun's control server often returns a small plain-text body on auth failures.
                        /Authentication Failed/i.test(portOutput) ||
                        /\bUnauthorized\b/i.test(portOutput) ||
                        /\bForbidden\b/i.test(portOutput) ||
                        /requires auth/i.test(portOutput) ||
                        /authentication/i.test(portOutput)
                    ) {
                        pfFailCount = 0;
                        console.log('[Monitor] Port Forwarding check skipped (control server requires auth).');
                    } else {
                        pfFailCount++;
                        console.log(`[Monitor] Port Forwarding check failed (${pfFailCount}/${FAIL_THRESHOLD})`);
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Monitor] Loop error:', err.message);
        failCount++;
    }

    // Persist last snapshot for UI consumption
    lastMonitoringSnapshot = { ...monitoringData };

    // 3. Handle Failures
    if (failCount >= FAIL_THRESHOLD || pfFailCount >= FAIL_THRESHOLD) {
        console.log(`[Monitor] Persistent failure detected (Fail: ${failCount}, PF-Fail: ${pfFailCount}). Executing Auto-Failover...`);
        if (failCount >= FAIL_THRESHOLD) {
            notifyWebhook('vpn_connectivity_failed', { failCount, pfFailCount, threshold: FAIL_THRESHOLD });
        }
        if (pfFailCount >= FAIL_THRESHOLD) {
            notifyWebhook('port_forwarding_failed', { pfFailCount, failCount, threshold: FAIL_THRESHOLD });
        }
        try {
            await executeFailoverRotation();
            failCount = 0;
            pfFailCount = 0;
        } catch (err) {
            console.error('[Monitor] Failover failed:', err.message);
        }
        return setTimeout(checkVPN, CHECK_INTERVAL);
    }

    prevCheckVpnFailCount = failCount;
    prevCheckVpnPfFailCount = pfFailCount;

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
        connected: lastMonitoringSnapshot?.connected ?? null,
        publicIp: lastMonitoringSnapshot?.publicIp ?? null,
        portForwarding: lastMonitoringSnapshot?.portForwarding ?? null,
        port: lastMonitoringSnapshot?.port ?? null,
        timestamp: lastMonitoringSnapshot?.timestamp ?? null,
        checkInterval: (failCount > 0 || pfFailCount > 0) ? CHECK_INTERVAL : HEALTHY_INTERVAL
    });
});

app.post('/api/test-failover', authenticateToken, async (req, res) => {
    try {
        await executeFailoverRotation();
        res.json({ message: 'Failover rotation executed.' });
    } catch (err) {
        console.error('[Test-Failover]', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/vpn/connectivity-test', authenticateToken, async (req, res) => {
    const persist = (payload) => {
        saveVpnConnectivityState({
            ...payload,
            at: new Date().toISOString(),
        });
    };
    try {
        const containers = await docker.listContainers({ all: true });
        const g = findGluetunEngineContainer(containers);
        if (!g) {
            persist({ ok: false, error: 'Gluetun engine container not found', publicIp: null, method: null, detail: null });
            return res.status(404).json({ ok: false, error: 'Gluetun engine container not found' });
        }
        const container = docker.getContainer(g.Id);
        const inspectData = await container.inspect();
        if (inspectData.State.Status !== 'running') {
            const body = {
                ok: false,
                error: `Container not running (${inspectData.State.Status})`,
                containerStatus: inspectData.State.Status,
            };
            persist({
                ok: false,
                error: body.error,
                publicIp: null,
                method: 'inspect',
                detail: inspectData.State.Status,
            });
            return res.json(body);
        }
        const result = await probeOutboundVpn(container);
        const out = result.ok ? { ok: true, ...result } : { ok: false, ...result };
        persist({
            ok: !!out.ok,
            publicIp: out.publicIp || null,
            method: out.method || null,
            detail: out.detail || out.error || null,
            error: out.ok ? null : out.error || out.detail || null,
        });
        res.json(out);
    } catch (err) {
        persist({ ok: false, error: err.message, publicIp: null, method: null, detail: err.message });
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get('/api/gluetun-control', authenticateToken, async (req, res) => {
    let p = String(req.query.path || '/v1/portforward').trim();
    if (!p.startsWith('/')) p = `/${p}`;
    if (!/^\/v1\/[a-zA-Z0-9/_-]+$/.test(p)) {
        return res.status(400).json({ error: 'path must look like /v1/... (letters, numbers, slash, underscore, hyphen)' });
    }
    try {
        const containers = await docker.listContainers({ all: true });
        const g = findGluetunEngineContainer(containers);
        if (!g) return res.status(404).json({ error: 'Gluetun engine container not found' });
        const container = docker.getContainer(g.Id);
        const inspectData = await container.inspect();
        if (inspectData.State.Status !== 'running') {
            return res.status(503).json({ error: `Gluetun not running (${inspectData.State.Status})` });
        }
        const innerUrl = `http://127.0.0.1:8000${p}`;
        const cmd = `wget -qO- --timeout=8 ${JSON.stringify(innerUrl)}`;
        const ex = await container.exec({ Cmd: ['sh', '-c', cmd], AttachStdout: true, AttachStderr: true });
        const stream = await ex.start();
        const text = await collectExecOutput(stream, 12000);
        const looksJson = /^\s*[\[{]/.test(text);
        if (looksJson) {
            try {
                return res.json(JSON.parse(text));
            } catch {
                return res.type('text/plain; charset=utf-8').send(text);
            }
        }
        res.type('text/plain; charset=utf-8').send(text || '');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/compose-snippet', authenticateToken, async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        const gluetun = findGluetunEngineContainer(containers);
        if (!gluetun) return res.status(404).json({ error: 'Gluetun engine container not found' });
        const inspect = await docker.getContainer(gluetun.Id).inspect();
        const name = (inspect.Name || '/gluetun').replace(/^\//, '');
        const bindings = inspect.HostConfig?.PortBindings || {};
        const portLines = [];
        for (const [containerPort, hosts] of Object.entries(bindings)) {
            if (!hosts || !hosts.length) continue;
            const h = hosts[0];
            portLines.push(`      - "${(h.HostPort || h.hostPort || '?')}:${containerPort.split('/')[0]}"`);
        }
        const snippet = [
            '# Client service sharing Gluetun network namespace (outbound via VPN).',
            '# Adjust image, env, and volumes for your app.',
            'services:',
            '  myapp:',
            '    image: ghcr.io/your/image:latest',
            `    network_mode: "service:${name}"`,
            '    restart: unless-stopped',
            '',
            `# Published ports must stay on the "${name}" service in your Gluetun compose file.`,
            ...(portLines.length
                ? ['  # Example published ports on Gluetun (from current container):', `  # ${name}:`, '  #   ports:', ...portLines]
                : ['  # No published port bindings detected on this Gluetun container.']),
        ].join('\n');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(`${snippet}\n`);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/homelab/backups', authenticateToken, (req, res) => {
    try {
        if (!DATA_DIR) return res.json({ backups: [] });
        const dir = path.join(DATA_DIR, 'backups');
        if (!fs.existsSync(dir)) return res.json({ backups: [] });
        const backups = fs
            .readdirSync(dir)
            .filter((f) => f.endsWith('.tar.gz'))
            .map((f) => {
                const fp = path.join(dir, f);
                const st = fs.statSync(fp);
                return { name: f, size: st.size, mtime: st.mtime.toISOString() };
            })
            .sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime));
        res.json({ backups });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/homelab/backup-run', authenticateToken, async (req, res) => {
    try {
        const r = await runDataBackup();
        if (!r.ok) return res.status(500).json(r);
        res.json(r);
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

function maybeRunScheduledBackup() {
    const gui = readGuiEnv();
    const hrs = parseFloat(String(gui.GUI_BACKUP_INTERVAL_HOURS || '0'), 10);
    if (!DATA_DIR || !Number.isFinite(hrs) || hrs <= 0) return;
    const st = loadHomelabState();
    const last = st.lastScheduledBackupAt ? Date.parse(st.lastScheduledBackupAt) : 0;
    if (last && Date.now() - last < hrs * 3600000 - 60_000) return;
    runDataBackup().then((r) => {
        if (r.ok) mergeHomelabState({ lastScheduledBackupAt: new Date().toISOString() });
    });
}

// Start checker after a short delay
setTimeout(checkVPN, 15000);
setInterval(maybeRunScheduledBackup, 15 * 60 * 1000);

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Gluetun GUI API server running on http://localhost:${PORT}`);
    try {
        maybeRunScheduledBackup();
    } catch (e) {
        console.error('[Backup] Initial scheduled check failed:', e.message);
    }
});
