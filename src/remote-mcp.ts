import express from "express";
import crypto from "crypto";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";

import {
  StreamableHTTPServerTransport,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { server } from "./index.js";

import {
  createAabWorkspace,
  createProjectWorkspace,
  resolveProjectFilePath,
  cleanupExpiredRemoteWorkspaces,
  removeRemoteWorkspace,
} from "./remote-workspace.js";

const app = express();

const PORT =
  Number(process.env.PORT) || 8787;

const MCP_PATH = "/mcp";

const MCP_TOKEN =
  process.env.APP_RELEASE_DOCTOR_TOKEN || "";

// ============================================================
// LIMITS
// ============================================================

const MAX_AAB_SIZE =
  1024 * 1024 * 1024;

const MAX_PROJECT_ZIP_SIZE =
  500 * 1024 * 1024;

const MAX_PROJECT_FILE_SIZE =
  20 * 1024 * 1024;

const MAX_PROJECT_FILES = 5000;

const MAX_PROJECT_TOTAL_SIZE =
  1024 * 1024 * 1024;

// ============================================================
// TEMPORARY UPLOAD CONFIGURATION
// ============================================================

const aabUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AAB_SIZE,
    files: 1,
  },
});

const projectUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PROJECT_ZIP_SIZE,
    files: 1,
  },
});

// ============================================================
// BASIC EXPRESS CONFIGURATION
// ============================================================

app.use(
  express.json({
    limit: "10mb",
  }),
);

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

  if (
    origin &&
    !allowedOrigins.includes(origin)
  ) {
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

  const authorization =
    req.headers.authorization || "";

  const expected =
    `Bearer ${MCP_TOKEN}`;

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

function normalizeZipPath(
  filePath: string,
): string {
  return filePath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function isSafeZipPath(
  filePath: string,
): boolean {
  if (!filePath) {
    return false;
  }

  if (
    filePath.startsWith("/") ||
    filePath.includes("\0")
  ) {
    return false;
  }

  const parts = filePath.split("/");

  if (
    parts.some(
      (part) => part === "..",
    )
  ) {
    return false;
  }

  return true;
}

function shouldIgnoreZipPath(
  filePath: string,
): boolean {
  const parts = filePath.split("/");

  return parts.some(
    (part) =>
      part === ".git" ||
      part === ".dart_tool" ||
      part === ".idea" ||
      part === "build" ||
      part === ".gradle",
  );
}

// ============================================================
// FIND FLUTTER PROJECT ROOT INSIDE ZIP
// ============================================================

function findFlutterProjectRoot(
  entries: AdmZip.IZipEntry[],
): string {
  const candidates =
    new Set<string>();

  for (const entry of entries) {
    if (entry.isDirectory) {
      continue;
    }

    const normalized =
      normalizeZipPath(
        entry.entryName,
      );

    if (
      !isSafeZipPath(normalized)
    ) {
      continue;
    }

    const parts =
      normalized.split("/");

    const pubspecIndex =
      parts.findIndex(
        (part) =>
          part.toLowerCase() ===
          "pubspec.yaml",
      );

    if (pubspecIndex === -1) {
      continue;
    }

    const rootParts =
      parts.slice(
        0,
        pubspecIndex,
      );

    candidates.add(
      rootParts.join("/"),
    );
  }

  if (candidates.has("")) {
    return "";
  }

  if (candidates.size === 0) {
    return "";
  }

  const sorted =
    Array.from(candidates).sort(
      (a, b) =>
        a.length - b.length,
    );

  return sorted[0] ?? "";
}

// ============================================================
// REMOTE AAB UPLOAD
// ============================================================

app.post(
  "/upload/aab",
  aabUpload.single("aab"),
  async (req, res) => {
    let workspaceDirectory:
      | string
      | undefined;

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error:
            "No AAB file was uploaded.",
        });
      }

      const originalName =
        req.file.originalname || "";

      if (
        !originalName
          .toLowerCase()
          .endsWith(".aab")
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Only Android App Bundle (.aab) files are allowed.",
        });
      }

      // IMPORTANT:
      // Preserve the original uploaded filename.
      const {
        workspace,
        aabPath,
      } = await createAabWorkspace(
        originalName,
      );

      workspaceDirectory =
        workspace.directory;

      await fs.writeFile(
        aabPath,
        req.file.buffer,
      );

      return res.json({
        success: true,
        type: "aab",
        uploadId: workspace.id,
        fileName: originalName,
        size: req.file.size,
        expiresAt: new Date(
          workspace.expiresAt,
        ).toISOString(),
      });
    } catch (error) {
      if (workspaceDirectory) {
        await removeRemoteWorkspace(
          workspaceDirectory,
        ).catch(() => {});
      }

      console.error(
        "Remote AAB upload failed:",
        error,
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  },
);

