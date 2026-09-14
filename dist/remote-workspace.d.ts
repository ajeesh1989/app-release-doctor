export type RemoteWorkspace = {
    id: string;
    directory: string;
    createdAt: number;
    expiresAt: number;
};
export declare function ensureRemoteWorkspaceRoot(): Promise<void>;
export declare function createAabWorkspace(originalFileName?: string): Promise<{
    workspace: RemoteWorkspace;
    aabPath: string;
}>;
export declare function createProjectWorkspace(): Promise<{
    workspace: RemoteWorkspace;
    projectPath: string;
}>;
export declare function resolveAabWorkspace(uploadId: string): Promise<{
    workspace: RemoteWorkspace;
    aabPath: string;
}>;
export declare function resolveProjectWorkspace(uploadId: string): Promise<{
    workspace: RemoteWorkspace;
    projectPath: string;
}>;
export declare function resolveProjectFilePath(projectDirectory: string, relativePath: string): string;
export declare function removeRemoteWorkspace(workspaceDirectory: string): Promise<void>;
export declare function cleanupExpiredRemoteWorkspaces(): Promise<void>;
export declare function cleanupRemoteWorkspaces(): Promise<void>;
export declare function getRemoteWorkspaceRoot(): string;
//# sourceMappingURL=remote-workspace.d.ts.map