import express from "express";
import crypto from "crypto";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { pipeline } from "stream/promises";
import unzipper from "unzipper";
import { StreamableHTTPServerTransport, } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./index.js";
import { createAabWorkspace, createProjectWorkspace, resolveProjectFilePath, cleanupExpiredRemoteWorkspaces, removeRemoteWorkspace, } from "./remote-workspace.js";
const app = express();
const PORT = Number(process.env.PORT) || 8787;
const MCP_PATH = "/mcp";
const MCP_TOKEN = process.env.APP_RELEASE_DOCTOR_TOKEN || "";
// ============================================================
// LIMITS
// ============================================================
const MAX_AAB_SIZE = 1024 * 1024 * 1024;
const MAX_PROJECT_ZIP_SIZE = 500 * 1024 * 1024;
const MAX_PROJECT_FILE_SIZE = 20 * 1024 * 1024;
const MAX_PROJECT_FILES = 5000;
const MAX_PROJECT_TOTAL_SIZE = 1024 * 1024 * 1024;
// ============================================================
// TEMPORARY UPLOAD CONFIGURATION
// ============================================================
// Flutter project ZIP files are written to disk instead of RAM.
// This is important for large project ZIP files.
const PROJECT_UPLOAD_DIRECTORY = path.join(os.tmpdir(), "app-release-doctor-uploads");
await fs.mkdir(PROJECT_UPLOAD_DIRECTORY, {
    recursive: true,
});
// AAB uploads remain memory-based because the existing
// AAB inspection flow is already working.
const aabUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_AAB_SIZE,
        files: 1,
    },
});
// Flutter project ZIP uploads use disk storage.
const projectUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            cb(null, PROJECT_UPLOAD_DIRECTORY);
        },
        filename: (_req, file, cb) => {
            const extension = path.extname(file.originalname || "");
            cb(null, `${crypto.randomUUID()}${extension}`);
        },
    }),
    limits: {
        fileSize: MAX_PROJECT_ZIP_SIZE,
        files: 1,
    },
});
// ============================================================
// BASIC EXPRESS CONFIGURATION
// ============================================================
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
        "http://localhost:3030",
        "http://127.0.0.1:3030",
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
app.use((req, res, next) => {
    if (req.path === "/health") {
        return next();
    }
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
// ZIP PATH HELPERS
// ============================================================
function normalizeZipPath(filePath) {
    return filePath
        .replace(/\\/g, "/")
        .replace(/^\/+/, "");
}
function isSafeZipPath(filePath) {
    if (!filePath) {
        return false;
    }
    if (filePath.startsWith("/") ||
        filePath.includes("\0")) {
        return false;
    }
    const parts = filePath.split("/");
    if (parts.some((part) => part === "..")) {
        return false;
    }
    return true;
}
function shouldIgnoreZipPath(filePath) {
    const parts = filePath.split("/");
    return parts.some((part) => part === ".git" ||
        part === ".dart_tool" ||
        part === ".idea" ||
        part === "build" ||
        part === ".gradle");
}
function findFlutterProjectRoot(entries) {
    const candidates = new Set();
    for (const entry of entries) {
        if (entry.type === "Directory") {
            continue;
        }
        const normalized = normalizeZipPath(entry.path);
        if (!isSafeZipPath(normalized)) {
            continue;
        }
        const parts = normalized.split("/");
        const pubspecIndex = parts.findIndex((part) => part.toLowerCase() ===
            "pubspec.yaml");
        if (pubspecIndex === -1) {
            continue;
        }
        const rootParts = parts.slice(0, pubspecIndex);
        candidates.add(rootParts.join("/"));
    }
    if (candidates.has("")) {
        return "";
    }
    if (candidates.size === 0) {
        return "";
    }
    const sorted = Array.from(candidates).sort((a, b) => a.length - b.length);
    return sorted[0] ?? "";
}
// ============================================================
// REMOTE AAB UPLOAD
// ============================================================
app.post("/upload/aab", aabUpload.single("aab"), async (req, res) => {
    let workspaceDirectory;
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: "No AAB file was uploaded.",
            });
        }
        const originalName = req.file.originalname || "";
        if (!originalName
            .toLowerCase()
            .endsWith(".aab")) {
            return res.status(400).json({
                success: false,
                error: "Only Android App Bundle (.aab) files are allowed.",
            });
        }
        // IMPORTANT:
        // Preserve the original uploaded filename.
        const { workspace, aabPath, } = await createAabWorkspace(originalName);
        workspaceDirectory =
            workspace.directory;
        await fs.writeFile(aabPath, req.file.buffer);
        return res.json({
            success: true,
            type: "aab",
            uploadId: workspace.id,
            fileName: originalName,
            size: req.file.size,
            expiresAt: new Date(workspace.expiresAt).toISOString(),
        });
    }
    catch (error) {
        if (workspaceDirectory) {
            await removeRemoteWorkspace(workspaceDirectory).catch(() => { });
        }
        console.error("Remote AAB upload failed:", error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error
                ? error.message
                : String(error),
        });
    }
});
// ============================================================
// REMOTE FLUTTER PROJECT ZIP UPLOAD
// ============================================================
app.post("/upload/project", projectUpload.single("project"), async (req, res) => {
    let workspaceDirectory;
    let uploadedZipPath;
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: "No Flutter project ZIP was uploaded.",
            });
        }
        uploadedZipPath =
            req.file.path;
        const originalName = req.file.originalname || "";
        if (!originalName
            .toLowerCase()
            .endsWith(".zip")) {
            return res.status(400).json({
                success: false,
                error: "Flutter project upload must be a ZIP file.",
            });
        }
        // ========================================================
        // OPEN ZIP FROM DISK
        // ========================================================
        //
        // IMPORTANT:
        //
        // Do NOT use AdmZip here.
        //
        // AdmZip loads the entire archive into memory.
        // That can exceed Render's 512 MB memory limit when
        // processing large Flutter project ZIP files.
        //
        // unzipper.Open.file() reads the ZIP directory and lets
        // us stream individual files directly to disk.
        //
        let directory;
        try {
            directory =
                await unzipper.Open.file(uploadedZipPath);
        }
        catch {
            return res.status(400).json({
                success: false,
                error: "The uploaded file is not a valid ZIP archive.",
            });
        }
        const entries = directory.files;
        if (entries.length === 0) {
            return res.status(400).json({
                success: false,
                error: "The uploaded ZIP file is empty.",
            });
        }
        // ========================================================
        // FIND FLUTTER PROJECT ROOT
        // ========================================================
        const projectRoot = findFlutterProjectRoot(entries);
        // ========================================================
        // FIND PUBSPEC
        // ========================================================
        const pubspecEntry = directory.files.find((entry) => {
            if (entry.type ===
                "Directory") {
                return false;
            }
            const normalized = normalizeZipPath(entry.path);
            if (!isSafeZipPath(normalized)) {
                return false;
            }
            if (projectRoot) {
                const prefix = `${projectRoot}/`;
                if (!normalized.startsWith(prefix)) {
                    return false;
                }
                const relative = normalized.slice(prefix.length);
                return (relative.toLowerCase() ===
                    "pubspec.yaml");
            }
            return (normalized.toLowerCase() ===
                "pubspec.yaml");
        });
        if (!pubspecEntry) {
            return res.status(400).json({
                success: false,
                error: "No Flutter pubspec.yaml was found in the uploaded ZIP.",
            });
        }
        // ========================================================
        // CREATE PROJECT WORKSPACE
        // ========================================================
        const { workspace, projectPath, } = await createProjectWorkspace();
        workspaceDirectory =
            workspace.directory;
        let extractedFiles = 0;
        let extractedBytes = 0;
        // ========================================================
        // STREAM ZIP FILES TO DISK
        // ========================================================
        for (const entry of directory.files) {
            if (entry.type ===
                "Directory") {
                continue;
            }
            let normalized = normalizeZipPath(entry.path);
            // ------------------------------------------------------
            // SECURITY
            // ------------------------------------------------------
            if (!isSafeZipPath(normalized)) {
                throw new Error(`Unsafe ZIP file path: ${entry.path}`);
            }
            // ------------------------------------------------------
            // IGNORE GENERATED / TOOLING DIRECTORIES
            // ------------------------------------------------------
            if (shouldIgnoreZipPath(normalized)) {
                continue;
            }
            // ------------------------------------------------------
            // STRIP PROJECT ROOT
            // ------------------------------------------------------
            if (projectRoot) {
                const prefix = `${projectRoot}/`;
                if (normalized ===
                    projectRoot) {
                    continue;
                }
                if (!normalized.startsWith(prefix)) {
                    continue;
                }
                normalized =
                    normalized.slice(prefix.length);
            }
            if (!normalized) {
                continue;
            }
            // ------------------------------------------------------
            // FILE COUNT LIMIT
            // ------------------------------------------------------
            if (extractedFiles >=
                MAX_PROJECT_FILES) {
                throw new Error(`Flutter project contains more than ${MAX_PROJECT_FILES} files.`);
            }
            // ------------------------------------------------------
            // INDIVIDUAL FILE SIZE LIMIT
            // ------------------------------------------------------
            const entrySize = Number(entry.uncompressedSize ?? 0);
            if (entrySize >
                MAX_PROJECT_FILE_SIZE) {
                throw new Error(`Project file is too large: ${normalized}`);
            }
            // ------------------------------------------------------
            // TOTAL EXTRACTION SIZE LIMIT
            // ------------------------------------------------------
            extractedBytes +=
                entrySize;
            if (extractedBytes >
                MAX_PROJECT_TOTAL_SIZE) {
                throw new Error("Extracted Flutter project exceeds the 1 GB limit.");
            }
            // ------------------------------------------------------
            // DESTINATION
            // ------------------------------------------------------
            const destination = resolveProjectFilePath(projectPath, normalized);
            await fs.mkdir(path.dirname(destination), {
                recursive: true,
            });
            // ------------------------------------------------------
            // STREAM ENTRY DIRECTLY TO DISK
            // ------------------------------------------------------
            //
            // This is the key memory optimization.
            //
            // The file is NOT converted into a Buffer.
            //
            // ZIP entry -> stream -> destination file
            //
            const readStream = await entry.stream();
            await pipeline(readStream, (await import("fs")).createWriteStream(destination));
            extractedFiles++;
        }
        // ========================================================
        // VERIFY PUBSPEC AT PROJECT ROOT
        // ========================================================
        const pubspecPath = resolveProjectFilePath(projectPath, "pubspec.yaml");
        try {
            await fs.access(pubspecPath);
        }
        catch {
            throw new Error("Flutter project extraction failed because pubspec.yaml was not found at the project root.");
        }
        // ========================================================
        // SUCCESS
        // ========================================================
        return res.json({
            success: true,
            type: "flutter-project",
            uploadId: workspace.id,
            fileName: originalName,
            size: req.file.size,
            fileCount: extractedFiles,
            extractedBytes,
            projectRoot: projectRoot || null,
            expiresAt: new Date(workspace.expiresAt).toISOString(),
        });
    }
    catch (error) {
        if (workspaceDirectory) {
            await removeRemoteWorkspace(workspaceDirectory).catch(() => { });
        }
        console.error("Remote Flutter project upload failed:", error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error
                ? error.message
                : String(error),
        });
    }
    finally {
        // Always delete the temporary uploaded ZIP.
        if (uploadedZipPath) {
            await fs
                .unlink(uploadedZipPath)
                .catch(() => { });
        }
    }
});
// ============================================================
// REMOTE WORKSPACE CLEANUP
// ============================================================
await cleanupExpiredRemoteWorkspaces();
setInterval(() => {
    cleanupExpiredRemoteWorkspaces()
        .catch((error) => {
        console.error("Remote workspace cleanup failed:", error);
    });
}, 10 * 60 * 1000);
// ============================================================
// MCP AUTHENTICATION
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
const sessions = new Map();
// ============================================================
// MCP REQUEST HANDLER
// ============================================================
app.all(MCP_PATH, async (req, res) => {
    try {
        const sessionId = req.headers["mcp-session-id"];
        // --------------------------------------------------------
        // EXISTING SESSION
        // --------------------------------------------------------
        if (sessionId) {
            const session = sessions.get(sessionId);
            if (!session) {
                return res.status(404).json({
                    error: "MCP session not found or expired.",
                });
            }
            await session.transport.handleRequest(req, res, req.body);
            return;
        }
        // --------------------------------------------------------
        // NEW SESSION
        // --------------------------------------------------------
        if (req.method !== "POST") {
            return res.status(400).json({
                error: "MCP session has not been initialized.",
            });
        }
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => {
                return crypto.randomUUID();
            },
        });
        // IMPORTANT:
        //
        // Create a completely new MCP server instance
        // for every Streamable HTTP session.
        //
        // The exported singleton server from index.ts is
        // intentionally NOT used here because a single
        // McpServer instance cannot connect to multiple
        // transports.
        const sessionServer = createServer();
        const compatibleTransport = transport;
        try {
            await sessionServer.connect(compatibleTransport);
        }
        catch (error) {
            console.error("MCP server connection failed:", error);
            if (!res.headersSent) {
                return res.status(500).json({
                    error: error instanceof Error
                        ? error.message
                        : String(error),
                });
            }
            return;
        }
        let createdSessionId;
        transport.onclose =
            async () => {
                if (createdSessionId) {
                    sessions.delete(createdSessionId);
                }
                try {
                    await sessionServer.close();
                }
                catch {
                    // Already closed.
                }
            };
        await transport.handleRequest(req, res, req.body);
        createdSessionId =
            transport.sessionId;
        if (createdSessionId) {
            sessions.set(createdSessionId, {
                server: sessionServer,
                transport,
                initialized: true,
            });
        }
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
// START SERVER
// ============================================================
app.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("🩺 APP RELEASE DOCTOR");
    console.log("---------------------");
    console.log(`Remote MCP server running on port ${PORT}`);
    console.log(`MCP endpoint: http://localhost:${PORT}${MCP_PATH}`);
    console.log(`Health: http://localhost:${PORT}/health`);
    console.log(`AAB upload: http://localhost:${PORT}/upload/aab`);
    console.log(`Project upload: http://localhost:${PORT}/upload/project`);
    console.log("");
});
//# sourceMappingURL=remote-mcp.js.map