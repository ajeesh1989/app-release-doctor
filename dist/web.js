import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import AdmZip from "adm-zip";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = 3030;
// ============================================================
// REMOTE MCP CONFIGURATION
// ============================================================
const REMOTE_MCP_URL = process.env.APP_RELEASE_DOCTOR_REMOTE_URL ||
    "http://127.0.0.1:8787/mcp";
const REMOTE_MCP_TOKEN = process.env.APP_RELEASE_DOCTOR_TOKEN || "";
// ============================================================
// TEMPORARY DIRECTORIES
// ============================================================
const uploadDirectory = path.join(os.tmpdir(), "app-release-doctor");
const projectUploadDirectory = path.join(uploadDirectory, "flutter-projects");
const zipDirectory = path.join(uploadDirectory, "remote-zips");
fs.mkdirSync(uploadDirectory, {
    recursive: true,
});
fs.mkdirSync(projectUploadDirectory, {
    recursive: true,
});
fs.mkdirSync(zipDirectory, {
    recursive: true,
});
// ============================================================
// UPLOAD CONFIGURATION
// ============================================================
const upload = multer({
    dest: uploadDirectory,
    limits: {
        fileSize: 1024 * 1024 * 1024,
        files: 1,
    },
});
const projectUpload = multer({
    dest: projectUploadDirectory,
    limits: {
        fileSize: 20 * 1024 * 1024,
        files: 5000,
    },
});
// ============================================================
// EXPRESS
// ============================================================
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));
// ============================================================
// REMOTE MCP CLIENT
// ============================================================
let remoteClient = null;
let remoteConnecting = null;
async function createRemoteClient() {
    const client = new Client({
        name: "app-release-doctor-web",
        version: "2.0.0",
    }, {
        capabilities: {},
    });
    const headers = {};
    if (REMOTE_MCP_TOKEN) {
        headers.Authorization =
            `Bearer ${REMOTE_MCP_TOKEN}`;
    }
    const transport = new StreamableHTTPClientTransport(new URL(REMOTE_MCP_URL), {
        requestInit: {
            headers,
        },
    });
    // The installed MCP SDK version has a slightly
    // different Transport typing when
    // exactOptionalPropertyTypes is enabled.
    //
    // The runtime transport is compatible, so use the
    // same compatibility cast already used by remote-mcp.ts.
    const compatibleTransport = transport;
    await client.connect(compatibleTransport);
    return client;
}
async function getRemoteClient() {
    if (remoteClient) {
        return remoteClient;
    }
    if (remoteConnecting) {
        return remoteConnecting;
    }
    remoteConnecting =
        createRemoteClient()
            .then((client) => {
            remoteClient = client;
            remoteConnecting = null;
            console.log("🔗 Connected to remote App Release Doctor MCP");
            console.log(`   ${REMOTE_MCP_URL}`);
            return client;
        })
            .catch((error) => {
            remoteConnecting = null;
            throw error;
        });
    return remoteConnecting;
}
// ============================================================
// REMOTE MCP TOOL CALL
// ============================================================
async function callRemoteTool(toolName, argumentsObject) {
    let client = await getRemoteClient();
    try {
        const result = await client.callTool({
            name: toolName,
            arguments: argumentsObject,
        });
        return extractMcpText(result);
    }
    catch (error) {
        console.error(`Remote MCP tool "${toolName}" failed:`, error);
        remoteClient = null;
        try {
            await client.close();
        }
        catch {
            // Ignore close errors.
        }
        client = await getRemoteClient();
        const result = await client.callTool({
            name: toolName,
            arguments: argumentsObject,
        });
        return extractMcpText(result);
    }
}
// ============================================================
// MCP RESULT PARSER
// ============================================================
function extractMcpText(result) {
    if (result &&
        typeof result === "object") {
        const value = result;
        if (Array.isArray(value.content)) {
            const textParts = [];
            for (const item of value.content) {
                if (item &&
                    typeof item === "object") {
                    const contentItem = item;
                    if (contentItem.type === "text" &&
                        typeof contentItem.text ===
                            "string") {
                        textParts.push(contentItem.text);
                    }
                }
            }
            if (textParts.length > 0) {
                return textParts.join("\n");
            }
        }
        if (typeof value.structuredContent ===
            "string") {
            return value.structuredContent;
        }
        if (value.structuredContent &&
            typeof value.structuredContent ===
                "object") {
            return JSON.stringify(value.structuredContent, null, 2);
        }
    }
    return String(result ?? "");
}
// ============================================================
// REMOTE UPLOAD HELPERS
// ============================================================
async function uploadAabToRemote(filePath, originalName) {
    const buffer = fs.readFileSync(filePath);
    const formData = new FormData();
    formData.append("aab", new Blob([buffer], {
        type: "application/octet-stream",
    }), originalName);
    const headers = {};
    if (REMOTE_MCP_TOKEN) {
        headers.Authorization =
            `Bearer ${REMOTE_MCP_TOKEN}`;
    }
    const response = await fetch(REMOTE_MCP_URL.replace(/\/mcp$/, "/upload/aab"), {
        method: "POST",
        headers,
        body: formData,
    });
    const data = await parseRemoteJson(response);
    if (!response.ok ||
        !data.success ||
        typeof data.uploadId !==
            "string") {
        throw new Error(data.error ||
            "Remote AAB upload failed.");
    }
    return {
        uploadId: data.uploadId,
        fileName: data.fileName ||
            originalName,
    };
}
async function uploadProjectZipToRemote(zipPath, originalName) {
    const buffer = fs.readFileSync(zipPath);
    const formData = new FormData();
    formData.append("project", new Blob([buffer], {
        type: "application/zip",
    }), originalName);
    const headers = {};
    if (REMOTE_MCP_TOKEN) {
        headers.Authorization =
            `Bearer ${REMOTE_MCP_TOKEN}`;
    }
    const response = await fetch(REMOTE_MCP_URL.replace(/\/mcp$/, "/upload/project"), {
        method: "POST",
        headers,
        body: formData,
    });
    const data = await parseRemoteJson(response);
    if (!response.ok ||
        !data.success ||
        typeof data.uploadId !==
            "string") {
        throw new Error(data.error ||
            "Remote Flutter project upload failed.");
    }
    return {
        uploadId: data.uploadId,
        fileName: data.fileName ||
            originalName,
        fileCount: typeof data.fileCount ===
            "number"
            ? data.fileCount
            : undefined,
    };
}
async function parseRemoteJson(response) {
    const text = await response.text();
    if (!text) {
        return {};
    }
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error(`Remote server returned an invalid response (${response.status}).`);
    }
}
// ============================================================
// SAFE PATH HELPERS
// ============================================================
function safeRelativePath(input) {
    let value = String(input || "");
    value = value.replace(/\\/g, "/");
    value = value.replace(/^\/+/, "");
    value = value.replace(/^[A-Za-z]:\/+/, "");
    const parts = value
        .split("/")
        .filter((part) => part &&
        part !== "." &&
        part !== "..");
    return parts.join("/");
}
function removeDirectory(directory) {
    try {
        if (fs.existsSync(directory)) {
            fs.rmSync(directory, {
                recursive: true,
                force: true,
            });
        }
    }
    catch (error) {
        console.error("Temporary directory cleanup failed:", error);
    }
}
function removeFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
    catch {
        // Ignore cleanup errors.
    }
}
function isInsideDirectory(parentDirectory, targetPath) {
    const parent = path.resolve(parentDirectory);
    const target = path.resolve(targetPath);
    return (target === parent ||
        target.startsWith(parent + path.sep));
}
// ============================================================
// PROJECT ZIP CREATION
// ============================================================
function createProjectZip(files, zipPath) {
    const zip = new AdmZip();
    let fileCount = 0;
    let projectName = "flutter-project";
    for (const file of files) {
        const relativePath = safeRelativePath(file.originalname);
        if (!relativePath) {
            continue;
        }
        const lowerPath = relativePath.toLowerCase();
        const shouldIgnore = lowerPath
            .split("/")
            .some((part) => [
            ".git",
            ".dart_tool",
            ".idea",
            "build",
            ".gradle",
        ].includes(part));
        if (shouldIgnore) {
            continue;
        }
        const parts = relativePath.split("/");
        if (parts.length > 1 &&
            parts[0]) {
            projectName =
                parts[0] ?? projectName;
        }
        if (relativePath.toLowerCase() ===
            "pubspec.yaml") {
            projectName =
                "flutter-project";
        }
        if (relativePath
            .toLowerCase()
            .endsWith("/pubspec.yaml") &&
            parts[0]) {
            projectName =
                parts[0] ?? projectName;
        }
        const data = fs.readFileSync(file.path);
        zip.addFile(relativePath, data);
        fileCount++;
    }
    if (fileCount === 0) {
        throw new Error("No usable Flutter project files were found.");
    }
    zip.writeZip(zipPath);
    return {
        fileCount,
        projectName,
    };
}
// ============================================================
// STATUS
// ============================================================
app.get("/api/status", (_req, res) => {
    res.json({
        ok: true,
        name: "App Release Doctor",
        version: "2.0.0",
        service: "web",
        backend: "remote-mcp",
    });
});
// ============================================================
// AAB INSPECTOR
// ============================================================
app.post("/api/inspect-aab", upload.single("aab"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            ok: false,
            error: "No AAB file was uploaded.",
        });
    }
    const originalName = req.file.originalname ||
        "app.aab";
    if (!originalName
        .toLowerCase()
        .endsWith(".aab")) {
        removeFile(req.file.path);
        return res.status(400).json({
            ok: false,
            error: "Please upload an Android App Bundle (.aab) file.",
        });
    }
    try {
        console.log("");
        console.log("🩺 SMART AAB INSPECTION");
        console.log("-----------------------");
        console.log(`File: ${originalName}`);
        console.log("Backend: Remote MCP");
        console.log("");
        // ------------------------------------------------------
        // 1. Upload AAB to remote server
        // ------------------------------------------------------
        const uploaded = await uploadAabToRemote(req.file.path, originalName);
        console.log(`Remote uploadId: ${uploaded.uploadId}`);
        // ------------------------------------------------------
        // 2. Ask remote Doctor to inspect it
        // ------------------------------------------------------
        const report = await callRemoteTool("inspect_aab", {
            uploadId: uploaded.uploadId,
        });
        // ------------------------------------------------------
        // 3. Extract score from report
        // ------------------------------------------------------
        const scoreMatch = report.match(/RELEASE HEALTH[\s\S]*?(\d{1,3})\/100/i);
        const score = scoreMatch
            ? Math.min(100, Math.max(0, Number(scoreMatch[1])))
            : 0;
        const healthMatch = report.match(/RELEASE HEALTH[\s\S]*?\n[^\n]*\s+(HEALTHY|NEEDS REVIEW|ATTENTION NEEDED|SIGNIFICANT ISSUES)\s+\d{1,3}\/100/i);
        let health = healthMatch?.[1] ||
            "";
        if (!health) {
            if (score >= 90) {
                health =
                    "HEALTHY";
            }
            else if (score >= 70) {
                health =
                    "NEEDS REVIEW";
            }
            else if (score >= 40) {
                health =
                    "ATTENTION NEEDED";
            }
            else {
                health =
                    "SIGNIFICANT ISSUES";
            }
        }
        return res.json({
            ok: true,
            fileName: originalName,
            success: true,
            score,
            health,
            report,
        });
    }
    catch (error) {
        console.error("Remote AAB inspection failed:", error);
        return res.status(500).json({
            ok: false,
            error: error instanceof Error
                ? error.message
                : String(error),
        });
    }
    finally {
        removeFile(req.file.path);
    }
});
// ============================================================
// FLUTTER PROJECT UPLOAD
// ============================================================
app.post("/api/check-project-upload", projectUpload.array("projectFiles", 5000), async (req, res) => {
    const files = Array.isArray(req.files)
        ? req.files
        : [];
    if (files.length === 0) {
        return res.status(400).json({
            ok: false,
            error: "No Flutter project files were uploaded.",
        });
    }
    const projectId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    const zipPath = path.join(zipDirectory, `${projectId}.zip`);
    try {
        console.log("");
        console.log("📁 FLUTTER PROJECT UPLOAD");
        console.log("-------------------------");
        console.log(`Browser files: ${files.length}`);
        console.log("Backend: Remote MCP");
        console.log("");
        // ------------------------------------------------------
        // Check pubspec before creating ZIP
        // ------------------------------------------------------
        let pubspecFound = false;
        for (const file of files) {
            const relativePath = safeRelativePath(file.originalname);
            if (relativePath
                .toLowerCase() ===
                "pubspec.yaml") {
                pubspecFound = true;
                break;
            }
            if (relativePath
                .toLowerCase()
                .endsWith("/pubspec.yaml")) {
                pubspecFound = true;
                break;
            }
        }
        if (!pubspecFound) {
            return res.status(400).json({
                ok: false,
                error: "This does not appear to be a Flutter project. pubspec.yaml was not found.",
            });
        }
        // ------------------------------------------------------
        // Create ZIP locally
        // ------------------------------------------------------
        const zipInfo = createProjectZip(files, zipPath);
        console.log(`Created ZIP: ${zipPath}`);
        console.log(`ZIP files: ${zipInfo.fileCount}`);
        const zipStats = fs.statSync(zipPath);
        console.log(`ZIP size: ${zipStats.size} bytes`);
        // ------------------------------------------------------
        // Upload ZIP to remote Doctor
        // ------------------------------------------------------
        const uploaded = await uploadProjectZipToRemote(zipPath, `${zipInfo.projectName}.zip`);
        console.log(`Remote uploadId: ${uploaded.uploadId}`);
        // ------------------------------------------------------
        // Run remote Flutter project check
        // ------------------------------------------------------
        const report = await callRemoteTool("check_flutter_project", {
            uploadId: uploaded.uploadId,
        });
        return res.json({
            ok: true,
            projectPath: `remote:${uploaded.uploadId}`,
            projectName: zipInfo.projectName,
            fileCount: uploaded.fileCount ||
                zipInfo.fileCount,
            report,
        });
    }
    catch (error) {
        console.error("Remote Flutter project check failed:", error);
        return res.status(500).json({
            ok: false,
            error: error instanceof Error
                ? error.message
                : String(error),
        });
    }
    finally {
        removeFile(zipPath);
        for (const file of files) {
            removeFile(file.path);
        }
    }
});
// ============================================================
// LOCAL FLUTTER PROJECT CHECK
// ============================================================
app.post("/api/check-project", async (req, res) => {
    const projectPath = typeof req.body?.projectPath ===
        "string"
        ? req.body.projectPath.trim()
        : "";
    if (!projectPath) {
        return res.status(400).json({
            ok: false,
            error: "Project path is required.",
        });
    }
    try {
        if (!fs.existsSync(projectPath)) {
            return res.status(400).json({
                ok: false,
                error: "The specified project path does not exist.",
            });
        }
        const stat = fs.statSync(projectPath);
        if (!stat.isDirectory()) {
            return res.status(400).json({
                ok: false,
                error: "The specified project path is not a directory.",
            });
        }
        const pubspecPath = path.join(projectPath, "pubspec.yaml");
        if (!fs.existsSync(pubspecPath)) {
            return res.status(400).json({
                ok: false,
                error: "pubspec.yaml was not found. Please enter the root folder of a Flutter project.",
            });
        }
        console.log("");
        console.log("🩺 FLUTTER PROJECT CHECK");
        console.log("------------------------");
        console.log(`Project: ${projectPath}`);
        console.log("Backend: Local");
        console.log("");
        const { checkFlutterProject, } = await import("./doctor.js");
        const report = await checkFlutterProject(projectPath);
        return res.json({
            ok: true,
            projectPath,
            report,
        });
    }
    catch (error) {
        console.error("Local project check failed:", error);
        return res.status(500).json({
            ok: false,
            error: error instanceof Error
                ? error.message
                : String(error),
        });
    }
});
// ============================================================
// PLAY STORE READINESS
// ============================================================
app.post("/api/check-play-store-readiness", async (req, res) => {
    const projectPath = typeof req.body?.projectPath ===
        "string"
        ? req.body.projectPath.trim()
        : "";
    if (!projectPath) {
        return res.status(400).json({
            ok: false,
            error: "Project path is required.",
        });
    }
    try {
        if (!fs.existsSync(projectPath)) {
            return res.status(400).json({
                ok: false,
                error: "The specified project path does not exist.",
            });
        }
        const stat = fs.statSync(projectPath);
        if (!stat.isDirectory()) {
            return res.status(400).json({
                ok: false,
                error: "The specified project path is not a directory.",
            });
        }
        const pubspecPath = path.join(projectPath, "pubspec.yaml");
        if (!fs.existsSync(pubspecPath)) {
            return res.status(400).json({
                ok: false,
                error: "pubspec.yaml was not found. Please enter the root folder of a Flutter project.",
            });
        }
        console.log("");
        console.log("🩺 PLAY STORE READINESS");
        console.log("----------------------");
        console.log(`Project: ${projectPath}`);
        console.log("Backend: Local");
        console.log("");
        const { checkFlutterProject, } = await import("./doctor.js");
        const report = await checkFlutterProject(projectPath);
        return res.json({
            ok: true,
            projectPath,
            report,
        });
    }
    catch (error) {
        console.error("Play Store readiness check failed:", error);
        return res.status(500).json({
            ok: false,
            error: error instanceof Error
                ? error.message
                : String(error),
        });
    }
});
// ============================================================
// BUILD RELEASE
// ============================================================
app.post("/api/build-release", async (req, res) => {
    const projectPath = typeof req.body?.projectPath ===
        "string"
        ? req.body.projectPath.trim()
        : "";
    if (!projectPath) {
        return res.status(400).json({
            ok: false,
            error: "Project path is required.",
        });
    }
    try {
        console.log("");
        console.log("🔨 RELEASE BUILD");
        console.log("----------------");
        console.log(`Project: ${projectPath}`);
        console.log("");
        const { buildRelease, } = await import("./doctor.js");
        const report = await buildRelease(projectPath);
        return res.json({
            ok: true,
            projectPath,
            report,
        });
    }
    catch (error) {
        console.error("Release build failed:", error);
        return res.status(500).json({
            ok: false,
            error: error instanceof Error
                ? error.message
                : String(error),
        });
    }
});
// ============================================================
// API 404
// ============================================================
app.use("/api", (_req, res) => {
    res.status(404).json({
        ok: false,
        error: "API endpoint not found.",
    });
});
// ============================================================
// START WEB SERVER
// ============================================================
async function startWebServer() {
    console.log("");
    console.log("🔗 Connecting Web UI to Remote MCP...");
    console.log(`Remote MCP: ${REMOTE_MCP_URL}`);
    try {
        await getRemoteClient();
        console.log("✅ Remote MCP connection ready.");
    }
    catch (error) {
        console.error("");
        console.error("⚠️ Remote MCP connection failed.");
        console.error(error instanceof Error
            ? error.message
            : String(error));
        console.error("");
        console.error("The Web UI will still start.");
        console.error("Remote AAB/project operations will retry when used.");
        console.error("");
    }
    app.listen(PORT, "127.0.0.1", () => {
        console.log("");
        console.log("🩺 APP RELEASE DOCTOR");
        console.log("=====================");
        console.log(`Web UI: http://127.0.0.1:${PORT}`);
        console.log(`Remote MCP: ${REMOTE_MCP_URL}`);
        console.log("");
    });
}
startWebServer().catch((error) => {
    console.error("Fatal Web UI error:", error);
    process.exit(1);
});
//# sourceMappingURL=web.js.map