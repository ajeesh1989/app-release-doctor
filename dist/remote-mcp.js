import express from "express";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport, } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { server } from "./index.js";
const app = express();
const PORT = Number(process.env.PORT) || 8787;
const MCP_PATH = "/mcp";
const MCP_TOKEN = process.env.APP_RELEASE_DOCTOR_TOKEN ||
    "";
app.use(express.json({
    limit: "10mb",
}));
// ============================================================
// BASIC SECURITY
// ============================================================
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = [
        "https://chatgpt.com",
        "https://chat.openai.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        // MCP Inspector
        "http://localhost:6274",
        "http://127.0.0.1:6274",
    ];
    if (origin &&
        !allowedOrigins.includes(origin)) {
        return res.status(403).json({
            error: "Origin is not allowed.",
        });
    }
    next();
});
// ============================================================
// AUTHENTICATION
// ============================================================
app.use(MCP_PATH, (req, res, next) => {
    if (!MCP_TOKEN) {
        return next();
    }
    const authorization = req.headers.authorization || "";
    const expected = `Bearer ${MCP_TOKEN}`;
    if (authorization !== expected) {
        return res.status(401).json({
            error: "Unauthorized.",
        });
    }
    next();
});
// ============================================================
// MCP TRANSPORT
// ============================================================
const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
});
// ============================================================
// CONNECT DOCTOR SERVER
// ============================================================
const compatibleTransport = transport;
await server.connect(compatibleTransport);
// ============================================================
// MCP ENDPOINT
// ============================================================
app.all(MCP_PATH, async (req, res) => {
    try {
        await transport.handleRequest(req, res, req.body);
    }
    catch (error) {
        console.error("MCP request failed:", error);
        if (!res.headersSent) {
            res.status(500).json({
                error: error instanceof Error
                    ? error.message
                    : String(error),
            });
        }
    }
});
// ============================================================
// HEALTH CHECK
// ============================================================
app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        service: "app-release-doctor",
        transport: "streamable-http",
        endpoint: MCP_PATH,
    });
});
// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("🩺 APP RELEASE DOCTOR");
    console.log("---------------------");
    console.log(`Remote MCP server running on port ${PORT}`);
    console.log(`MCP endpoint: http://localhost:${PORT}${MCP_PATH}`);
    console.log(`Health: http://localhost:${PORT}/health`);
    console.log("");
});
//# sourceMappingURL=remote-mcp.js.map