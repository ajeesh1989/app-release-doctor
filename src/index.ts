import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

import {
  McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  StdioServerTransport,
} from "@modelcontextprotocol/sdk/server/stdio.js";

import { z } from "zod";

import {
  resolveAabWorkspace,
  resolveProjectWorkspace,
} from "./remote-workspace.js";

const execAsync = promisify(exec);

// ============================================================
// MCP SERVER
// ============================================================


// ============================================================
// HELPERS
// ============================================================

function textResult(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function isAabPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".aab");
}

function projectTempDirectory(): string {
  const directory = path.join(
    process.cwd(),
    ".tmp",
  );

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {
      recursive: true,
    });
  }

  return directory;
}

function friendlyPath(filePath: string): string {
  return path.normalize(filePath);
}

function isFlutterProject(projectPath: string): boolean {
  return fs.existsSync(
    path.join(projectPath, "pubspec.yaml"),
  );
}

function getBuildGradlePath(
  projectPath: string,
): string | null {
  const candidates = [
    path.join(
      projectPath,
      "android",
      "app",
      "build.gradle",
    ),
    path.join(
      projectPath,
      "android",
      "app",
      "build.gradle.kts",
    ),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractNumber(
  text: string,
  patterns: RegExp[],
): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      const value = Number(match[1]);

      if (Number.isFinite(value)) {
        return value;
      }
    }
  }

  return null;
}

