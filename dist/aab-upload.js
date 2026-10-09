import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createAabWorkspace, removeRemoteWorkspace, } from "./remote-workspace.js";
export const MAX_AAB_SIZE = 1024 * 1024 * 1024;
const TRUSTED_FILE_HOSTS = [
    "oaiusercontent.com",
    "openai.com",
    "chatgpt.com",
];
function assertAabFileName(fileName) {
    if (!fileName.toLowerCase().endsWith(".aab")) {
        throw new Error("Only Android App Bundle (.aab) files are allowed.");
    }
}
function parseChatGPTFileUrl(downloadUrl) {
    let url;
    try {
        url = new URL(downloadUrl);
    }
    catch {
        throw new Error("ChatGPT provided an invalid file download URL. Reattach the AAB and try again.");
    }
    const isTrustedHost = TRUSTED_FILE_HOSTS.some((host) => url.hostname === host ||
        url.hostname.endsWith(`.${host}`));
    if (url.protocol !== "https:" ||
        !isTrustedHost ||
        url.username ||
        url.password) {
        throw new Error("ChatGPT provided an unsupported file download URL. Reattach the AAB and try again.");
    }
    return url;
}
export async function persistAabUpload(originalFileName, source) {
    assertAabFileName(originalFileName);
    const { workspace, aabPath } = await createAabWorkspace(originalFileName);
    let size = 0;
    const sizeLimit = new Transform({
        transform(chunk, _encoding, callback) {
            size += chunk.length;
            if (size > MAX_AAB_SIZE) {
                callback(new Error("The AAB exceeds the 1 GB upload limit."));
                return;
            }
            callback(null, chunk);
        },
    });
    try {
        await pipeline(source, sizeLimit, createWriteStream(aabPath, {
            flags: "wx",
        }));
    }
    catch (error) {
        await removeRemoteWorkspace(workspace.directory).catch(() => { });
        throw error;
    }
    return {
        uploadId: workspace.id,
        fileName: originalFileName,
        size,
        expiresAt: new Date(workspace.expiresAt).toISOString(),
    };
}
export async function uploadChatGPTAab(file, fetchFile = fetch) {
    const fileName = file.file_name?.trim() || "app.aab";
    assertAabFileName(fileName);
    const downloadUrl = parseChatGPTFileUrl(file.download_url);
    let response;
    try {
        response = await fetchFile(downloadUrl, {
            redirect: "error",
        });
    }
    catch {
        throw new Error("The AAB could not be downloaded from ChatGPT. Reattach the file and try again.");
    }
    if (!response.ok) {
        throw new Error(`ChatGPT file download failed with HTTP ${response.status}. Reattach the AAB and try again.`);
    }
    if (!response.body) {
        throw new Error("ChatGPT returned an empty AAB download. Reattach the file and try again.");
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) &&
        contentLength > MAX_AAB_SIZE) {
        throw new Error("The AAB exceeds the 1 GB upload limit.");
    }
    return persistAabUpload(fileName, Readable.from(response.body));
}
//# sourceMappingURL=aab-upload.js.map