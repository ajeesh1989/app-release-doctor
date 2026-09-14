import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
const WORKSPACE_ROOT = path.join(os.tmpdir(), "app-release-doctor-remote");
const AAB_ROOT = path.join(WORKSPACE_ROOT, "aab");
const PROJECT_ROOT = path.join(WORKSPACE_ROOT, "projects");
const AAB_EXPIRY_MS = 30 * 60 * 1000;
const PROJECT_EXPIRY_MS = 60 * 60 * 1000;
// ============================================================
// ID GENERATION
// ============================================================
function createId(prefix) {
    return `${prefix}-${crypto.randomBytes(16).toString("hex")}`;
}
// ============================================================
// AAB FILE NAME SECURITY
// ============================================================
function sanitizeAabFileName(fileName) {
    const normalized = String(fileName || "")
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        ?.trim();
    if (!normalized) {
        return "app.aab";
    }
    if (normalized === "." ||
        normalized === ".." ||
        normalized.includes("\0")) {
        return "app.aab";
    }
    if (!normalized.toLowerCase().endsWith(".aab")) {
        return "app.aab";
    }
    return normalized;
}
// ============================================================
// PATH SECURITY
// ============================================================
function isInsideDirectory(targetPath, parentDirectory) {
    const target = path.resolve(targetPath);
    const parent = path.resolve(parentDirectory);
    return (target === parent ||
        target.startsWith(`${parent}${path.sep}`));
}
function assertInsideDirectory(targetPath, parentDirectory) {
    if (!isInsideDirectory(targetPath, parentDirectory)) {
        throw new Error("Invalid workspace path.");
    }
}
// ============================================================
// WORKSPACE ROOT
// ============================================================
export async function ensureRemoteWorkspaceRoot() {
    await fs.mkdir(AAB_ROOT, {
        recursive: true,
    });
    await fs.mkdir(PROJECT_ROOT, {
        recursive: true,
    });
}
// ============================================================
// CREATE AAB WORKSPACE
// ============================================================
export async function createAabWorkspace(originalFileName = "app.aab") {
    await ensureRemoteWorkspaceRoot();
    const id = createId("aab");
    const directory = path.join(AAB_ROOT, id);
    const safeFileName = sanitizeAabFileName(originalFileName);
    const aabPath = path.join(directory, safeFileName);
    assertInsideDirectory(directory, AAB_ROOT);
    assertInsideDirectory(aabPath, directory);
    await fs.mkdir(directory, {
        recursive: true,
    });
    const createdAt = Date.now();
    return {
        workspace: {
            id,
            directory,
            createdAt,
            expiresAt: createdAt + AAB_EXPIRY_MS,
        },
        aabPath,
    };
}
// ============================================================
// CREATE FLUTTER PROJECT WORKSPACE
// ============================================================
export async function createProjectWorkspace() {
    await ensureRemoteWorkspaceRoot();
    const id = createId("project");
    const directory = path.join(PROJECT_ROOT, id);
    assertInsideDirectory(directory, PROJECT_ROOT);
    await fs.mkdir(directory, {
        recursive: true,
    });
    const createdAt = Date.now();
    return {
        workspace: {
            id,
            directory,
            createdAt,
            expiresAt: createdAt + PROJECT_EXPIRY_MS,
        },
        projectPath: directory,
    };
}
// ============================================================
// RESOLVE AAB UPLOAD ID
// ============================================================
export async function resolveAabWorkspace(uploadId) {
    if (!uploadId ||
        !uploadId.startsWith("aab-")) {
        throw new Error("Invalid AAB upload ID.");
    }
    const directory = path.join(AAB_ROOT, uploadId);
    assertInsideDirectory(directory, AAB_ROOT);
    let directoryStats;
    try {
        directoryStats = await fs.stat(directory);
    }
    catch {
        throw new Error("AAB upload was not found. It may have expired or been removed.");
    }
    if (!directoryStats.isDirectory()) {
        throw new Error("Invalid AAB workspace.");
    }
    const now = Date.now();
    if (now - directoryStats.mtimeMs >
        AAB_EXPIRY_MS) {
        await fs.rm(directory, {
            recursive: true,
            force: true,
        });
        throw new Error("AAB upload has expired. Please upload the AAB again.");
    }
    // ----------------------------------------------------------
    // Find the uploaded AAB inside the workspace.
    //
    // The filename is intentionally preserved instead of being
    // forced to "app.aab".
    // ----------------------------------------------------------
    const entries = await fs.readdir(directory, {
        withFileTypes: true,
    });
    const aabFiles = entries.filter((entry) => entry.isFile() &&
        entry.name
            .toLowerCase()
            .endsWith(".aab"));
    if (aabFiles.length === 0) {
        throw new Error("Uploaded AAB file was not found.");
    }
    if (aabFiles.length > 1) {
        throw new Error("Invalid AAB workspace. Multiple AAB files were found.");
    }
    const aabFile = aabFiles[0];
    if (!aabFile) {
        throw new Error("Uploaded AAB file was not found.");
    }
    const aabPath = path.join(directory, aabFile.name);
    assertInsideDirectory(aabPath, directory);
    let fileStats;
    try {
        fileStats = await fs.stat(aabPath);
    }
    catch {
        throw new Error("Uploaded AAB file was not found.");
    }
    if (!fileStats.isFile()) {
        throw new Error("Uploaded AAB file is invalid.");
    }
    return {
        workspace: {
            id: uploadId,
            directory,
            createdAt: directoryStats.birthtimeMs ||
                directoryStats.ctimeMs,
            expiresAt: directoryStats.mtimeMs +
                AAB_EXPIRY_MS,
        },
        aabPath,
    };
}
// ============================================================
// RESOLVE FLUTTER PROJECT UPLOAD ID
// ============================================================
export async function resolveProjectWorkspace(uploadId) {
    if (!uploadId ||
        !uploadId.startsWith("project-")) {
        throw new Error("Invalid Flutter project upload ID.");
    }
    const directory = path.join(PROJECT_ROOT, uploadId);
    assertInsideDirectory(directory, PROJECT_ROOT);
    let directoryStats;
    try {
        directoryStats = await fs.stat(directory);
    }
    catch {
        throw new Error("Flutter project upload was not found. It may have expired or been removed.");
    }
    if (!directoryStats.isDirectory()) {
        throw new Error("Invalid Flutter project workspace.");
    }
    const now = Date.now();
    if (now - directoryStats.mtimeMs >
        PROJECT_EXPIRY_MS) {
        await fs.rm(directory, {
            recursive: true,
            force: true,
        });
        throw new Error("Flutter project upload has expired. Please upload the project again.");
    }
    const pubspecPath = path.join(directory, "pubspec.yaml");
    assertInsideDirectory(pubspecPath, directory);
    try {
        const pubspecStats = await fs.stat(pubspecPath);
        if (!pubspecStats.isFile()) {
            throw new Error("Flutter project does not contain a valid pubspec.yaml.");
        }
    }
    catch (error) {
        if (error instanceof Error &&
            error.message.includes("does not contain")) {
            throw error;
        }
        throw new Error("Flutter project does not contain pubspec.yaml.");
    }
    return {
        workspace: {
            id: uploadId,
            directory,
            createdAt: directoryStats.birthtimeMs ||
                directoryStats.ctimeMs,
            expiresAt: directoryStats.mtimeMs +
                PROJECT_EXPIRY_MS,
        },
        projectPath: directory,
    };
}
// ============================================================
// RESOLVE PROJECT FILE PATH
// ============================================================
export function resolveProjectFilePath(projectDirectory, relativePath) {
    const normalized = relativePath
        .replace(/\\/g, "/")
        .replace(/^\/+/, "");
    if (!normalized ||
        normalized === ".") {
        throw new Error("Invalid project file path.");
    }
    const targetPath = path.resolve(projectDirectory, ...normalized.split("/"));
    assertInsideDirectory(targetPath, projectDirectory);
    return targetPath;
}
// ============================================================
// REMOVE REMOTE WORKSPACE
// ============================================================
export async function removeRemoteWorkspace(workspaceDirectory) {
    await fs.rm(workspaceDirectory, {
        recursive: true,
        force: true,
    });
}
// ============================================================
// CLEANUP EXPIRED REMOTE WORKSPACES
// ============================================================
export async function cleanupExpiredRemoteWorkspaces() {
    await ensureRemoteWorkspaceRoot();
    await cleanupDirectory(AAB_ROOT, AAB_EXPIRY_MS);
    await cleanupDirectory(PROJECT_ROOT, PROJECT_EXPIRY_MS);
}
async function cleanupDirectory(rootDirectory, expiryMs) {
    const entries = await fs.readdir(rootDirectory, {
        withFileTypes: true,
    });
    const now = Date.now();
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const directory = path.join(rootDirectory, entry.name);
        try {
            const stats = await fs.stat(directory);
            if (now - stats.mtimeMs >
                expiryMs) {
                await fs.rm(directory, {
                    recursive: true,
                    force: true,
                });
            }
        }
        catch {
            // Ignore a workspace that
            // disappeared during cleanup.
        }
    }
}
// ============================================================
// CLEANUP ALL REMOTE WORKSPACES
// ============================================================
export async function cleanupRemoteWorkspaces() {
    await fs.rm(WORKSPACE_ROOT, {
        recursive: true,
        force: true,
    });
}
// ============================================================
// GET REMOTE WORKSPACE ROOT
// ============================================================
export function getRemoteWorkspaceRoot() {
    return WORKSPACE_ROOT;
}
//# sourceMappingURL=remote-workspace.js.map