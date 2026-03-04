const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

/* ============================================
   CONFIG
============================================ */
const PORT = 25178;

const KEYS_FILE = path.join(__dirname, "data", "keys.json");
const LOCK_FILE = path.join(__dirname, "data", "key.lock.json");

const REQUEST_TIMEOUT = 5000;
const HEARTBEAT_INTERVAL = 15000;

// Rate-limit
const MAX_REQUESTS_PER_SECOND = 20;
const BLOCK_TIME_SECONDS = 5;

/* ============================================
   STORAGE
============================================ */

let VALID_KEYS = [];
let KEY_LOCKS = {};

// Connected servers
// serverKey => ws
const minecraftServers = {};

// Pending Requests
const pendingRequests = new Map();

// Rate-limit state
const rateLimitMap = {};

/* ============================================
   LOAD FILES
============================================ */

function loadKeys() {
    try {
        const raw = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));

        if (!raw.key || !Array.isArray(raw.key)) {
            console.error("❌ keys.json invalid format, must be { key: [] }");
            VALID_KEYS = [];
            return;
        }

        VALID_KEYS = raw.key;
        console.log("🔑 Loaded keys:", VALID_KEYS.length);

    } catch (err) {
        console.error("❌ Cannot load keys.json:", err.message);
        VALID_KEYS = [];
    }
}

function loadLocks() {
    try {
        if (!fs.existsSync(LOCK_FILE)) {
            fs.writeFileSync(LOCK_FILE, JSON.stringify({}, null, 2));
        }

        KEY_LOCKS = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
        console.log("🔒 Loaded locks:", Object.keys(KEY_LOCKS).length);

    } catch (err) {
        console.error("❌ Cannot load key.lock.json:", err.message);
        KEY_LOCKS = {};
    }
}

function saveLocks() {
    try {
        fs.writeFileSync(LOCK_FILE, JSON.stringify(KEY_LOCKS, null, 2));
    } catch (err) {
        console.error("❌ Failed saving key.lock.json:", err.message);
    }
}

loadKeys();
loadLocks();

/* ============================================
   START WEBSOCKET SERVER
============================================ */

const wss = new WebSocket.Server({ port: PORT });
console.log(`🚀 WebSocket running on port ${PORT}`);

/* ============================================
   HEARTBEAT SYSTEM
============================================ */

function heartbeat() {
    this.isAlive = true;
}

