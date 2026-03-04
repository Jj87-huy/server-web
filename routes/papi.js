const express = require("express");
const router = express.Router();

const { requestPlaceholders } = require("../websocket");

/* ============================================
   CONFIG LIMITS (ANTI SPAM)
============================================ */

// Max placeholders per request
const MAX_PLACEHOLDERS = 50;

// Simple HTTP rate-limit memory
const RATE_LIMIT = {
    windowMs: 1000,
    maxRequests: 10
};

// Store { ip: { count, lastReset } }
const ipBuckets = {};

/* ============================================
   RATE LIMIT MIDDLEWARE
============================================ */

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!ipBuckets[ip]) {
        ipBuckets[ip] = {
            count: 0,
            lastReset: now
        };
    }

    const bucket = ipBuckets[ip];

    // Reset every window
    if (now - bucket.lastReset > RATE_LIMIT.windowMs) {
        bucket.count = 0;
        bucket.lastReset = now;
    }

    bucket.count++;

    if (bucket.count > RATE_LIMIT.maxRequests) {
        return res.status(429).json({
            code: 429,
            success: false,
            error: "Too many requests (HTTP rate-limit)"
        });
    }

    next();
}

/* ============================================
   POST /api/request-papi

Body hỗ trợ:

✅ Mode 1:
{
  "server_id": "survival-1",
  "placeholders": ["hp"]
}

✅ Mode 2:
{
  "server_ip": "103.12.45.67",
  "server_port": 25565,
  "placeholders": ["hp"]
}
============================================ */

router.post("/request-papi", rateLimit, async (req, res) => {

    const {
        server_id,
        server_ip,
        server_port,
        placeholders,
        player,
        exp
    } = req.body;

    /* ==============================
       BUILD IDENTITY
    ============================== */

    let identity = null;

    // ✅ Mode 1: server_id
    if (server_id && typeof server_id === "string") {
        identity = server_id;
    }

    // ✅ Mode 2: server_ip + port
    else if (server_ip && server_port) {

        if (typeof server_ip !== "string") {
            return res.status(400).json({
                code: 400,
                success: false,
                error: "Invalid server_ip"
            });
        }

        if (typeof server_port !== "number") {
            return res.status(400).json({
                code: 400,
                success: false,
                error: "Invalid server_port"
            });
        }

        identity = `${server_ip}:${server_port}`;
    }

    // ❌ Missing both
    else {
        return res.status(400).json({
            code: 400,
            success: false,
            error: "Must provide server_id OR server_ip + server_port"
        });
    }

    /* ==============================
       EXPANSION
    ============================== */

    let expansion = "default";
    if (exp && typeof exp === "string") {
        expansion = exp.toLowerCase();
    }

    /* ==============================
       PLACEHOLDER VALIDATION
    ============================== */

    if (!Array.isArray(placeholders) || placeholders.length === 0) {
        return res.status(400).json({
            code: 400,
            success: false,
            error: "placeholders must be a non-empty array"
        });
    }

    if (placeholders.length > MAX_PLACEHOLDERS) {
        return res.status(400).json({
            code: 400,
            success: false,
            error: `Too many placeholders (max ${MAX_PLACEHOLDERS})`
        });
    }

    for (const p of placeholders) {
        if (typeof p !== "string" || p.length > 100) {
            return res.status(400).json({
                code: 400,
                success: false,
                error: "Invalid placeholder format"
            });
        }
    }

    /* ==============================
       PLAYER VALIDATION
    ============================== */

    if (player && (typeof player !== "string" || player.length > 16)) {
        return res.status(400).json({
            code: 400,
            success: false,
            error: "Invalid player name"
        });
    }

    /* ==============================
       REQUEST TO WS BRIDGE
    ============================== */

    try {

        const results = await requestPlaceholders(
            identity,
            expansion,
            placeholders,
            player ?? null
        );

        return res.json({
            code: 200,
            success: true,
            identity,
            exp: expansion,
            player: player ?? null,
            results
        });

    } catch (err) {

        const msg = err.message || err.toString();

        console.error("[PAPI REQUEST ERROR]", msg);

        if (msg.includes("Server not online")) {
            return res.status(503).json({
                code: 503,
                success: false,
                error: "Minecraft server offline"
            });
        }

        if (msg.includes("Rate-limit blocked")) {
            return res.status(429).json({
                code: 429,
                success: false,
                error: "Rate-limit blocked (WS backend)"
            });
        }

        if (msg.includes("Timeout")) {
            return res.status(504).json({
                code: 504,
                success: false,
                error: "Timeout waiting Minecraft response"
            });
        }

        return res.status(500).json({
            code: 500,
            success: false,
            error: msg
        });
    }
});

module.exports = router;