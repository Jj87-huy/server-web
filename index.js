const express = require("express");
const app = express();

//const botControl = require("./system/bot/minecraft/bot.js");
//botControl.startBot();

// ============================================
// MIDDLEWARE
// ============================================

// Allow JSON body
app.use(express.json());


// ============================================
// START WEBSOCKET SERVER
// ============================================

// This will start ws://localhost:26453
require("./websocket");

// ============================================
// ROUTES
// ============================================

// API endpoint: http://localhost:80/api/request-papi
app.use("/api", require("./routes/papi"));
//app.use("/api/minecraft", require("./routes/mcapi"));
//app.use("/", require("./routes/status"));

// ============================================
// START HTTP SERVER
// ============================================

const HTTP_PORT = 80;

app.listen(HTTP_PORT, "0.0.0.0", () => {
    console.log("🚀 Web API running at:");
    console.log(`   http://localhost:${HTTP_PORT}`);
});