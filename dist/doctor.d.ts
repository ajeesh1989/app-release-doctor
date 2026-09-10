export type DoctorResult = {
    success: boolean;
    score: number;
    health: string;
    report: string;
};
export declare function formatMB(bytes: number): string;
export declare function inspectAab(aabPath: string): Promise<DoctorResult>;
export declare function checkFlutterProject(projectPath: string): Promise<string>;
export declare function buildRelease(projectPath: string): Promise<string>;
//# sourceMappingURL=doctor.d.ts.map