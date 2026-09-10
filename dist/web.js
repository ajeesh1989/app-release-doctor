import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { inspectAab, checkFlutterProject, buildRelease, } from "./doctor.js";
// ==================================================
// PATH SETUP
// ==================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ==================================================
// APP CONFIG
// ==================================================
const app = express();
const PORT = 3030;
// ==================================================
// TEMP DIRECTORIES
// ==================================================
const uploadDirectory = path.join(os.tmpdir(), "app-release-doctor");
const projectUploadDirectory = path.join(uploadDirectory, "flutter-projects");
fs.mkdirSync(uploadDirectory, {
    recursive: true,
});
fs.mkdirSync(projectUploadDirectory, {
    recursive: true,
});
// ==================================================
// MULTER CONFIGURATION
// ==================================================
const upload = multer({
    dest: uploadDirectory,
    limits: {
        fileSize: 1024 * 1024 * 1024,
        files: 5000,
    },
});
const projectUpload = multer({
    dest: uploadDirectory,
    limits: {
        fileSize: 20 * 1024 * 1024,
        files: 5000,
    },
});
// ==================================================
// MIDDLEWARE
// ==================================================
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));
// ==================================================
// HELPERS
// ==================================================
function safeRelativePath(input) {
    let value = String(input || "");
    value = value.replace(/\\/g, "/");
    // Remove leading slash characters.
    value = value.replace(/^\/+/, "");
    // Remove Windows drive prefixes.
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
// ==================================================
// HEALTH / STATUS
// ==================================================
app.get("/api/status", (_req, res) => {
    res.json({
        ok: true,
        name: "App Release Doctor",
        version: "2.0.0",
        service: "web",
    });
});
// ==================================================
// AAB INSPECTION
// ==================================================
app.post("/api/inspect-aab", upload.single("aab"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            ok: false,
            error: "No AAB file was uploaded.",
        });
    }
    const originalName = req.file.originalname || "";
    const originalNameLower = originalName.toLowerCase();
    if (!originalNameLower.endsWith(".aab")) {
        removeFile(req.file.path);
        return res.status(400).json({
            ok: false,
            error: "Please upload an Android App Bundle (.aab) file.",
        });
    }
    const uploadedPath = `${req.file.path}.aab`;
    try {
        fs.renameSync(req.file.path, uploadedPath);
        console.log("");
        console.log("🩺 SMART AAB INSPECTION");
        console.log("-----------------------");
        console.log(`File: ${originalName}`);
        console.log(`Temp: ${uploadedPath}`);
        console.log("");
        const result = await inspectAab(uploadedPath);
        return res.json({
            ok: result.success,
            fileName: originalName,
            success: result.success,
            score: result.score,
            health: result.health,
            report: result.report,
        });
    }
    catch (error) {
        console.error("AAB inspection failed:", error);
        return res.status(500).json({
            ok: false,
            error: error instanceof Error
                ? error.message
                : String(error),
        });
    }
    finally {
        removeFile(uploadedPath);
        removeFile(req.file.path);
    }
});
// ==================================================
// FLUTTER PROJECT - LOCAL PATH
// ==================================================
app.post("/api/check-project", async (req, res) => {
    const projectPath = typeof req.body?.projectPath === "string"
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
        console.log("🩺 FLUTTER PROJECT CHECK");
        console.log("------------------------");
        console.log(`Project: ${projectPath}`);
        console.log("");
        const report = await checkFlutterProject(projectPath);
        return res.json({
            ok: true,
            projectPath,
            report,
        });
    }
    catch (error) {
        console.error("Project check failed:", error);
        return res.status(500).json({
            ok: false,
            error: error instanceof Error
                ? error.message
                : String(error),
        });
    }
});
// ==================================================
// PLAY STORE READINESS
// ==================================================
//
// This performs the same real Flutter Android
// project inspection used by the release checks.
//
// The frontend sends the local project path.
// The result is interpreted by app.js as the
// Play Store readiness report.
//
// ==================================================
app.post("/api/check-play-store-readiness", async (req, res) => {
    const projectPath = typeof req.body?.projectPath === "string"
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
        console.log("");
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
// ==================================================
// FLUTTER PROJECT - FOLDER UPLOAD
// ==================================================
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
    const projectRoot = path.join(projectUploadDirectory, projectId);
    try {
        fs.mkdirSync(projectRoot, {
            recursive: true,
        });
        console.log("");
        console.log("📁 FLUTTER PROJECT UPLOAD");
        console.log("-------------------------");
        console.log(`Files: ${files.length}`);
        console.log(`Temp: ${projectRoot}`);
        console.log("");
        let pubspecFound = false;
        for (const file of files) {
            const relativePath = safeRelativePath(file.originalname);
            if (!relativePath) {
                removeFile(file.path);
                continue;
            }
            const destination = path.resolve(projectRoot, relativePath);
            // Security check against path traversal.
            if (!isInsideDirectory(projectRoot, destination)) {
                console.warn(`Skipped unsafe uploaded path: ${file.originalname}`);
                removeFile(file.path);
                continue;
            }
            // Ignore common generated/cache directories.
            const pathParts = relativePath
                .split("/")
                .map((part) => part.toLowerCase());
            const ignoredDirectories = [
                ".git",
                ".dart_tool",
                ".idea",
                "build",
                ".gradle",
            ];
            const shouldIgnore = pathParts.some((part) => ignoredDirectories.includes(part));
            if (shouldIgnore) {
                removeFile(file.path);
                continue;
            }
            if (relativePath.toLowerCase() ===
                "pubspec.yaml") {
                pubspecFound = true;
            }
            fs.mkdirSync(path.dirname(destination), {
                recursive: true,
            });
            fs.renameSync(file.path, destination);
        }
        if (!pubspecFound) {
            return res.status(400).json({
                ok: false,
                error: "This does not appear to be a Flutter project. pubspec.yaml was not found.",
            });
        }
        console.log(`Inspecting uploaded project: ${projectRoot}`);
        const report = await checkFlutterProject(projectRoot);
        return res.json({
            ok: true,
            projectPath: projectRoot,
            projectName: path.basename(projectRoot),
            fileCount: files.length,
            report,
        });
    }
    catch (error) {
        console.error("Uploaded project check failed:", error);
        return res.status(500).json({
            ok: false,
            error: error instanceof Error
                ? error.message
                : String(error),
        });
    }
    finally {
        // Always remove the uploaded project.
        removeDirectory(projectRoot);
        // Clean up any multer files that
        // were not moved into the project.
        for (const file of files) {
            removeFile(file.path);
        }
    }
});
// ==================================================
// RELEASE BUILD
// ==================================================
app.post("/api/build-release", async (req, res) => {
    const projectPath = typeof req.body?.projectPath === "string"
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
// ==================================================
// FALLBACK
// ==================================================
app.use("/api", (_req, res) => {
    res.status(404).json({
        ok: false,
        error: "API endpoint not found.",
    });
});
// ==================================================
// START SERVER
// ==================================================
app.listen(PORT, "127.0.0.1", () => {
    console.log("");
    console.log("🩺 APP RELEASE DOCTOR");
    console.log("=====================");
    console.log(`Web UI: http://127.0.0.1:${PORT}`);
    console.log("");
});
//# sourceMappingURL=web.js.map