import assert from "node:assert/strict";
import { after, test } from "node:test";
import AdmZip from "adm-zip";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../dist/index.js";
import { removeRemoteWorkspace, resolveAabWorkspace } from "../dist/remote-workspace.js";

const workspaces = new Set();

after(async () => {
  await Promise.all(
    [...workspaces].map((directory) =>
      removeRemoteWorkspace(directory),
    ),
  );
});

test("ChatGPT file upload returns an ID accepted by inspect_aab", async () => {
  const zip = new AdmZip();
  zip.addFile(
    "base/manifest/AndroidManifest.xml",
    Buffer.from("test manifest"),
  );
  const aab = zip.toBuffer();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(
      new URL(String(input)).hostname,
      "files.oaiusercontent.com",
    );

    return new Response(aab, {
      headers: {
        "content-length": String(aab.length),
      },
    });
  };

  const server = createServer();
  const client = new Client(
    { name: "aab-upload-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const tools = await client.listTools();
    const uploadTool = tools.tools.find(
      (tool) => tool.name === "upload_aab",
    );

    assert.deepEqual(
      uploadTool?._meta?.["openai/fileParams"],
      ["file"],
    );

    const uploadResult = await client.callTool({
      name: "upload_aab",
      arguments: {
        file: {
          download_url:
            "https://files.oaiusercontent.com/test.aab?signature=test",
          file_id: "file_test",
          file_name: "release.aab",
          mime_type:
            "application/octet-stream",
        },
      },
    });

    const uploadText = uploadResult.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    const uploadId = uploadText.match(
      /Upload ID: (aab-[a-f0-9]+)/,
    )?.[1];

    assert.ok(uploadId, uploadText);

    const resolved = await resolveAabWorkspace(uploadId);
    workspaces.add(resolved.workspace.directory);
    assert.equal(resolved.workspace.id, uploadId);

    const inspectionResult = await client.callTool({
      name: "inspect_aab",
      arguments: { uploadId },
    });
    const inspectionText = inspectionResult.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    assert.doesNotMatch(
      inspectionText,
      /AAB INPUT IS MISSING/,
    );
    assert.match(inspectionText, /RELEASE HEALTH/);
  } finally {
    globalThis.fetch = originalFetch;
    await client.close();
    await server.close();
  }
});

test("ChatGPT upload rejects unsupported download hosts clearly", async () => {
  const originalFetch = globalThis.fetch;
  const server = createServer();
  const client = new Client(
    { name: "aab-upload-validation-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const missingFileResult = await client.callTool({
      name: "upload_aab",
      arguments: {},
    });
    const missingFileText = missingFileResult.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    assert.equal(missingFileResult.isError, true);
    assert.match(
      missingFileText,
      /Input validation error: Invalid arguments for tool upload_aab:.*expected object, received undefined at file/,
    );

    const result = await client.callTool({
      name: "upload_aab",
      arguments: {
        file: {
          download_url: "https://example.com/release.aab",
          file_id: "file_test",
          file_name: "release.aab",
        },
      },
    });
    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    assert.match(text, /AAB upload failed/);
    assert.match(text, /unsupported file download URL/);

    globalThis.fetch = async () =>
      new Response(null, {
        status: 429,
      });

    const rateLimitedResult = await client.callTool({
      name: "upload_aab",
      arguments: {
        file: {
          download_url:
            "https://files.oaiusercontent.com/release.aab?signature=test",
          file_id: "file_test",
          file_name: "release.aab",
        },
      },
    });
    const rateLimitedText = rateLimitedResult.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    assert.match(rateLimitedText, /HTTP 429/);
  } finally {
    globalThis.fetch = originalFetch;
    await client.close();
    await server.close();
  }
});