// ============================================================
// REMOTE FLUTTER PROJECT ZIP UPLOAD
// ============================================================

app.post(
  "/upload/project",
  projectUpload.single("project"),
  async (req, res) => {
    let workspaceDirectory:
      | string
      | undefined;

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error:
            "No Flutter project ZIP was uploaded.",
        });
      }

      const originalName =
        req.file.originalname || "";

      if (
        !originalName
          .toLowerCase()
          .endsWith(".zip")
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Flutter project upload must be a ZIP file.",
        });
      }

      let zip: AdmZip;

      try {
        zip = new AdmZip(
          req.file.buffer,
        );
      } catch {
        return res.status(400).json({
          success: false,
          error:
            "The uploaded file is not a valid ZIP archive.",
        });
      }

      const entries =
        zip.getEntries();

      if (entries.length === 0) {
        return res.status(400).json({
          success: false,
          error:
            "The uploaded ZIP file is empty.",
        });
      }

      const projectRoot =
        findFlutterProjectRoot(
          entries,
        );

      const pubspecEntry =
        entries.find((entry) => {
          if (entry.isDirectory) {
            return false;
          }

          const normalized =
            normalizeZipPath(
              entry.entryName,
            );

          if (
            !isSafeZipPath(
              normalized,
            )
          ) {
            return false;
          }

          if (projectRoot) {
            const prefix =
              `${projectRoot}/`;

            if (
              !normalized.startsWith(
                prefix,
              )
            ) {
              return false;
            }

            const relative =
              normalized.slice(
                prefix.length,
              );

            return (
              relative.toLowerCase() ===
              "pubspec.yaml"
            );
          }

          return (
            normalized.toLowerCase() ===
            "pubspec.yaml"
          );
        });

      if (!pubspecEntry) {
        return res.status(400).json({
          success: false,
          error:
            "No Flutter pubspec.yaml was found in the uploaded ZIP.",
        });
      }

      const {
        workspace,
        projectPath,
      } =
        await createProjectWorkspace();

      workspaceDirectory =
        workspace.directory;

      let extractedFiles = 0;
      let extractedBytes = 0;

      for (const entry of entries) {
        if (entry.isDirectory) {
          continue;
        }

        let normalized =
          normalizeZipPath(
            entry.entryName,
          );

        if (
          !isSafeZipPath(
            normalized,
          )
        ) {
          throw new Error(
            `Unsafe ZIP file path: ${entry.entryName}`,
          );
        }

        if (
          shouldIgnoreZipPath(
            normalized,
          )
        ) {
          continue;
        }

        if (projectRoot) {
          const prefix =
            `${projectRoot}/`;

          if (
            normalized ===
            projectRoot
          ) {
            continue;
          }

          if (
            !normalized.startsWith(
              prefix,
            )
          ) {
            continue;
          }

          normalized =
            normalized.slice(
              prefix.length,
            );
        }

        if (!normalized) {
          continue;
        }

        if (
          extractedFiles >=
          MAX_PROJECT_FILES
        ) {
          throw new Error(
            `Flutter project contains more than ${MAX_PROJECT_FILES} files.`,
          );
        }

        const data =
          entry.getData();

        if (
          data.length >
          MAX_PROJECT_FILE_SIZE
        ) {
          throw new Error(
            `Project file is too large: ${normalized}`,
          );
        }

        extractedBytes +=
          data.length;

        if (
          extractedBytes >
          MAX_PROJECT_TOTAL_SIZE
        ) {
          throw new Error(
            "Extracted Flutter project exceeds the 1 GB limit.",
          );
        }

        const destination =
          resolveProjectFilePath(
            projectPath,
            normalized,
          );

        await fs.mkdir(
          path.dirname(
            destination,
          ),
          {
            recursive: true,
          },
        );

        await fs.writeFile(
          destination,
          data,
        );

        extractedFiles++;
      }

      const pubspecPath =
        resolveProjectFilePath(
          projectPath,
          "pubspec.yaml",
        );

      try {
        await fs.access(
          pubspecPath,
        );
      } catch {
        throw new Error(
          "Flutter project extraction failed because pubspec.yaml was not found at the project root.",
        );
      }

      return res.json({
        success: true,
        type: "flutter-project",
        uploadId: workspace.id,
        fileName: originalName,
        size: req.file.size,
        fileCount: extractedFiles,
        extractedBytes,
        projectRoot:
          projectRoot || null,
        expiresAt: new Date(
          workspace.expiresAt,
        ).toISOString(),
      });
    } catch (error) {
      if (workspaceDirectory) {
        await removeRemoteWorkspace(
          workspaceDirectory,
        ).catch(() => {});
      }

      console.error(
        "Remote Flutter project upload failed:",
        error,
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  },
);

