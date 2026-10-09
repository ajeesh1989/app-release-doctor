import { Readable } from "node:stream";
export declare const MAX_AAB_SIZE: number;
export type ChatGPTFileInput = {
    download_url: string;
    file_id: string;
    mime_type?: string | undefined;
    file_name?: string | undefined;
};
export type AabUploadResult = {
    uploadId: string;
    fileName: string;
    size: number;
    expiresAt: string;
};
export declare function persistAabUpload(originalFileName: string, source: Readable): Promise<AabUploadResult>;
export declare function uploadChatGPTAab(file: ChatGPTFileInput, fetchFile?: typeof fetch): Promise<AabUploadResult>;
//# sourceMappingURL=aab-upload.d.ts.map