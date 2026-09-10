import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({
    name: "App Release Doctor",
    version: "1.0.0",
});
server.tool("check_target_sdk", "Check Android target SDK version.", {
    targetSdk: z.number().describe("The Android target SDK version"),
}, async ({ targetSdk }) => {
    const ready = targetSdk >= 36;
    return {
        content: [
            {
                type: "text",
                text: ready
                    ? `✅ Target SDK ${targetSdk} is good.`
                    : `❌ Target SDK ${targetSdk} is below 36. Update it.`,
            },
        ],
    };
});
const transport = new StdioServerTransport();
await server.connect(transport);
//# sourceMappingURL=index.js.map