// ============================================================
// REMOTE WORKSPACE CLEANUP
// ============================================================

await cleanupExpiredRemoteWorkspaces();

setInterval(() => {
  cleanupExpiredRemoteWorkspaces()
    .catch((error) => {
      console.error(
        "Remote workspace cleanup failed:",
        error,
      );
    });
}, 10 * 60 * 1000);

// ============================================================
// MCP AUTHENTICATION
// ============================================================

app.use(
  MCP_PATH,
  (req, res, next) => {
    if (!MCP_TOKEN) {
      return next();
    }

    const authorization =
      req.headers.authorization || "";

    const expected =
      `Bearer ${MCP_TOKEN}`;

    if (
      authorization !== expected
    ) {
      return res.status(401).json({
        error: "Unauthorized.",
      });
    }

    next();
  },
);

// ============================================================
// MCP SESSION MANAGEMENT
// ============================================================

type McpSession = {
  transport:
    StreamableHTTPServerTransport;
  initialized: boolean;
};

const sessions =
  new Map<string, McpSession>();

// ============================================================
// MCP REQUEST HANDLER
// ============================================================

app.all(
  MCP_PATH,
  async (req, res) => {
    try {
      const sessionId =
        req.headers[
          "mcp-session-id"
        ] as string | undefined;

      // --------------------------------------------------------
      // EXISTING SESSION
      // --------------------------------------------------------

      if (sessionId) {
        const session =
          sessions.get(sessionId);

        if (!session) {
          return res.status(404).json({
            error:
              "MCP session not found or expired.",
          });
        }

        await session.transport.handleRequest(
          req,
          res,
          req.body,
        );

        return;
      }

      // --------------------------------------------------------
      // NEW SESSION
      // --------------------------------------------------------

      if (req.method !== "POST") {
        return res.status(400).json({
          error:
            "MCP session has not been initialized.",
        });
      }

      const transport =
        new StreamableHTTPServerTransport(
          {
            sessionIdGenerator:
              () => {
                const id =
                  crypto.randomUUID();

                return id;
              },
          },
        );

      const compatibleTransport =
        transport as unknown as Parameters<
          typeof server.connect
        >[0];

      try {
        await server.connect(
          compatibleTransport,
        );
      } catch (error) {
        console.error(
          "MCP server connection failed:",
          error,
        );

        if (!res.headersSent) {
          return res.status(500).json({
            error:
              error instanceof Error
                ? error.message
                : String(error),
          });
        }

        return;
      }

      let createdSessionId:
        | string
        | undefined;

      transport.onclose = () => {
        if (createdSessionId) {
          sessions.delete(
            createdSessionId,
          );
        }
      };

      await transport.handleRequest(
        req,
        res,
        req.body,
      );

      createdSessionId =
        transport.sessionId;

      if (createdSessionId) {
        sessions.set(
          createdSessionId,
          {
            transport,
            initialized: true,
          },
        );
      }
    } catch (error) {
      console.error(
        "MCP request failed:",
        error,
      );

      if (!res.headersSent) {
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }
    }
  },
);

// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");

    console.log(
      "🩺 APP RELEASE DOCTOR",
    );

    console.log(
      "---------------------",
    );

    console.log(
      `Remote MCP server running on port ${PORT}`,
    );

    console.log(
      `MCP endpoint: http://localhost:${PORT}${MCP_PATH}`,
    );

    console.log(
      `Health: http://localhost:${PORT}/health`,
    );

    console.log(
      `AAB upload: http://localhost:${PORT}/upload/aab`,
    );

    console.log(
      `Project upload: http://localhost:${PORT}/upload/project`,
    );

    console.log("");
  },
);