setInterval(() => {
    wss.clients.forEach((ws) => {

        if (!ws.isAlive) {
            console.log("💀 Dead socket terminated:", ws.serverKey || "unknown");
            return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
    });
}, HEARTBEAT_INTERVAL);

/* ============================================
   SAFE SEND
============================================ */

function safeSend(ws, obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
}

/* ============================================
   RATE LIMIT CHECK
============================================ */

function checkRateLimit(serverKey) {

    const now = Date.now();

    if (!rateLimitMap[serverKey]) {
        rateLimitMap[serverKey] = {
            count: 0,
            lastSecond: now,
            blockedUntil: 0
        };
    }

    const state = rateLimitMap[serverKey];

    if (now < state.blockedUntil) return false;

    if (now - state.lastSecond >= 1000) {
        state.lastSecond = now;
        state.count = 0;
    }

    state.count++;

    if (state.count > MAX_REQUESTS_PER_SECOND) {
        state.blockedUntil = now + BLOCK_TIME_SECONDS * 1000;
        console.log(`⚠ Rate-limit BLOCKED server: ${serverKey}`);
        return false;
    }

    return true;
}

/* ============================================
   HANDLE CONNECTION
============================================ */

wss.on("connection", (ws, req) => {

    console.log("📡 Incoming Minecraft connection...");

    ws.isAuthed = false;
    ws.isAlive = true;

    ws.remoteIp = req.socket.remoteAddress.replace("::ffff:", "");

    ws.on("pong", heartbeat);

    ws.on("message", (raw) => {

        let data;

        try {
            data = JSON.parse(raw);
        } catch {
            return safeSend(ws, { error: "Invalid JSON format" });
        }

        /* ============================================
           AUTH HANDSHAKE
        ============================================ */
        if (data.type === "auth") {

            const apiKey = data.api_key;

            const serverId = data.server_id || "";
            const serverIp = data.server_ip || "";
            const serverPort = data.server_port || "";

            if (!apiKey) {
                safeSend(ws, { error: "Missing api_key" });
                return ws.close();
            }

            if (!VALID_KEYS.includes(apiKey)) {
                safeSend(ws, { error: "Key not allowed" });
                return ws.close();
            }

            if (!serverId && !serverIp) {
                safeSend(ws, { error: "Must provide server_id or server_ip" });
                return ws.close();
            }

            /* ============================================
               KEY LOCK CHECK (x2 SECURITY)
            ============================================ */

            if (KEY_LOCKS[apiKey]) {

                const locked = KEY_LOCKS[apiKey];

                // Case 1: Both locked -> must match BOTH
                if (locked.server_id && locked.server_ip) {
                    if (locked.server_id !== serverId || locked.server_ip !== serverIp) {
                        safeSend(ws, {
                            error: "Key locked (ID + IP mismatch)",
                            locked_info: locked
                        });
                        return ws.close();
                    }
                }

                // Case 2: Only server_id locked
                else if (locked.server_id) {
                    if (locked.server_id !== serverId) {
                        safeSend(ws, {
                            error: "Key locked (server_id mismatch)",
                            locked_info: locked
                        });
                        return ws.close();
                    }
                }

                // Case 3: Only server_ip locked
                else if (locked.server_ip) {
                    if (locked.server_ip !== serverIp) {
                        safeSend(ws, {
                            error: "Key locked (server_ip mismatch)",
                            locked_info: locked
                        });
                        return ws.close();
                    }
                }
            }

            /* ============================================
               FIRST CLAIM SAVE
            ============================================ */

            if (!KEY_LOCKS[apiKey]) {

                KEY_LOCKS[apiKey] = {
                    server_id: serverId || null,
                    server_ip: serverIp || null,
                    server_port: serverPort || null
                };

                saveLocks();
                console.log(`🔒 Key claimed: ${apiKey}`);
            }

            /* ============================================
               REGISTER CONNECTION
            ============================================ */

            let serverKey = null;

            if (serverId) {
                serverKey = serverId;
            } else {
                serverKey = `${serverIp}:${serverPort}`;
            }

            if (minecraftServers[serverKey]) {
                safeSend(ws, { error: "Server already connected" });
                return ws.close();
            }

            ws.serverKey = serverKey;
            ws.serverId = serverId;
            ws.serverIp = serverIp;
            ws.serverPort = serverPort;

            ws.apiKey = apiKey;
            ws.isAuthed = true;

            minecraftServers[serverKey] = ws;

            safeSend(ws, {
                success: true,
                message: "Auth OK",
                server_key: serverKey,
                locked: KEY_LOCKS[apiKey]
            });

            console.log(`✅ Server Auth OK: serverKey=${serverKey}`);
            return;
        }

        // Reject non-authed
        if (!ws.isAuthed) {
            return safeSend(ws, { error: "Not authenticated" });
        }

        /* ============================================
           RESPONSE FROM MINECRAFT
        ============================================ */
        if (data.type === "response") {

            const requestId = data.request_id;

            if (!pendingRequests.has(requestId)) {
                console.log("⚠ Unknown request:", requestId);
                return;
            }

            const reqObj = pendingRequests.get(requestId);

            clearTimeout(reqObj.timeout);

            reqObj.resolve(data.results);

            pendingRequests.delete(requestId);
            return;
        }
    });

    /* ============================================
       DISCONNECT CLEANUP
    ============================================ */

    ws.on("close", () => {

        if (!ws.serverKey) return;

        console.log(`❌ Server disconnected: ${ws.serverKey}`);

        delete minecraftServers[ws.serverKey];

        for (const [id, reqObj] of pendingRequests.entries()) {
            if (reqObj.serverKey === ws.serverKey) {
                clearTimeout(reqObj.timeout);
                reqObj.reject("Server disconnected");
                pendingRequests.delete(id);
            }
        }
    });
});

/* ============================================
   API FUNCTION (HTTP CALL)
============================================ */

function requestPlaceholders(
    serverKey,
    exp = "default",
    placeholders,
    player = null
) {

    return new Promise((resolve, reject) => {

        const ws = minecraftServers[serverKey];

        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return reject("Server not online");
        }

        if (!checkRateLimit(serverKey)) {
            return reject("Rate-limit blocked");
        }

        const requestId =
            Date.now().toString() +
            "_" +
            Math.random().toString(36).substring(2);

        const timeout = setTimeout(() => {
            pendingRequests.delete(requestId);
            reject("Timeout waiting Minecraft response");
        }, REQUEST_TIMEOUT);

        pendingRequests.set(requestId, {
            resolve,
            reject,
            timeout,
            serverKey
        });

        safeSend(ws, {
            action: "get_papi_bulk",
            request_id: requestId,
            exp,
            placeholders,
            player
        });
    });
}

/* ============================================
   EXPORT
============================================ */

module.exports = {
    minecraftServers,
    requestPlaceholders,
    loadKeys,
    loadLocks
};