function extractString(
  text: string,
  patterns: RegExp[],
): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function detectReleaseSigning(
  gradleText: string,
): boolean {
  const text =
    gradleText.toLowerCase();

  // Kotlin DSL / Groovy release signing configuration
  const hasReleaseSigningConfig =
    /signingconfigs?\s*\{[\s\S]*?(create\s*\(\s*["']release["']|release\s*\{)/i.test(
      gradleText,
    ) ||
    /signingconfigs?\.create\s*\(\s*["']release["']\s*\)/i.test(
      gradleText,
    );

  // Release build type explicitly references release signing
  const hasReleaseSigningReference =
    /signingconfig\s*=\s*signingconfigs\.getbyname\s*\(\s*["']release["']\s*\)/i.test(
      gradleText,
    ) ||
    /signingconfig\s+signingconfigs?\.release/i.test(
      gradleText,
    ) ||
    /signingconfig\s*=\s*signingconfigs?\.release/i.test(
      gradleText,
    ) ||
    /signingconfig\s+signingconfigs?\.getbyname\s*\(\s*["']release["']\s*\)/i.test(
      gradleText,
    );

  // Keystore properties are another strong indicator
  const hasKeystoreProperties =
    /key\.properties/i.test(
      gradleText,
    ) &&
    /storefile/i.test(
      gradleText,
    ) &&
    /storepassword/i.test(
      gradleText,
    ) &&
    /keyalias/i.test(
      gradleText,
    ) &&
    /keypassword/i.test(
      gradleText,
    );

  return (
    hasReleaseSigningConfig &&
    (
      hasReleaseSigningReference ||
      hasKeystoreProperties
    )
  );
}

function extractSdkValue(
  gradleText: string,
  property: string,
): number | null {
  const escaped = property.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );

  const patterns = [
    new RegExp(
      `${escaped}\\s*=\\s*(\\d+)`,
      "i",
    ),
    new RegExp(
      `${escaped}\\s*\\(\\s*["'](\\d+)["']\\s*\\)`,
      "i",
    ),
    new RegExp(
      `${escaped}\\s+["']?(\\d+)["']?`,
      "i",
    ),
  ];

  return extractNumber(
    gradleText,
    patterns,
  );
}

function classifyFileByExtension(
  fileName: string,
): string {
  const lower = fileName.toLowerCase();

  if (
    /\.(png|jpg|jpeg|webp|gif|bmp|heic|avif)$/.test(
      lower,
    )
  ) {
    return "IMAGE";
  }

  if (
    /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(
      lower,
    )
  ) {
    return "AUDIO";
  }

  if (
    /\.(mp4|mov|mkv|webm|avi)$/.test(
      lower,
    )
  ) {
    return "VIDEO";
  }

  if (
    /\.(ttf|otf|woff|woff2)$/.test(
      lower,
    )
  ) {
    return "FONT";
  }

  return "OTHER";
}

// ============================================================
// TOOL 1 — TARGET SDK CHECK
// ============================================================

function registerTools(server: McpServer) {

server.tool(
  "check_target_sdk",
  "Check whether an Android target SDK meets the expected Play release requirement.",
  {
    targetSdk: z
      .number()
      .int()
      .positive(),
  },
  async ({ targetSdk }) => {
    const requiredTargetSdk = 36;

    if (targetSdk >= requiredTargetSdk) {
      return textResult(
        `
🩺 APP RELEASE DOCTOR
TARGET SDK CHECK

🟢 TARGET SDK ${targetSdk} IS GOOD

Your application targets Android API ${targetSdk}.

REQUIREMENT
-----------

Minimum expected target SDK: ${requiredTargetSdk}

STATUS
------

🟢 PASS

Your target SDK meets the current requirement used by App Release Doctor.

WHAT TO DO NEXT
---------------

👉 Continue with the rest of your release checks.
        `.trim(),
      );
    }

    return textResult(
      `
🩺 APP RELEASE DOCTOR
TARGET SDK CHECK

🔴 TARGET SDK ${targetSdk} NEEDS ATTENTION

Your application targets Android API ${targetSdk}.

REQUIREMENT
-----------

Minimum expected target SDK: ${requiredTargetSdk}

STATUS
------

🔴 FAIL

Your target SDK is below the expected release requirement.

WHAT TO DO
----------

Update your Flutter/Android project to target SDK ${requiredTargetSdk} or newer.

Then rebuild your release bundle.

COMMAND
-------

flutter build appbundle --release
      `.trim(),
    );
  },
);

// ============================================================
// TOOL 2 — FLUTTER PROJECT CHECK
// ============================================================

server.tool(
  "check_flutter_project",
  "Inspect a local or remotely uploaded Flutter project for Android release configuration.",
  {
    projectPath: z.string().optional(),
    uploadId: z.string().optional(),
  },
  async ({
    projectPath,
    uploadId,
  }) => {
    let normalizedProjectPath = "";
    const remoteUpload = Boolean(uploadId);

    try {
      // --------------------------------------------------------
      // VALIDATE INPUT
      // --------------------------------------------------------

      if (
        projectPath &&
        uploadId
      ) {
        return textResult(
          `
🔴 TOO MANY PROJECT INPUTS

Please provide either:

• projectPath for a local Flutter project

OR:

• uploadId for an uploaded Flutter project

Do not provide both.
          `.trim(),
        );
      }

      if (
        !projectPath &&
        !uploadId
      ) {
        return textResult(
          `
🔴 FLUTTER PROJECT INPUT IS MISSING

I need either:

• projectPath

or:

• uploadId

For a local Flutter project, provide the project root path.

For a remotely uploaded Flutter project, provide the uploadId returned by the project upload service.
          `.trim(),
        );
      }

      // --------------------------------------------------------
      // REMOTE UPLOAD MODE
      // --------------------------------------------------------

      if (uploadId) {
        const resolved =
          await resolveProjectWorkspace(
            uploadId,
          );

        normalizedProjectPath =
          resolved.projectPath;
      }

      // --------------------------------------------------------
      // LOCAL PATH MODE
      // --------------------------------------------------------

      if (projectPath) {
        normalizedProjectPath =
          path.normalize(
            projectPath.trim(),
          );
      }

      // --------------------------------------------------------
      // VALIDATE PROJECT PATH
      // --------------------------------------------------------

      if (
        !fs.existsSync(
          normalizedProjectPath,
        )
      ) {
        return textResult(
          `
🔴 FLUTTER PROJECT NOT FOUND

${
  remoteUpload
    ? "The uploaded Flutter project workspace could not be found or has expired."
    : `I couldn't find:

${friendlyPath(
  normalizedProjectPath,
)}`
}

Please upload the project again or provide a valid Flutter project root.
          `.trim(),
        );
      }

      const projectStats =
        fs.statSync(
          normalizedProjectPath,
        );

      if (
        !projectStats.isDirectory()
      ) {
        return textResult(
          `
🔴 INVALID PROJECT PATH

The selected path is not a directory.

Please select the Flutter project root.
          `.trim(),
        );
      }

      if (
        !isFlutterProject(
          normalizedProjectPath,
        )
      ) {
        return textResult(
          `
🔴 THIS DOES NOT LOOK LIKE A FLUTTER PROJECT

I could not find:

pubspec.yaml

Expected:

${friendlyPath(
  normalizedProjectPath,
)}

Make sure you provide the Flutter project root or upload a valid Flutter project ZIP.
          `.trim(),
        );
      }

      // --------------------------------------------------------
      // READ GRADLE
      // --------------------------------------------------------

      const gradlePath =
        getBuildGradlePath(
          normalizedProjectPath,
        );

      const pubspecPath =
        path.join(
          normalizedProjectPath,
          "pubspec.yaml",
        );

      const pubspecText =
        fs.readFileSync(
          pubspecPath,
          "utf8",
        );

      let gradleText = "";

      if (gradlePath) {
        gradleText =
          fs.readFileSync(
            gradlePath,
            "utf8",
          );
      }

      // --------------------------------------------------------
      // EXTRACT ANDROID VALUES
      // --------------------------------------------------------

      const compileSdk =
        extractSdkValue(
          gradleText,
          "compileSdk",
        );

      const targetSdk =
        extractSdkValue(
          gradleText,
          "targetSdk",
        );

      const minSdk =
        extractSdkValue(
          gradleText,
          "minSdk",
        );

      const namespace =
        extractString(
          gradleText,
          [
            /namespace\s*=\s*["']([^"']+)["']/i,
            /namespace\s+["']([^"']+)["']/i,
          ],
        );

      const applicationId =
        extractString(
          gradleText,
          [
            /applicationId\s*=\s*["']([^"']+)["']/i,
            /applicationId\s+["']([^"']+)["']/i,
          ],
        );

      const releaseSigning =
        detectReleaseSigning(
          gradleText,
        );

      const flutterVersion =
        extractString(
          pubspecText,
          [
            /^version:\s*([^\r\n]+)/m,
          ],
        );

      // --------------------------------------------------------
      // OUTPUT
      // --------------------------------------------------------

      const output: string[] = [];

      output.push(
        "🩺 APP RELEASE DOCTOR",
      );

      output.push(
        "FLUTTER PROJECT CHECK",
      );

      output.push("");

      output.push(
        "PROJECT",
      );

      output.push(
        "-------",
      );

      if (remoteUpload) {
        output.push(
          "Source: Remote uploaded Flutter project",
        );
      } else {
        output.push(
          `Path: ${friendlyPath(
            normalizedProjectPath,
          )}`,
        );
      }

      output.push(
        "🟢 Flutter project detected",
      );

      output.push("");

      output.push(
        "ANDROID CONFIGURATION",
      );

      output.push(
        "---------------------",
      );

      output.push(
        `Compile SDK: ${
          compileSdk ?? "Not detected"
        }`,
      );

      output.push(
        `Target SDK: ${
          targetSdk ?? "Not detected"
        }`,
      );

      output.push(
        `Min SDK: ${
          minSdk ?? "Not detected"
        }`,
      );

      output.push(
        `Application ID: ${
          applicationId ??
          "Not detected"
        }`,
      );

      output.push(
        `Namespace: ${
          namespace ??
          "Not detected"
        }`,
      );

      output.push("");

      output.push(
        "RELEASE SIGNING",
      );

      output.push(
        "---------------",
      );

      output.push(
        releaseSigning
          ? "🟢 Release signing configuration detected."
          : "🟡 Release signing configuration was not clearly detected.",
      );

      output.push("");

      output.push(
        "FLUTTER VERSION",
      );

      output.push(
        "---------------",
      );

      output.push(
        flutterVersion ??
          "Version not detected.",
      );

      output.push("");

      output.push(
        "TARGET SDK STATUS",
      );

      output.push(
        "-----------------",
      );

      if (
        targetSdk === null
      ) {
        output.push(
          "🟡 Target SDK could not be detected automatically.",
        );
      } else if (
        targetSdk >= 36
      ) {
        output.push(
          `🟢 Target SDK ${targetSdk} is good.`,
        );
      } else {
        output.push(
          `🔴 Target SDK ${targetSdk} is below the expected target SDK 36.`,
        );
      }

      output.push("");

      output.push(
        "NEXT STEP",
      );

      output.push(
        "---------",
      );

      output.push(
        "👉 Run the Play Store readiness check.",
      );

      output.push(
        "👉 Build a release AAB.",
      );

      output.push(
        "👉 Run Smart AAB Inspection.",
      );

      return textResult(
        output.join("\n").trim(),
      );
    } catch (error) {
      return textResult(
        `
🔴 FLUTTER PROJECT CHECK FAILED

Something went wrong while reading the Flutter project.

Error:

${
  error instanceof Error
    ? error.message
    : String(error)
}

${
  remoteUpload
    ? "The uploaded Flutter project could not be inspected."
    : `Project:

${normalizedProjectPath}`
}

Please verify the project and try again.
        `.trim(),
      );
    }
  },
);

// ============================================================
// ============================================================
// TOOL 3 — PLAY STORE READINESS
// ============================================================

server.tool(
  "check_play_store_readiness",
  "Check a local or remotely uploaded Flutter project for common Android release readiness items.",
  {
    projectPath: z.string().optional(),
    uploadId: z.string().optional(),
  },
  async ({
    projectPath,
    uploadId,
  }) => {
    let normalizedProjectPath = "";
    const remoteUpload = Boolean(uploadId);

    try {
      // --------------------------------------------------------
      // VALIDATE INPUT
      // --------------------------------------------------------

      if (
        projectPath &&
        uploadId
      ) {
        return textResult(
          `
🔴 TOO MANY PROJECT INPUTS

Please provide either:

• projectPath for a local Flutter project

OR:

• uploadId for an uploaded Flutter project

Do not provide both.
          `.trim(),
        );
      }

      if (
        !projectPath &&
        !uploadId
      ) {
        return textResult(
          `
🔴 FLUTTER PROJECT INPUT IS MISSING

I need either:

• projectPath

or:

• uploadId

For a local Flutter project, provide the project root path.

For a remotely uploaded Flutter project, provide the uploadId returned by the project upload service.
          `.trim(),
        );
      }

      // --------------------------------------------------------
      // REMOTE UPLOAD MODE
      // --------------------------------------------------------

      if (uploadId) {
        const resolved =
          await resolveProjectWorkspace(
            uploadId,
          );

        normalizedProjectPath =
          resolved.projectPath;
      }

      // --------------------------------------------------------
      // LOCAL PATH MODE
      // --------------------------------------------------------

      if (projectPath) {
        normalizedProjectPath =
          path.normalize(
            projectPath.trim(),
          );
      }

      // --------------------------------------------------------
      // VALIDATE PROJECT
      // --------------------------------------------------------

      if (
        !fs.existsSync(
          normalizedProjectPath,
        )
      ) {
        return textResult(
          `
🔴 PROJECT NOT FOUND

${
  remoteUpload
    ? "The uploaded Flutter project workspace could not be found or has expired."
    : `I couldn't find:

${friendlyPath(
  normalizedProjectPath,
)}`
}

Please upload the project again or provide a valid Flutter project root.
          `.trim(),
        );
      }

      const projectStats =
        fs.statSync(
          normalizedProjectPath,
        );

      if (
        !projectStats.isDirectory()
      ) {
        return textResult(
          `
🔴 INVALID PROJECT PATH

The selected path is not a directory.

Please select the Flutter project root.
          `.trim(),
        );
      }

      if (
        !isFlutterProject(
          normalizedProjectPath,
        )
      ) {
        return textResult(
          `
🔴 NOT A FLUTTER PROJECT

pubspec.yaml was not found.

Please provide the Flutter project root or upload a valid Flutter project ZIP.
          `.trim(),
        );
      }

      // --------------------------------------------------------
      // READ GRADLE
      // --------------------------------------------------------

      const gradlePath =
        getBuildGradlePath(
          normalizedProjectPath,
        );

      let gradleText = "";

      if (gradlePath) {
        gradleText =
          fs.readFileSync(
            gradlePath,
            "utf8",
          );
      }

      // --------------------------------------------------------
      // EXTRACT ANDROID VALUES
      // --------------------------------------------------------

      const targetSdk =
        extractSdkValue(
          gradleText,
          "targetSdk",
        );

      const compileSdk =
        extractSdkValue(
          gradleText,
          "compileSdk",
        );

      const minSdk =
        extractSdkValue(
          gradleText,
          "minSdk",
        );

      const applicationId =
        extractString(
          gradleText,
          [
            /applicationId\s*=\s*["']([^"']+)["']/i,
            /applicationId\s+["']([^"']+)["']/i,
          ],
        );

      const signingConfigured =
        detectReleaseSigning(
          gradleText,
        );

      // --------------------------------------------------------
      // READ FLUTTER VERSION
      // --------------------------------------------------------

      const pubspecPath =
        path.join(
          normalizedProjectPath,
          "pubspec.yaml",
        );

      const pubspecText =
        fs.readFileSync(
          pubspecPath,
          "utf8",
        );

      const flutterVersion =
        extractString(
          pubspecText,
          [
            /^version:\s*([^\r\n]+)/m,
          ],
        );

      // --------------------------------------------------------
      // READINESS CHECKS
      // --------------------------------------------------------

      const checks: {
        name: string;
        passed: boolean;
        detail: string;
      }[] = [];

      checks.push({
        name: "Flutter project",
        passed: true,
        detail:
          "pubspec.yaml detected.",
      });

      checks.push({
        name: "Android Gradle configuration",
        passed:
          gradlePath !== null,
        detail:
          gradlePath
            ? `Detected: ${path.basename(
                gradlePath,
              )}`
            : "Android app Gradle file was not detected.",
      });

      checks.push({
        name: "Compile SDK",
        passed:
          compileSdk !== null &&
          compileSdk >= 36,
        detail:
          compileSdk === null
            ? "Could not detect compileSdk."
            : `compileSdk ${compileSdk}`,
      });

      checks.push({
        name: "Target SDK",
        passed:
          targetSdk !== null &&
          targetSdk >= 36,
        detail:
          targetSdk === null
            ? "Could not detect targetSdk."
            : `targetSdk ${targetSdk}`,
      });

      checks.push({
        name: "Application ID",
        passed:
          Boolean(applicationId),
        detail:
          applicationId ??
          "Application ID not detected.",
      });

      checks.push({
        name: "Release signing",
        passed:
          signingConfigured,
        detail:
          signingConfigured
            ? "Release signing configuration detected."
            : "Release signing configuration was not clearly detected.",
      });

      // --------------------------------------------------------
      // COUNT RESULTS
      // --------------------------------------------------------

      const passedCount =
        checks.filter(
          (check) =>
            check.passed,
        ).length;

      const failedCount =
        checks.length -
        passedCount;

      // --------------------------------------------------------
      // OUTPUT
      // --------------------------------------------------------

      const output: string[] = [];

      output.push(
        "🩺 APP RELEASE DOCTOR",
      );

      output.push(
        "PLAY STORE READINESS",
      );

      output.push("");

      output.push(
        "PROJECT",
      );

      output.push(
        "-------",
      );

      if (remoteUpload) {
        output.push(
          "Source: Remote uploaded Flutter project",
        );
      } else {
        output.push(
          `Path: ${friendlyPath(
            normalizedProjectPath,
          )}`,
        );
      }

      output.push("");

      output.push(
        `RESULT: ${
          failedCount === 0
            ? "🟢 READY"
            : "🟡 NEEDS REVIEW"
        }`,
      );

      output.push("");

      output.push(
        `Passed: ${passedCount}/${checks.length}`,
      );

      output.push("");

      // --------------------------------------------------------
      // INDIVIDUAL CHECKS
      // --------------------------------------------------------

      for (
        const check of checks
      ) {
        output.push(
          `${
            check.passed
              ? "🟢"
              : "🔴"
          } ${check.name}`,
        );

        output.push(
          `   ${check.detail}`,
        );

        output.push("");
      }

      // --------------------------------------------------------
      // DETECTED VALUES
      // --------------------------------------------------------

      output.push(
        "DETECTED VALUES",
      );

      output.push(
        "---------------",
      );

      output.push(
        `Compile SDK: ${
          compileSdk ??
          "Not detected"
        }`,
      );

      output.push(
        `Target SDK: ${
          targetSdk ??
          "Not detected"
        }`,
      );

      output.push(
        `Min SDK: ${
          minSdk ??
          "Not detected"
        }`,
      );

      output.push(
        `Application ID: ${
          applicationId ??
          "Not detected"
        }`,
      );

      output.push(
        `Flutter Version: ${
          flutterVersion ??
          "Not detected"
        }`,
      );

      output.push("");

      // --------------------------------------------------------
      // RELEASE SIGNING
      // --------------------------------------------------------

      output.push(
        "RELEASE SIGNING",
      );

      output.push(
        "---------------",
      );

      output.push(
        signingConfigured
          ? "🟢 Release signing configuration detected."
          : "🟡 Release signing configuration was not clearly detected.",
      );

      output.push("");

      // --------------------------------------------------------
      // TARGET SDK STATUS
      // --------------------------------------------------------

      output.push(
        "TARGET SDK STATUS",
      );

      output.push(
        "-----------------",
      );

      if (
        targetSdk === null
      ) {
        output.push(
          "🟡 Target SDK could not be detected automatically.",
        );
      } else if (
        targetSdk >= 36
      ) {
        output.push(
          `🟢 Target SDK ${targetSdk} is good.`,
        );
      } else {
        output.push(
          `🔴 Target SDK ${targetSdk} is below the expected target SDK 36.`,
        );
      }

      output.push("");

      // --------------------------------------------------------
      // NEXT STEP
      // --------------------------------------------------------

      output.push(
        "NEXT STEP",
      );

      output.push(
        "---------",
      );

      if (
        failedCount === 0
      ) {
        output.push(
          "🟢 The project passed the current App Release Doctor readiness checks.",
        );

        output.push("");

        output.push(
          "👉 Build your release AAB.",
        );

        output.push(
          "👉 Run Smart AAB Inspection.",
        );
      } else {
        output.push(
          "👉 Review the failed checks above.",
        );

        output.push(
          "👉 Fix the relevant Android release configuration.",
        );

        output.push(
          "👉 Build a fresh release AAB.",
        );
      }

      return textResult(
        output
          .join("\n")
          .trim(),
      );
    } catch (error) {
      return textResult(
        `
🔴 PLAY STORE READINESS CHECK FAILED

Something went wrong while checking the Flutter project.

Error:

${
  error instanceof Error
    ? error.message
    : String(error)
}

${
  remoteUpload
    ? "The uploaded Flutter project could not be inspected. It may have expired or been removed."
    : `Project:

${normalizedProjectPath}`
}

Please verify the project and try again.
        `.trim(),
      );
    }
  },
);

// ============================================================
// TOOL 4 — BUILD RELEASE
// ============================================================

server.tool(
  "build_release",
  "Build a local or remotely uploaded Flutter Android App Bundle in release mode.",
  {
    projectPath: z.string().optional(),
    uploadId: z.string().optional(),
  },
  async ({
    projectPath,
    uploadId,
  }) => {
    let normalizedProjectPath = "";
    const remoteUpload =
      Boolean(uploadId);

    try {
      // --------------------------------------------------------
      // VALIDATE INPUT
      // --------------------------------------------------------

      if (
        projectPath &&
        uploadId
      ) {
        return textResult(
          `
🔴 TOO MANY PROJECT INPUTS

Please provide either:

• projectPath for a local Flutter project

OR:

• uploadId for an uploaded Flutter project

Do not provide both.
          `.trim(),
        );
      }

      if (
        !projectPath &&
        !uploadId
      ) {
        return textResult(
          `
🔴 FLUTTER PROJECT INPUT IS MISSING

I need either:

• projectPath

or:

• uploadId

For a local Flutter project, provide the project root path.

For a remotely uploaded Flutter project, provide the uploadId returned by the project upload service.
          `.trim(),
        );
      }

      // --------------------------------------------------------
      // RESOLVE PROJECT
      // --------------------------------------------------------

      if (uploadId) {
        const resolved =
          await resolveProjectWorkspace(
            uploadId,
          );

        normalizedProjectPath =
          resolved.projectPath;
      }

      if (projectPath) {
        normalizedProjectPath =
          path.normalize(
            projectPath.trim(),
          );
      }

      // --------------------------------------------------------
      // VALIDATE PROJECT
      // --------------------------------------------------------

      if (
        !fs.existsSync(
          normalizedProjectPath,
        )
      ) {
        return textResult(
          `
🔴 PROJECT NOT FOUND

${
  remoteUpload
    ? "The uploaded Flutter project workspace could not be found or has expired."
    : `I couldn't find:

${friendlyPath(
  normalizedProjectPath,
)}`
}

Please upload the project again or provide a valid Flutter project root.
          `.trim(),
        );
      }

      if (
        !isFlutterProject(
          normalizedProjectPath,
        )
      ) {
        return textResult(
          `
🔴 NOT A FLUTTER PROJECT

pubspec.yaml was not found.

Please provide the Flutter project root or upload a valid Flutter project ZIP.
          `.trim(),
        );
      }

      // --------------------------------------------------------
      // BUILD RELEASE AAB
      // --------------------------------------------------------

      const result =
        await execAsync(
          "flutter build appbundle --release",
          {
            cwd:
              normalizedProjectPath,
            maxBuffer:
              50 * 1024 * 1024,
          },
        );

      const outputText =
        `${result.stdout}\n${result.stderr}`;

      // --------------------------------------------------------
      // FIND GENERATED AAB
      // --------------------------------------------------------

      const possibleAab =
        path.join(
          normalizedProjectPath,
          "build",
          "app",
          "outputs",
          "bundle",
          "release",
          "app-release.aab",
        );

      if (
        !fs.existsSync(
          possibleAab,
        )
      ) {
        return textResult(
          `
🟠 BUILD COMMAND FINISHED

Flutter did not produce the expected AAB at:

${
  remoteUpload
    ? "the remote project build output directory."
    : possibleAab
}

BUILD OUTPUT

${outputText.trim()}

Please check the Flutter build output.
          `.trim(),
        );
      }

      // --------------------------------------------------------
      // BUILD SUCCESS
      // --------------------------------------------------------

      const stats =
        fs.statSync(
          possibleAab,
        );

      return textResult(
        `
🟢 RELEASE AAB BUILT SUCCESSFULLY

PROJECT

-------

${
  remoteUpload
    ? "Source: Remote uploaded Flutter project"
    : `Path: ${friendlyPath(
        normalizedProjectPath,
      )}`
}

FILE

----

${remoteUpload
  ? "Remote project build output: build/app/outputs/bundle/release/app-release.aab"
  : possibleAab}

SIZE

----

${formatMB(
  stats.size,
)} MB

COMMAND

-------

flutter build appbundle --release

NEXT STEP

---------

👉 Run Smart AAB Inspection on this AAB.
        `.trim(),
      );
    } catch (error) {
      const execError =
        error as {
          stdout?: string;
          stderr?: string;
          message?: string;
        };

      return textResult(
        `
🔴 RELEASE BUILD FAILED

PROJECT

-------

${
  remoteUpload
    ? "Remote uploaded Flutter project"
    : normalizedProjectPath
}

ERROR

-----

${
  execError.stderr ||
  execError.message ||
  String(error)
}

WHAT TO DO

----------

1. Check the Flutter project configuration.

2. Run:

flutter clean

3. Run:

flutter pub get

4. Try:

flutter build appbundle --release

${
  remoteUpload
    ? "\n5. If the uploaded workspace has expired, upload the Flutter project again and use the new uploadId."
    : ""
}
        `.trim(),
      );
    }
  },
);
// ============================================================
// TOOL 5 — ANALYZE AAB
// ============================================================

server.tool(
  "analyze_aab",
  "Check whether a local Android App Bundle exists and is readable.",
  {
    aabPath: z.string(),
  },
  async ({ aabPath }) => {
    const normalizedAabPath =
      path.normalize(
        aabPath.trim(),
      );

    try {
      if (
        !isAabPath(
          normalizedAabPath,
        )
      ) {
        return textResult(
          `
🔴 I NEED THE AAB FILE

The selected path does not point to an Android App Bundle.

The file must end with:

.aab

👉 Select the actual .aab file.
          `.trim(),
        );
      }

      if (
        !fs.existsSync(
          normalizedAabPath,
        )
      ) {
        return textResult(
          `
🔴 AAB FILE NOT FOUND

I couldn't find:

${normalizedAabPath}

NEXT STEP

---------

👉 Check the path and try again.
          `.trim(),
        );
      }

      const stats =
        fs.statSync(
          normalizedAabPath,
        );

      if (!stats.isFile()) {
        return textResult(
          `
🔴 THAT PATH IS NOT AN AAB FILE

The selected path is not a file.

👉 Select the actual .aab file.
          `.trim(),
        );
      }

      const fileHandle =
        fs.openSync(
          normalizedAabPath,
          "r",
        );

      const header =
        Buffer.alloc(4);

      try {
        fs.readSync(
          fileHandle,
          header,
          0,
          4,
          0,
        );
      } finally {
        fs.closeSync(
          fileHandle,
        );
      }

      const isZip =
        header[0] === 0x50 &&
        header[1] === 0x4b;

      if (!isZip) {
        return textResult(
          `
🔴 THIS DOES NOT LOOK LIKE A VALID AAB

The file exists, but it does not have the expected ZIP/AAB structure.

FILE

----

${normalizedAabPath}

WHAT TO DO

----------

Build a fresh release bundle:

flutter build appbundle --release

Then inspect the newly generated app-release.aab.
          `.trim(),
        );
      }

      return textResult(
        `
🟢 AAB FOUND AND READABLE

FILE

----

${path.basename(
  normalizedAabPath,
)}

SIZE

----

${formatMB(
  stats.size,
)} MB

LOCATION

--------

${normalizedAabPath}

LAST MODIFIED

-------------

${stats.mtime.toLocaleString()}

WHAT THIS MEANS

---------------

The file exists and has the expected ZIP-based AAB structure.

WHAT TO DO NEXT

---------------

👉 Run the Smart AAB Inspection.

The Doctor will inspect:

• Flutter assets
• Images
• Audio
• Video
• Native libraries
• Android architectures
• DEX files
• Large files
• Duplicate content
• Release risks
        `.trim(),
      );
    } catch (error) {
      return textResult(
        `
🔴 I COULDN'T READ THE AAB

Something went wrong while opening:

${normalizedAabPath}

Error:

${
  error instanceof Error
    ? error.message
    : String(error)
}

NEXT STEP

---------

👉 Check the file and try again.
        `.trim(),
      );
    }
  },
);

// ============================================================
// TOOL 6 — SMART AAB DOCTOR
// ============================================================

server.tool(
  "inspect_aab",
  "Deeply inspect an Android App Bundle and provide a meaningful release health report.",
  {
    aabPath: z.string().optional(),
    uploadId: z.string().optional(),
  },
  async ({
    aabPath,
    uploadId,
  }) => {
    let tempScript:
      string | null = null;

    let normalizedAabPath =
      "";

    const remoteUpload =
      Boolean(uploadId);

    try {
      // --------------------------------------------------------
      // RESOLVE LOCAL OR REMOTE AAB
      // --------------------------------------------------------

      if (
        aabPath &&
        uploadId
      ) {
        return textResult(
          `
🔴 TOO MANY AAB INPUTS

Please provide either:

• aabPath for a local AAB

OR:

• uploadId for an uploaded remote AAB

Do not provide both.
          `.trim(),
        );
      }

      if (
        !aabPath &&
        !uploadId
      ) {
        return textResult(
          `
🔴 AAB INPUT IS MISSING

I need either:

• aabPath

or:

• uploadId

For a local AAB, provide the file path.

For a remote uploaded AAB, provide the uploadId returned by the upload service.
          `.trim(),
        );
      }

      // --------------------------------------------------------
      // REMOTE UPLOAD MODE
      // --------------------------------------------------------

      if (uploadId) {
        const resolved =
          await resolveAabWorkspace(
            uploadId,
          );

        normalizedAabPath =
          resolved.aabPath;
      }

      // --------------------------------------------------------
      // LOCAL PATH MODE
      // --------------------------------------------------------

      if (aabPath) {
        normalizedAabPath =
          path.normalize(
            aabPath.trim(),
          );
      }

      // --------------------------------------------------------
      // VALIDATE AAB PATH
      // --------------------------------------------------------

      if (
        !isAabPath(
          normalizedAabPath,
        )
      ) {
        return textResult(
          `
🔴 I NEED THE AAB FILE

The selected input does not point to an Android App Bundle.

The file must end with:

.aab
          `.trim(),
        );
      }

      if (
        !fs.existsSync(
          normalizedAabPath,
        )
      ) {
        return textResult(
          `
🔴 AAB FILE NOT FOUND

${
  remoteUpload
    ? "The uploaded AAB workspace could not be found or has expired."
    : `I couldn't find:

${normalizedAabPath}`
}

NEXT STEP

---------

👉 Upload the AAB again and run the inspection again.
          `.trim(),
        );
      }

      const fileStats =
        fs.statSync(
          normalizedAabPath,
        );

      if (!fileStats.isFile()) {
        return textResult(
          `
🔴 THAT PATH IS NOT AN AAB FILE

The selected input is not a file.

👉 Select the actual .aab file.
          `.trim(),
        );
      }

      // --------------------------------------------------------
      // CREATE TEMP POWERSHELL SCRIPT
      // --------------------------------------------------------

      tempScript =
        path.join(
          projectTempDirectory(),
          `smart-aab-${Date.now()}.ps1`,
        );

      const escapedPath =
        normalizedAabPath.replace(
          /'/g,
          "''",
        );

      const script = `
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Security

$path = '${escapedPath}'

$zip = $null

try {

    $zip = [System.IO.Compression.ZipFile]::OpenRead($path)

    foreach ($entry in $zip.Entries) {

        $sha = ""

        if ($entry.Length -gt 0) {

            $stream = $null
            $sha256 = $null

            try {

                $stream = $entry.Open()

                $sha256 =
                    [System.Security.Cryptography.SHA256]::Create()

                $hash =
                    $sha256.ComputeHash($stream)

                $sha =
                    ([System.BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()

            }
            finally {

                if ($null -ne $stream) {
                    $stream.Dispose()
                }

                if ($null -ne $sha256) {
                    $sha256.Dispose()
                }
            }
        }

        $safeName = $entry.FullName

        Write-Output "$safeName|$($entry.Length)|$sha"
    }
}
finally {

    if ($null -ne $zip) {
        $zip.Dispose()
    }
}
`;

      fs.writeFileSync(
        tempScript,
        script,
        "utf8",
      );

      // --------------------------------------------------------
      // RUN POWERSHELL
      // --------------------------------------------------------

      let stdout = "";

      try {
        const result =
          await execAsync(
            `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tempScript}"`,
            {
              maxBuffer:
                100 * 1024 * 1024,
            },
          );

        stdout =
          result.stdout;
      } catch (error) {
        const execError =
          error as {
            stdout?: string;
            stderr?: string;
            message?: string;
          };

        return textResult(
          `
🔴 I COULDN'T INSPECT THE AAB

The AAB exists, but Windows could not read its contents.

AAB:

${
  remoteUpload
    ? "Uploaded remote AAB"
    : normalizedAabPath
}

ERROR

-----

${
  execError.stderr ||
  execError.message ||
  String(error)
}

WHAT YOU SHOULD DO

------------------

1. Make sure the AAB is not locked.

2. Build a fresh release bundle.

3. Try the inspection again.

COMMAND

-------

flutter build appbundle --release
          `.trim(),
        );
      }

      // --------------------------------------------------------
      // PARSE ZIP ENTRIES
      // --------------------------------------------------------

      const lines =
        stdout
          .split(/\r?\n/)
          .map(
            (line) =>
              line.trim(),
          )
          .filter(Boolean);

      if (
        lines.length === 0
      ) {
        return textResult(
          `
🔴 I COULDN'T INSPECT THE AAB

The file exists, but no bundle entries were returned.

AAB:

${
  remoteUpload
    ? "Uploaded remote AAB"
    : normalizedAabPath
}

NEXT STEP

---------

👉 Build a fresh AAB and try again.
          `.trim(),
        );
      }

      type EntryClass =
        | "APP"
        | "ASSET"
        | "NATIVE"
        | "DEX"
        | "METADATA"
        | "DEBUG_METADATA"
        | "UNKNOWN";

      type AabEntry = {
        name: string;
        size: number;
        sha256: string;
        entryClass: EntryClass;
      };

      type Finding = {
        severity:
          | "HIGH"
          | "MEDIUM"
          | "LOW"
          | "INFO";

        kind:
          | "PROBLEM"
          | "OPTIMIZATION"
          | "INFO";

        title: string;
        reason: string;
        action: string;
      };

      function classifyEntry(
        name: string,
      ): EntryClass {
        const normalized =
          name
            .replace(
              /\\/g,
              "/",
            )
            .toLowerCase();

        if (
          normalized.startsWith(
            "debug/",
          ) ||
          normalized.includes(
            "/debug/",
          ) ||
          normalized.startsWith(
            "symbols/",
          ) ||
          normalized.includes(
            "/symbols/",
          ) ||
          normalized.endsWith(
            ".dbg",
          ) ||
          normalized.endsWith(
            ".debug",
          ) ||
          normalized.includes(
            "debugsymbols",
          ) ||
          normalized.includes(
            "debug-symbols",
          )
        ) {
          return "DEBUG_METADATA";
        }

        if (
          normalized.startsWith(
            "bundle-metadata/",
          ) ||
          normalized.includes(
            "/bundle-metadata/",
          ) ||
          normalized.startsWith(
            "meta-inf/",
          ) ||
          normalized.includes(
            "/meta-inf/",
          ) ||
          normalized.endsWith(
            ".kotlin_metadata",
          ) ||
          normalized.endsWith(
            ".kotlin_module",
          ) ||
          normalized.endsWith(
            ".version",
          )
        ) {
          return "METADATA";
        }

        if (
          normalized.includes(
            "flutter_assets/",
          )
        ) {
          return "ASSET";
        }

        if (
          normalized.endsWith(
            ".so",
          )
        ) {
          return "NATIVE";
        }

        if (
          normalized.endsWith(
            ".dex",
          )
        ) {
          return "DEX";
        }

        if (
          normalized.startsWith(
            "base/",
          ) ||
          normalized.startsWith(
            "feature/",
          )
        ) {
          return "APP";
        }

        return "UNKNOWN";
      }

      const entries:
        AabEntry[] = [];

      for (
        const line of lines
      ) {
        const firstSeparator =
          line.indexOf("|");

        if (
          firstSeparator === -1
        ) {
          continue;
        }

        const secondSeparator =
          line.indexOf(
            "|",
            firstSeparator + 1,
          );

        const name =
          line.substring(
            0,
            firstSeparator,
          );

        const sizeText =
          secondSeparator === -1
            ? line.substring(
                firstSeparator + 1,
              )
            : line.substring(
                firstSeparator + 1,
                secondSeparator,
              );

        const sha256 =
          secondSeparator === -1
            ? ""
            : line.substring(
                secondSeparator + 1,
              );

        const size =
          Number(sizeText);

        if (!name) {
          continue;
        }

        entries.push({
          name,
          size:
            Number.isFinite(
              size,
            )
              ? size
              : 0,
          sha256,
          entryClass:
            classifyEntry(
              name,
            ),
        });
      }

      // --------------------------------------------------------
      // BASIC METRICS
      // --------------------------------------------------------

      const totalEntries =
        entries.length;

      const totalUncompressedSize =
        entries.reduce(
          (sum, entry) =>
            sum + entry.size,
          0,
        );

      const aabSize =
        fileStats.size;

      const meaningfulEntries =
        entries.filter(
          (entry) =>
            entry.entryClass !==
              "DEBUG_METADATA" &&
            entry.entryClass !==
              "METADATA",
        );

      const debugMetadataEntries =
        entries.filter(
          (entry) =>
            entry.entryClass ===
            "DEBUG_METADATA",
        );

      const metadataEntries =
        entries.filter(
          (entry) =>
            entry.entryClass ===
            "METADATA",
        );

      // --------------------------------------------------------
      // CONTENT TYPES
      // --------------------------------------------------------

      const flutterAssets =
        entries.filter(
          (entry) =>
            entry.name
              .replace(
                /\\/g,
                "/",
              )
              .toLowerCase()
              .includes(
                "flutter_assets/",
              ),
        );

      const images =
        meaningfulEntries.filter(
          (entry) =>
            /\.(png|jpg|jpeg|webp|gif|bmp|heic|avif)$/i.test(
              entry.name,
            ),
        );

      const audio =
        meaningfulEntries.filter(
          (entry) =>
            /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(
              entry.name,
            ),
        );

      const videos =
        meaningfulEntries.filter(
          (entry) =>
            /\.(mp4|mov|mkv|webm|avi)$/i.test(
              entry.name,
            ),
        );

      const fonts =
        meaningfulEntries.filter(
          (entry) =>
            /\.(ttf|otf|woff|woff2)$/i.test(
              entry.name,
            ),
        );

      const nativeLibraries =
        entries.filter(
          (entry) =>
            entry.entryClass ===
            "NATIVE",
        );

      const dexFiles =
        entries.filter(
          (entry) =>
            entry.entryClass ===
            "DEX",
        );

      // --------------------------------------------------------
      // SIZE METRICS
      // --------------------------------------------------------

      const imageSize =
        images.reduce(
          (sum, entry) =>
            sum + entry.size,
          0,
        );

      const audioSize =
        audio.reduce(
          (sum, entry) =>
            sum + entry.size,
          0,
        );

      const videoSize =
        videos.reduce(
          (sum, entry) =>
            sum + entry.size,
          0,
        );

      const nativeSize =
        nativeLibraries.reduce(
          (sum, entry) =>
            sum + entry.size,
          0,
        );

      const meaningfulContentSize =
        meaningfulEntries.reduce(
          (sum, entry) =>
            sum + entry.size,
          0,
        );

      // --------------------------------------------------------
      // LARGEST FILES
      // --------------------------------------------------------

      const largestFiles =
        [...meaningfulEntries]
          .sort(
            (a, b) =>
              b.size - a.size,
          )
          .slice(
            0,
            15,
          );

      const largestImages =
        [...images]
          .sort(
            (a, b) =>
              b.size - a.size,
          )
          .slice(
            0,
            10,
          );

      const largestAudio =
        [...audio]
          .sort(
            (a, b) =>
              b.size - a.size,
          )
          .slice(
            0,
            10,
          );

      const largestVideos =
        [...videos]
          .sort(
            (a, b) =>
              b.size - a.size,
          )
          .slice(
            0,
            5,
          );

      // --------------------------------------------------------
      // DUPLICATES
      // --------------------------------------------------------

      const hashGroups =
        new Map<
          string,
          AabEntry[]
        >();

      for (
        const entry of meaningfulEntries
      ) {
        if (!entry.sha256) {
          continue;
        }

        const existing =
          hashGroups.get(
            entry.sha256,
          );

        if (existing) {
          existing.push(
            entry,
          );
        } else {
          hashGroups.set(
            entry.sha256,
            [entry],
          );
        }
      }

      const duplicateGroups =
        Array.from(
          hashGroups.values(),
        ).filter(
          (group) =>
            group.length > 1,
        );

      let duplicateBytes =
        0;

      for (
        const group of duplicateGroups
      ) {
        const first =
          group[0];

        if (!first) {
          continue;
        }

        duplicateBytes +=
          first.size *
          (group.length - 1);
      }

      // --------------------------------------------------------
      // ARCHITECTURES
      // --------------------------------------------------------

      const architectures =
        new Set<string>();

      for (
        const entry of nativeLibraries
      ) {
        const normalizedName =
          entry.name.replace(
            /\\/g,
            "/",
          );

        const match =
          normalizedName.match(
            /(?:^|\/)base\/lib\/([^/]+)\//i,
          );

        if (
          match?.[1]
        ) {
          architectures.add(
            match[1],
          );
        }
      }

      // --------------------------------------------------------
      // FINDINGS
      // --------------------------------------------------------

      const findings:
        Finding[] = [];

      const hasBaseManifest =
        entries.some(
          (entry) =>
            entry.name
              .replace(
                /\\/g,
                "/",
              )
              .toLowerCase() ===
            "base/manifest/androidmanifest.xml",
        );

      if (
        !hasBaseManifest
      ) {
        findings.push({
          severity:
            "HIGH",
          kind:
            "PROBLEM",
          title:
            "Base Android manifest was not detected",
          reason:
            "The AAB does not contain the expected base/manifest/AndroidManifest.xml entry.",
          action:
            "Verify that this is a complete release AAB and rebuild it with flutter build appbundle --release.",
        });
      }

      if (
        dexFiles.length ===
          0 &&
        nativeLibraries.length ===
          0
      ) {
        findings.push({
          severity:
            "HIGH",
          kind:
            "PROBLEM",
          title:
            "No executable application content detected",
          reason:
            "The bundle does not contain DEX files or native Android libraries.",
          action:
            "Make sure this is the intended release AAB and rebuild it using flutter build appbundle --release.",
        });
      }

      const veryLargeImages =
        images.filter(
          (image) =>
            image.size >=
            10 *
              1024 *
              1024,
        );

      const largeImages =
        images.filter(
          (image) =>
            image.size >=
            2 *
              1024 *
              1024,
        );

      if (
        veryLargeImages.length >
        0
      ) {
        const preview =
          veryLargeImages
            .slice(
              0,
              3,
            )
            .map(
              (image) =>
                `${formatMB(
                  image.size,
                )} MB — ${image.name}`,
            )
            .join(
              "\n   ",
            );

        findings.push({
          severity:
            "MEDIUM",
          kind:
            "OPTIMIZATION",
          title:
            "Very large images found",
          reason:
            `${veryLargeImages.length} image(s) are 10 MB or larger.\n   ${preview}`,
          action:
            "Consider reducing image resolution or compressing the images while preserving visual quality.",
        });
      } else if (
        largeImages.length >
        0
      ) {
        const preview =
          largeImages
            .slice(
              0,
              3,
            )
            .map(
              (image) =>
                `${formatMB(
                  image.size,
                )} MB — ${image.name}`,
            )
            .join(
              "\n   ",
            );

        findings.push({
          severity:
            "LOW",
          kind:
            "OPTIMIZATION",
          title:
            "Large images worth reviewing",
          reason:
            `${largeImages.length} image(s) are 2 MB or larger.\n   ${preview}`,
          action:
            "Review whether these images can be resized or compressed without affecting the app's appearance.",
        });
      }

      const veryLargeAudio =
        audio.filter(
          (sound) =>
            sound.size >=
            10 *
              1024 *
              1024,
        );

      const largeAudio =
        audio.filter(
          (sound) =>
            sound.size >=
            5 *
              1024 *
              1024,
        );

      if (
        veryLargeAudio.length >
        0
      ) {
        const preview =
          veryLargeAudio
            .slice(
              0,
              3,
            )
            .map(
              (sound) =>
                `${formatMB(
                  sound.size,
                )} MB — ${sound.name}`,
            )
            .join(
              "\n   ",
            );

        findings.push({
          severity:
            "MEDIUM",
          kind:
            "OPTIMIZATION",
          title:
            "Very large audio files found",
          reason:
            `${veryLargeAudio.length} audio file(s) are 10 MB or larger.\n   ${preview}`,
          action:
            "Consider reducing bitrate or using a more size-efficient encoding.",
        });
      } else if (
        largeAudio.length >
        0
      ) {
        const preview =
          largeAudio
            .slice(
              0,
              3,
            )
            .map(
              (sound) =>
                `${formatMB(
                  sound.size,
                )} MB — ${sound.name}`,
            )
            .join(
              "\n   ",
            );

        findings.push({
          severity:
            "LOW",
          kind:
            "OPTIMIZATION",
          title:
            "Large audio files worth reviewing",
          reason:
            `${largeAudio.length} audio file(s) are 5 MB or larger.\n   ${preview}`,
          action:
            "Review bitrate and encoding if reducing app size is important.",
        });
      }

      const veryLargeVideos =
        videos.filter(
          (video) =>
            video.size >=
            50 *
              1024 *
              1024,
        );

      const largeVideos =
        videos.filter(
          (video) =>
            video.size >=
            20 *
              1024 *
              1024,
        );

      if (
        veryLargeVideos.length >
        0
      ) {
        const preview =
          veryLargeVideos
            .slice(
              0,
              3,
            )
            .map(
              (video) =>
                `${formatMB(
                  video.size,
                )} MB — ${video.name}`,
            )
            .join(
              "\n   ",
            );

        findings.push({
          severity:
            "MEDIUM",
          kind:
            "OPTIMIZATION",
          title:
            "Very large video files found",
          reason:
            `${veryLargeVideos.length} video file(s) are 50 MB or larger.\n   ${preview}`,
          action:
            "Consider reducing video resolution, bitrate, duration, or encoding size.",
        });
      } else if (
        largeVideos.length >
        0
      ) {
        const preview =
          largeVideos
            .slice(
              0,
              3,
            )
            .map(
              (video) =>
                `${formatMB(
                  video.size,
                )} MB — ${video.name}`,
            )
            .join(
              "\n   ",
            );

        findings.push({
          severity:
            "LOW",
          kind:
            "OPTIMIZATION",
          title:
            "Large video files worth reviewing",
          reason:
            `${largeVideos.length} video file(s) are 20 MB or larger.\n   ${preview}`,
          action:
            "Review video encoding and resolution if reducing application size is important.",
        });
      }

      if (
        duplicateGroups.length >
          0 &&
        duplicateBytes >=
          10 *
            1024 *
            1024
      ) {
        findings.push({
          severity:
            "MEDIUM",
          kind:
            "OPTIMIZATION",
          title:
            "Significant duplicate content detected",
          reason:
            `${duplicateGroups.length} duplicate group(s) represent approximately ${formatMB(
              duplicateBytes,
            )} MB of repeated content.`,
          action:
            "Check whether the repeated assets are intentionally included more than once.",
        });
      } else if (
        duplicateGroups.length >
          0 &&
        duplicateBytes >=
          2 *
            1024 *
            1024
      ) {
        findings.push({
          severity:
            "LOW",
          kind:
            "OPTIMIZATION",
          title:
            "Duplicate content detected",
          reason:
            `${duplicateGroups.length} duplicate group(s) represent approximately ${formatMB(
              duplicateBytes,
            )} MB of repeated content.`,
          action:
            "Review the duplicates if you want to reduce the application footprint.",
        });
      }

      if (
        meaningfulContentSize >
        300 *
          1024 *
          1024
      ) {
        findings.push({
          severity:
            "MEDIUM",
          kind:
            "OPTIMIZATION",
          title:
            "Large amount of application content",
          reason:
            `Meaningful application content totals approximately ${formatMB(
              meaningfulContentSize,
            )} MB uncompressed.`,
          action:
            "Review the largest assets and remove or compress anything the app does not need.",
        });
      } else if (
        meaningfulContentSize >
        200 *
          1024 *
          1024
      ) {
        findings.push({
          severity:
            "LOW",
          kind:
            "OPTIMIZATION",
          title:
            "Application content is fairly large",
          reason:
            `Meaningful application content totals approximately ${formatMB(
              meaningfulContentSize,
            )} MB uncompressed.`,
          action:
            "Review large assets if reducing the application footprint is important.",
        });
      }

      const largestNonMediaFile =
        largestFiles.find(
          (entry) =>
            entry.entryClass !==
              "NATIVE" &&
            !/\.(png|jpg|jpeg|webp|gif|bmp|heic|avif|mp3|wav|ogg|m4a|aac|flac|mp4|mov|mkv|webm|avi)$/i.test(
              entry.name,
            ),
        );

      if (
        largestNonMediaFile &&
        largestNonMediaFile.size >
          25 *
            1024 *
            1024
      ) {
        findings.push({
          severity:
            "MEDIUM",
          kind:
            "OPTIMIZATION",
          title:
            "One particularly large application file was found",
          reason:
            `${largestNonMediaFile.name} is ${formatMB(
              largestNonMediaFile.size,
            )} MB.`,
          action:
            "Review whether this file really needs to be bundled at this size.",
        });
      }

      if (
        architectures.size >=
        3
      ) {
        findings.push({
          severity:
            "INFO",
          kind:
            "INFO",
          title:
            "Multiple Android architectures found",
          reason:
            `The bundle contains: ${Array.from(
              architectures,
            ).join(
              ", ",
            )}.`,
          action:
            "This can be normal for Flutter apps. Keep the architectures your app needs to support.",
        });
      }

      if (
        nativeLibraries.length >
        0
      ) {
        findings.push({
          severity:
            "INFO",
          kind:
            "INFO",
          title:
            "Native Android libraries found",
          reason:
            `The AAB contains ${nativeLibraries.length} native library file(s), using approximately ${formatMB(
              nativeSize,
            )} MB uncompressed.`,
          action:
            "This is normal for Flutter applications and many Flutter plugins.",
        });
      }

      if (
        debugMetadataEntries.length >
        0
      ) {
        findings.push({
          severity:
            "INFO",
          kind:
            "INFO",
          title:
            "Debug/build metadata ignored",
          reason:
            `${debugMetadataEntries.length} debug/build metadata file(s) were detected.`,
          action:
            "These entries are excluded from release health and optimization calculations.",
        });
      }

      // --------------------------------------------------------
      // FINDING GROUPS
      // --------------------------------------------------------

      const problemFindings =
        findings.filter(
          (finding) =>
            finding.kind ===
            "PROBLEM",
        );

      const optimizationFindings =
        findings.filter(
          (finding) =>
            finding.kind ===
            "OPTIMIZATION",
        );

      const informationFindings =
        findings.filter(
          (finding) =>
            finding.kind ===
            "INFO",
        );

      // --------------------------------------------------------
      // SCORE
      // --------------------------------------------------------

      let score = 100;

      let highProblemCount =
        0;

      let mediumProblemCount =
        0;

      let lowProblemCount =
        0;

      for (
        const finding of problemFindings
      ) {
        if (
          finding.severity ===
          "HIGH"
        ) {
          highProblemCount++;
        } else if (
          finding.severity ===
          "MEDIUM"
        ) {
          mediumProblemCount++;
        } else if (
          finding.severity ===
          "LOW"
        ) {
          lowProblemCount++;
        }
      }

      score -=
        highProblemCount *
        30;

      score -=
        mediumProblemCount *
        12;

      score -=
        lowProblemCount *
        4;

      score =
        Math.max(
          0,
          Math.min(
            100,
            score,
          ),
        );

      let healthLabel =
        "🟢 HEALTHY";

      if (
        score < 90
      ) {
        healthLabel =
          "🟡 NEEDS REVIEW";
      }

      if (
        score < 70
      ) {
        healthLabel =
          "🟠 ATTENTION NEEDED";
      }

      if (
        score < 40
      ) {
        healthLabel =
          "🔴 SIGNIFICANT ISSUES";
      }

      // --------------------------------------------------------
      // OUTPUT
      // --------------------------------------------------------

      const output:
        string[] = [];

      output.push(
        "🩺 APP RELEASE DOCTOR",
      );

      output.push(
        "SMART AAB INSPECTION",
      );

      output.push("");

      output.push(
        "I opened your AAB and checked its structure, application content, release risks, and optional optimizations.",
      );

      output.push("");

      output.push(
        "RELEASE HEALTH",
      );

      output.push(
        "--------------",
      );

      output.push(
        `${healthLabel}  ${score}/100`,
      );

      output.push("");

      output.push(
        "The score measures actual release risks detected inside the AAB.",
      );

      output.push(
        "Optimization suggestions do NOT reduce the score.",
      );

      output.push(
        "Normal build metadata does NOT reduce the score.",
      );

      output.push(
        "This is NOT a Google Play approval score.",
      );

      output.push("");

      output.push(
        "AAB",
      );

      output.push(
        "---",
      );

      output.push(
        `File: ${path.basename(
          normalizedAabPath,
        )}`,
      );

      output.push(
        `Upload file size: ${formatMB(
          aabSize,
        )} MB`,
      );

      output.push(
        `Uncompressed contents: ${formatMB(
          totalUncompressedSize,
        )} MB`,
      );

      output.push(
        `Meaningful content: ${formatMB(
          meaningfulContentSize,
        )} MB`,
      );

      output.push(
        `Files inside bundle: ${totalEntries}`,
      );

      output.push("");

      output.push(
        "Note: uncompressed content size is a diagnostic metric. It is not the same as the final Google Play download size.",
      );

      output.push("");

      output.push(
        "CONTENT SUMMARY",
      );

      output.push(
        "---------------",
      );

      output.push(
        `📦 Flutter assets: ${flutterAssets.length}`,
      );

      output.push(
        `🖼️ Images: ${images.length} (${formatMB(
          imageSize,
        )} MB)`,
      );

      output.push(
        `🔊 Audio: ${audio.length} (${formatMB(
          audioSize,
        )} MB)`,
      );

      output.push(
        `🎬 Videos: ${videos.length} (${formatMB(
          videoSize,
        )} MB)`,
      );

      output.push(
        `⚙️ Native libraries: ${nativeLibraries.length} (${formatMB(
          nativeSize,
        )} MB)`,
      );

      output.push(
        `🔤 Fonts: ${fonts.length}`,
      );

      output.push(
        `📱 DEX files: ${dexFiles.length}`,
      );

      output.push("");

      output.push(
        "ANDROID ARCHITECTURES",
      );

      output.push(
        "---------------------",
      );

      if (
        architectures.size >
        0
      ) {
        output.push(
          Array.from(
            architectures,
          ).join(
            ", ",
          ),
        );
      } else {
        output.push(
          "No native Android architectures detected.",
        );
      }

      output.push("");

      output.push(
        "NATIVE LIBRARY FOOTPRINT",
      );

      output.push(
        "------------------------",
      );

      if (
        nativeLibraries.length >
        0
      ) {
        output.push(
          `Total native libraries: ${nativeLibraries.length}`,
        );

        output.push(
          `Uncompressed native size: ${formatMB(
            nativeSize,
          )} MB`,
        );

        const largestNative =
          [...nativeLibraries]
            .sort(
              (a, b) =>
                b.size -
                a.size,
            )
            .slice(
              0,
              6,
            );

        for (
          const nativeFile of largestNative
        ) {
          output.push(
            `• ${formatMB(
              nativeFile.size,
            )} MB — ${nativeFile.name}`,
          );
        }
      } else {
        output.push(
          "No native libraries detected.",
        );
      }

      output.push("");

      output.push(
        "RELEASE RISKS",
      );

      output.push(
        "-------------",
      );

      output.push(
        `🔴 High: ${highProblemCount}`,
      );

      output.push(
        `🟠 Medium: ${mediumProblemCount}`,
      );

      output.push(
        `🟡 Low: ${lowProblemCount}`,
      );

      output.push("");

      if (
        problemFindings.length ===
        0
      ) {
        output.push(
          "🟢 No obvious release risks were detected from the AAB contents.",
        );
      } else {
        let number = 1;

        for (
          const finding of problemFindings
        ) {
          let icon =
            "🟡";

          if (
            finding.severity ===
            "HIGH"
          ) {
            icon =
              "🔴";
          } else if (
            finding.severity ===
            "MEDIUM"
          ) {
            icon =
              "🟠";
          }

          output.push(
            `${number}. ${icon} ${finding.title}`,
          );

          output.push(
            `   Why: ${finding.reason}`,
          );

          output.push(
            `   What to do: ${finding.action}`,
          );

          output.push("");

          number++;
        }
      }

      output.push(
        "OPTIMIZATION SUGGESTIONS",
      );

      output.push(
        "------------------------",
      );

      output.push(
        `🟡 ${optimizationFindings.length} suggestion(s)`,
      );

      output.push("");

      if (
        optimizationFindings.length ===
        0
      ) {
        output.push(
          "🟢 No obvious size optimization opportunities were detected.",
        );
      } else {
        let number = 1;

        for (
          const finding of optimizationFindings
        ) {
          const icon =
            finding.severity ===
            "MEDIUM"
              ? "🟠"
              : "🟡";

          output.push(
            `${number}. ${icon} ${finding.title}`,
          );

          output.push(
            `   Why: ${finding.reason}`,
          );

          output.push(
            `   Suggestion: ${finding.action}`,
          );

          output.push("");

          number++;
        }
      }

      output.push(
        "BUILD / DEBUG METADATA",
      );

      output.push(
        "-----------------------",
      );

      output.push(
        `ℹ️ Debug metadata ignored: ${debugMetadataEntries.length}`,
      );

      output.push(
        `ℹ️ Normal metadata ignored: ${metadataEntries.length}`,
      );

      output.push(
        "These entries are excluded from release-risk and optimization calculations.",
      );

      output.push("");

      output.push(
        "NORMAL / INFORMATIONAL",
      );

      output.push(
        "----------------------",
      );

      if (
        informationFindings.length ===
        0
      ) {
        output.push(
          "No additional informational findings.",
        );
      } else {
        for (
          const finding of informationFindings
        ) {
          output.push(
            `ℹ️ ${finding.title}`,
          );

          output.push(
            `   ${finding.reason}`,
          );

          output.push(
            `   ${finding.action}`,
          );

          output.push("");
        }
      }

      output.push(
        "TOP 10 LARGEST MEANINGFUL FILES",
      );

      output.push(
        "-------------------------------",
      );

      if (
        largestFiles.length ===
        0
      ) {
        output.push(
          "No meaningful application files detected.",
        );
      } else {
        for (
          let i = 0;
          i <
          Math.min(
            10,
            largestFiles.length,
          );
          i++
        ) {
          const entry =
            largestFiles[i];

          if (!entry) {
            continue;
          }

          output.push(
            `${i + 1}. ${formatMB(
              entry.size,
            )} MB — ${entry.name}`,
          );
        }
      }

      output.push("");

      output.push(
        "DUPLICATE FILE CHECK",
      );

      output.push(
        "--------------------",
      );

      if (
        duplicateGroups.length ===
        0
      ) {
        output.push(
          "🟢 No duplicate application content detected.",
        );
      } else {
        output.push(
          `Found ${duplicateGroups.length} duplicate group(s).`,
        );

        output.push(
          `Potential repeated content: ${formatMB(
            duplicateBytes,
          )} MB`,
        );

        output.push("");

        const previewGroups =
          duplicateGroups.slice(
            0,
            5,
          );

        for (
          let i = 0;
          i <
          previewGroups.length;
          i++
        ) {
          const group =
            previewGroups[i];

          if (!group) {
            continue;
          }

          output.push(
            `Group ${i + 1}:`,
          );

          for (
            const entry of group
          ) {
            output.push(
              `  ${formatMB(
                entry.size,
              )} MB — ${entry.name}`,
            );
          }

          output.push("");
        }

        if (
          duplicateGroups.length >
          5
        ) {
          output.push(
            `Showing first 5 of ${duplicateGroups.length} duplicate groups.`,
          );

          output.push("");
        }
      }

      output.push(
        "WHAT THIS MEANS",
      );

      output.push(
        "---------------",
      );

      if (
        highProblemCount >
        0
      ) {
        output.push(
          "🔴 Important release risks were detected. Review them before release.",
        );
      } else if (
        mediumProblemCount >
        0
      ) {
        output.push(
          "🟠 Meaningful release risks were detected. Review them before publishing.",
        );
      } else if (
        lowProblemCount >
        0
      ) {
        output.push(
          "🟡 Minor release risks were detected.",
        );
      } else if (
        optimizationFindings.length >
        0
      ) {
        output.push(
          "🟢 No obvious release risks were detected. The remaining findings are optional optimizations.",
        );
      } else {
        output.push(
          "🟢 No obvious release risks or major optimization opportunities were detected.",
        );
      }

      output.push("");

      output.push(
        "SCORE EXPLANATION",
      );

      output.push(
        "-----------------",
      );

      output.push(
        "HIGH release problem: -30 points",
      );

      output.push(
        "MEDIUM release problem: -12 points",
      );

      output.push(
        "LOW release problem: -4 points",
      );

      output.push(
        "Optimization suggestion: 0 points",
      );

      output.push(
        "Informational finding: 0 points",
      );

      output.push("");

      output.push(
        `Current release problems affecting score: ${problemFindings.length}`,
      );

      output.push(
        `Optimization suggestions not affecting score: ${optimizationFindings.length}`,
      );

      output.push(
        `Informational findings not affecting score: ${informationFindings.length}`,
      );

      output.push("");

      output.push(
        "IMPORTANT",
      );

      output.push(
        "---------",
      );

      output.push(
        "This inspection focuses on the actual contents and structure of the AAB.",
      );

      output.push(
        "It does not replace Google Play's own validation.",
      );

      output.push(
        "A healthy Doctor score does not guarantee Google Play approval.",
      );

      output.push("");

      output.push(
        "NEXT STEP",
      );

      output.push(
        "---------",
      );

      if (
        problemFindings.length >
        0
      ) {
        output.push(
          "👉 Review the release risks above.",
        );

        output.push(
          "👉 Fix anything relevant to your app.",
        );

        output.push(
          "👉 Build a fresh AAB and inspect it again.",
        );
      } else if (
        optimizationFindings.length >
        0
      ) {
        output.push(
          "👉 Your AAB passed the release-risk inspection.",
        );

        output.push(
          "👉 The optimization suggestions are optional.",
        );

        output.push(
          "👉 You can continue with your release process.",
        );
      } else {
        output.push(
          "👉 Your AAB passed this inspection.",
        );

        output.push(
          "👉 You can continue with your release process.",
        );
      }

      output.push("");

      output.push(
        "🟢 SMART AAB INSPECTION COMPLETE",
      );

      return textResult(
        output
          .join("\n")
          .trim(),
      );
    } catch (error) {
      return textResult(
        `
🔴 AAB INSPECTION FAILED

I found the AAB, but something went wrong while inspecting it.

${
  remoteUpload
    ? "The uploaded remote AAB could not be inspected."
    : `File:

${aabPath}`
}

Error:

${
  error instanceof Error
    ? error.message
    : String(error)
}

WHAT YOU SHOULD DO

------------------

1. Build a fresh AAB:

   flutter build appbundle --release

2. Find:

   build/app/outputs/bundle/release/app-release.aab

3. Run the inspection again.
        `.trim(),
      );
    } finally {
      if (tempScript) {
        try {
          if (
            fs.existsSync(
              tempScript,
            )
          ) {
            fs.unlinkSync(
              tempScript,
            );
          }
        } catch {
          // Ignore cleanup errors.
        }
      }
    }
  },
);

}

export function createServer() {
  const server = new McpServer({
    name: "app-release-doctor",
    version: "1.1.0",
  });

  registerTools(server);

  return server;
}

export const server = createServer();

// ============================================================
// MCP SERVER STARTUP
// ============================================================

export async function startStdioServer() {
  const transport =
    new StdioServerTransport();

  await server.connect(
    transport,
  );
}

// ============================================================
// START STDIO ONLY WHEN RUN DIRECTLY
// ============================================================

const currentFile =
  path.resolve(
    new URL(
      import.meta.url,
    ).pathname,
  );

const executedFile =
  process.argv[1]
    ? path.resolve(
        process.argv[1],
      )
    : "";

if (
  currentFile ===
    executedFile &&
  process.env
    .APP_RELEASE_DOCTOR_TRANSPORT !==
    "http"
) {
  startStdioServer().catch(
    (error) => {
      console.error(
        "Fatal MCP server error:",
        error,
      );

      process.exit(1);
    },
  );
}