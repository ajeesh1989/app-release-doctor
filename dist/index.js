import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const execAsync = promisify(exec);
// ============================================================
// MCP SERVER
// ============================================================
const server = new McpServer({
    name: "app-release-doctor",
    version: "1.1.0",
});
// ============================================================
// HELPERS
// ============================================================
function textResult(text) {
    return {
        content: [
            {
                type: "text",
                text,
            },
        ],
    };
}
function formatMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2);
}
function isAabPath(filePath) {
    return filePath.toLowerCase().endsWith(".aab");
}
function projectTempDirectory() {
    const tempDirectory = path.join(process.cwd(), ".tmp");
    if (!fs.existsSync(tempDirectory)) {
        fs.mkdirSync(tempDirectory, {
            recursive: true,
        });
    }
    return tempDirectory;
}
function friendlyPath(projectPath) {
    return path.normalize(projectPath.trim());
}
function isFlutterProject(projectPath) {
    return fs.existsSync(path.join(projectPath, "pubspec.yaml"));
}
function getBuildGradlePath(projectPath) {
    const ktsPath = path.join(projectPath, "android", "app", "build.gradle.kts");
    const groovyPath = path.join(projectPath, "android", "app", "build.gradle");
    if (fs.existsSync(ktsPath)) {
        return ktsPath;
    }
    if (fs.existsSync(groovyPath)) {
        return groovyPath;
    }
    return null;
}
function extractNumber(content, pattern) {
    const match = content.match(pattern);
    if (!match?.[1]) {
        return null;
    }
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
}
function extractString(content, pattern) {
    const match = content.match(pattern);
    return match?.[1] ?? null;
}
function detectReleaseSigning(gradleContent) {
    const kotlinSigningConfig = /signingConfigs\s*\{[\s\S]*?(?:create\s*\(\s*"release"\s*\)|release)[\s\S]*?\}/i.test(gradleContent);
    const kotlinReleaseAssignment = /signingConfig\s*=\s*signingConfigs\s*\.\s*getByName\s*\(\s*"release"\s*\)/i.test(gradleContent);
    const groovySigningConfig = /signingConfigs\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?\}/i.test(gradleContent);
    const groovyReleaseAssignment = /signingConfig\s+signingConfigs\.release/i.test(gradleContent);
    return (kotlinSigningConfig ||
        kotlinReleaseAssignment ||
        groovySigningConfig ||
        groovyReleaseAssignment);
}
function extractSdkValue(content, type) {
    const directPattern = type === "compileSdk"
        ? /compileSdk\s*=?\s*(\d+)/i
        : /targetSdk\s*=?\s*(\d+)/i;
    const direct = extractNumber(content, directPattern);
    if (direct !== null) {
        return direct;
    }
    return null;
}
function classifyFileByExtension(fileName) {
    const lower = fileName
        .replace(/\\/g, "/")
        .toLowerCase();
    if (/\.(png|jpg|jpeg|webp|gif|bmp|heic|avif)$/.test(lower)) {
        return "IMAGE";
    }
    if (/\.(mp3|wav|ogg|m4a|aac|flac)$/.test(lower)) {
        return "AUDIO";
    }
    if (/\.(mp4|mov|mkv|webm|avi)$/.test(lower)) {
        return "VIDEO";
    }
    if (/\.(ttf|otf|woff|woff2)$/.test(lower)) {
        return "FONT";
    }
    return "OTHER";
}
// ============================================================
// TOOL 1 — CHECK TARGET SDK
// ============================================================
server.tool("check_target_sdk", "Check whether an Android target SDK version is suitable for release.", {
    targetSdk: z.number().int().positive(),
}, async ({ targetSdk }) => {
    if (targetSdk >= 36) {
        return textResult(`
🟢 TARGET SDK LOOKS GOOD

Your target SDK:
${targetSdk}

Recommended minimum:
36

WHAT THIS MEANS
---------------
Your app is targeting a recent Android API level.

NEXT STEP
---------
👉 You can continue with the release checks.
        `.trim());
    }
    return textResult(`
🔴 YOUR APP NEEDS AN ANDROID SDK UPDATE

Your target SDK:
${targetSdk}

Recommended:
36 or higher

WHAT THIS MEANS
---------------
Your app is targeting an older Android API level.

WHAT YOU SHOULD DO
------------------
1. Open your Flutter project.

2. Open:
   android/app/build.gradle.kts

3. Find:
   targetSdk = ${targetSdk}

4. Change it to:
   targetSdk = 36

5. Save the file.

6. Run the check again.

NEXT STEP
---------
👉 After changing targetSdk, run the Flutter project release check again.
      `.trim());
});
// ============================================================
// TOOL 2 — CHECK FLUTTER PROJECT
// ============================================================
server.tool("check_flutter_project", "Check a Flutter project and explain whether it is ready for release.", {
    projectPath: z.string(),
}, async ({ projectPath }) => {
    try {
        const normalizedProjectPath = friendlyPath(projectPath);
        if (!fs.existsSync(normalizedProjectPath)) {
            return textResult(`
🔴 PROJECT NOT FOUND

I couldn't find a project at:

${normalizedProjectPath}

WHAT YOU SHOULD DO
------------------
1. Check that the path is correct.
2. Make sure the folder exists.
3. Make sure you selected the main Flutter project folder.

A Flutter project normally contains:

pubspec.yaml
android/
lib/

NEXT STEP
---------
👉 Select the folder containing pubspec.yaml.
          `.trim());
        }
        if (!isFlutterProject(normalizedProjectPath)) {
            return textResult(`
🔴 THIS DOESN'T LOOK LIKE A FLUTTER PROJECT

I couldn't find:

pubspec.yaml

Expected location:

${path.join(normalizedProjectPath, "pubspec.yaml")}

WHAT YOU SHOULD DO
------------------
Select the main Flutter project folder.

Example:

D:\\reflutter\\diceapp
          `.trim());
        }
        const pubspecPath = path.join(normalizedProjectPath, "pubspec.yaml");
        const buildGradlePath = getBuildGradlePath(normalizedProjectPath);
        if (!buildGradlePath) {
            return textResult(`
🔴 ANDROID BUILD FILE NOT FOUND

I found your Flutter project, but I couldn't find:

android/app/build.gradle.kts

or:

android/app/build.gradle

WHAT YOU SHOULD DO
------------------
1. Open the Flutter project.
2. Open android/app.
3. Make sure the Android build file exists.

NEXT STEP
---------
👉 Check the Android folder and try again.
          `.trim());
        }
        const gradleContent = fs.readFileSync(buildGradlePath, "utf8");
        const pubspecContent = fs.readFileSync(pubspecPath, "utf8");
        const compileSdk = extractSdkValue(gradleContent, "compileSdk");
        const targetSdk = extractSdkValue(gradleContent, "targetSdk");
        const compileSdkInherited = /compileSdk\s*=?\s*flutter\.compileSdkVersion/i.test(gradleContent);
        const targetSdkInherited = /targetSdk\s*=?\s*flutter\.targetSdkVersion/i.test(gradleContent);
        const applicationId = extractString(gradleContent, /applicationId\s*=?\s*"([^"]+)"/i);
        const version = extractString(pubspecContent, /^version:\s*([^\s#]+)$/m);
        let versionName = null;
        let versionCode = null;
        if (version) {
            const parts = version.split("+");
            versionName =
                parts[0] ?? null;
            versionCode =
                parts[1] ?? null;
        }
        const hasReleaseSigning = detectReleaseSigning(gradleContent);
        let flutterVersion = "Unknown";
        try {
            const result = await execAsync("flutter --version", {
                maxBuffer: 5 * 1024 * 1024,
            });
            const match = result.stdout.match(/Flutter\s+([\d.]+)/);
            if (match?.[1]) {
                flutterVersion =
                    match[1];
            }
        }
        catch {
            flutterVersion =
                "Flutter version could not be detected";
        }
        const compileSdkOk = compileSdk !== null &&
            compileSdk >= 36;
        const targetSdkOk = targetSdk !== null &&
            targetSdk >= 36;
        const signingOk = hasReleaseSigning;
        const applicationIdOk = applicationId !== null &&
            applicationId.trim().length > 0;
        const versionOk = versionName !== null;
        const versionCodeOk = versionCode !== null &&
            /^\d+$/.test(versionCode);
        const allGood = compileSdkOk &&
            targetSdkOk &&
            signingOk &&
            applicationIdOk &&
            versionOk &&
            versionCodeOk;
        const output = [];
        output.push(allGood
            ? "🟢 YOUR FLUTTER PROJECT LOOKS READY"
            : "🟡 YOUR FLUTTER PROJECT NEEDS ATTENTION");
        output.push("");
        output.push("I checked the important Android release settings.");
        output.push("");
        output.push("ANDROID");
        output.push("-------");
        if (compileSdkOk) {
            output.push(`✅ compileSdk: ${compileSdk}`);
        }
        else if (compileSdkInherited) {
            output.push("ℹ️ compileSdk: Flutter-managed");
            output.push("   Doctor could not determine the exact resolved API level from this file.");
        }
        else {
            output.push(`❌ compileSdk: ${compileSdk ?? "not found"}`);
        }
        if (targetSdkOk) {
            output.push(`✅ targetSdk: ${targetSdk}`);
        }
        else if (targetSdkInherited) {
            output.push("ℹ️ targetSdk: Flutter-managed");
            output.push("   Doctor could not determine the exact resolved API level from this file.");
        }
        else {
            output.push(`❌ targetSdk: ${targetSdk ?? "not found"}`);
        }
        output.push(signingOk
            ? "✅ Release signing appears configured"
            : "❌ Release signing is not configured");
        output.push("");
        output.push("APP INFORMATION");
        output.push("---------------");
        output.push(applicationIdOk
            ? `✅ Application ID: ${applicationId}`
            : "❌ Application ID not found");
        output.push(versionName
            ? `✅ Version: ${versionName}`
            : "❌ Version not found");
        output.push(versionCodeOk
            ? `✅ Version code: ${versionCode}`
            : "❌ Version code not found");
        output.push("");
        output.push("FLUTTER");
        output.push("-------");
        output.push(`Flutter SDK: ${flutterVersion}`);
        output.push("");
        output.push("PROJECT");
        output.push("-------");
        output.push(normalizedProjectPath);
        output.push("");
        if (allGood) {
            output.push("WHAT THIS MEANS");
            output.push("---------------");
            output.push("🟢 The important release settings look good.");
            output.push("");
            output.push("WHAT TO DO NEXT");
            output.push("---------------");
            output.push("👉 Build your release AAB.");
            output.push("👉 Inspect the AAB with App Release Doctor.");
        }
        else {
            output.push("WHAT YOU SHOULD FIX");
            output.push("-------------------");
            let fixNumber = 1;
            if (!compileSdkOk &&
                !compileSdkInherited) {
                output.push(`${fixNumber}. Update compileSdk to 36 or higher.`);
                output.push("   File: android/app/build.gradle.kts");
                fixNumber++;
            }
            if (!targetSdkOk &&
                !targetSdkInherited) {
                output.push(`${fixNumber}. Update targetSdk to 36 or higher.`);
                output.push("   File: android/app/build.gradle.kts");
                fixNumber++;
            }
            if (!signingOk) {
                output.push(`${fixNumber}. Configure release signing before uploading to Google Play.`);
                fixNumber++;
            }
            if (!applicationIdOk) {
                output.push(`${fixNumber}. Add a valid Android application ID.`);
                fixNumber++;
            }
            if (!versionOk) {
                output.push(`${fixNumber}. Add a version in pubspec.yaml.`);
                output.push("   Example: version: 1.0.0+1");
                fixNumber++;
            }
            if (!versionCodeOk) {
                output.push(`${fixNumber}. Add a numeric version code in pubspec.yaml.`);
                output.push("   Example: version: 1.0.0+1");
                fixNumber++;
            }
            output.push("");
            output.push("NEXT STEP");
            output.push("---------");
            output.push("👉 Fix the relevant items above.");
            output.push("👉 Run this check again.");
        }
        return textResult(output.join("\n").trim());
    }
    catch (error) {
        return textResult(`
🔴 I COULDN'T CHECK THE PROJECT

Something went wrong while reading the Flutter project.

Project:

${projectPath}

Error:

${error instanceof Error
            ? error.message
            : String(error)}

NEXT STEP
---------
👉 Check the project path and try again.
        `.trim());
    }
});
// ============================================================
// TOOL 3 — PLAY STORE READINESS
// ============================================================
server.tool("check_play_store_readiness", "Check whether a Flutter Android project is ready for Google Play release.", {
    projectPath: z.string(),
}, async ({ projectPath }) => {
    try {
        const normalizedProjectPath = friendlyPath(projectPath);
        if (!fs.existsSync(normalizedProjectPath)) {
            return textResult(`
🔴 PROJECT NOT FOUND

I couldn't find:

${normalizedProjectPath}

NEXT STEP
---------
👉 Select the Flutter project folder.
          `.trim());
        }
        const pubspecPath = path.join(normalizedProjectPath, "pubspec.yaml");
        if (!fs.existsSync(pubspecPath)) {
            return textResult(`
🔴 FLUTTER PROJECT NOT FOUND

I couldn't find:

pubspec.yaml

Please select the main Flutter project folder.
          `.trim());
        }
        const buildGradlePath = getBuildGradlePath(normalizedProjectPath);
        if (!buildGradlePath) {
            return textResult(`
🔴 ANDROID BUILD FILE NOT FOUND

I couldn't find:

android/app/build.gradle.kts

or:

android/app/build.gradle

Please check the Android project structure.
          `.trim());
        }
        const gradleContent = fs.readFileSync(buildGradlePath, "utf8");
        const pubspecContent = fs.readFileSync(pubspecPath, "utf8");
        const compileSdk = extractSdkValue(gradleContent, "compileSdk");
        const targetSdk = extractSdkValue(gradleContent, "targetSdk");
        const compileSdkInherited = /compileSdk\s*=?\s*flutter\.compileSdkVersion/i.test(gradleContent);
        const targetSdkInherited = /targetSdk\s*=?\s*flutter\.targetSdkVersion/i.test(gradleContent);
        const applicationId = extractString(gradleContent, /applicationId\s*=?\s*"([^"]+)"/i);
        const version = extractString(pubspecContent, /^version:\s*([^\s#]+)$/m);
        let versionName = null;
        let versionCode = null;
        if (version) {
            const parts = version.split("+");
            versionName =
                parts[0] ?? null;
            versionCode =
                parts[1] ?? null;
        }
        const signingConfigured = detectReleaseSigning(gradleContent);
        const checks = {
            compileSdk: compileSdk !== null &&
                compileSdk >= 36,
            targetSdk: targetSdk !== null &&
                targetSdk >= 36,
            signing: signingConfigured,
            applicationId: applicationId !== null &&
                applicationId.trim().length > 0,
            version: versionName !== null,
            versionCode: versionCode !== null &&
                /^\d+$/.test(versionCode),
        };
        const inheritedSdk = compileSdkInherited &&
            targetSdkInherited;
        const failedChecks = Object.entries(checks).filter(([key, passed]) => !passed &&
            !(inheritedSdk &&
                (key === "compileSdk" ||
                    key === "targetSdk")));
        const ready = failedChecks.length === 0;
        const output = [];
        output.push(ready
            ? "🟢 YOUR APP LOOKS READY FOR PLAY STORE"
            : "🔴 YOUR APP IS NOT READY YET");
        output.push("");
        output.push("I checked the main Android release settings.");
        output.push("");
        output.push("RELEASE CHECKS");
        output.push("--------------");
        if (checks.compileSdk) {
            output.push(`✅ compileSdk ${compileSdk}`);
        }
        else if (compileSdkInherited) {
            output.push("ℹ️ compileSdk is managed by Flutter");
        }
        else {
            output.push(`❌ compileSdk ${compileSdk ?? "not found"} — needs 36 or higher`);
        }
        if (checks.targetSdk) {
            output.push(`✅ targetSdk ${targetSdk}`);
        }
        else if (targetSdkInherited) {
            output.push("ℹ️ targetSdk is managed by Flutter");
        }
        else {
            output.push(`❌ targetSdk ${targetSdk ?? "not found"} — needs 36 or higher`);
        }
        output.push(checks.signing
            ? "✅ Release signing appears configured"
            : "❌ Release signing not configured");
        output.push(checks.applicationId
            ? `✅ Application ID: ${applicationId}`
            : "❌ Application ID not found");
        output.push(checks.version
            ? `✅ Version: ${versionName}`
            : "❌ Version not found");
        output.push(checks.versionCode
            ? `✅ Version code: ${versionCode}`
            : "❌ Version code not found");
        output.push("");
        if (ready) {
            output.push("WHAT THIS MEANS");
            output.push("---------------");
            output.push("🟢 Your project passed these release checks.");
            output.push("");
            output.push("WHAT TO DO NEXT");
            output.push("---------------");
            output.push("👉 Build your release AAB.");
            output.push("👉 Inspect the AAB with the Smart AAB Doctor.");
        }
        else {
            output.push("WHAT YOU SHOULD FIX");
            output.push("-------------------");
            let fixNumber = 1;
            if (!checks.compileSdk &&
                !compileSdkInherited) {
                output.push(`${fixNumber}. Update compileSdk to 36 or higher.`);
                fixNumber++;
            }
            if (!checks.targetSdk &&
                !targetSdkInherited) {
                output.push(`${fixNumber}. Update targetSdk to 36 or higher.`);
                fixNumber++;
            }
            if (!checks.signing) {
                output.push(`${fixNumber}. Configure release signing.`);
                fixNumber++;
            }
            if (!checks.applicationId) {
                output.push(`${fixNumber}. Add a valid application ID.`);
                fixNumber++;
            }
            if (!checks.version) {
                output.push(`${fixNumber}. Add a version in pubspec.yaml.`);
                fixNumber++;
            }
            if (!checks.versionCode) {
                output.push(`${fixNumber}. Add a numeric version code in pubspec.yaml.`);
                fixNumber++;
            }
            output.push("");
            output.push("NEXT STEP");
            output.push("---------");
            output.push("👉 Fix the items above.");
            output.push("👉 Run the Play Store check again.");
        }
        output.push("");
        output.push(`Project: ${normalizedProjectPath}`);
        return textResult(output.join("\n").trim());
    }
    catch (error) {
        return textResult(`
🔴 PLAY STORE CHECK FAILED

I couldn't complete the release check.

Error:

${error instanceof Error
            ? error.message
            : String(error)}

NEXT STEP
---------
👉 Check the project path and try again.
        `.trim());
    }
});
// ============================================================
// TOOL 4 — BUILD RELEASE
// ============================================================
server.tool("build_release", "Build a Flutter Android App Bundle in release mode and explain the result.", {
    projectPath: z.string(),
}, async ({ projectPath }) => {
    try {
        const normalizedProjectPath = friendlyPath(projectPath);
        if (!fs.existsSync(normalizedProjectPath)) {
            return textResult(`
🔴 PROJECT NOT FOUND

I couldn't find:

${normalizedProjectPath}

NEXT STEP
---------
👉 Select the Flutter project folder.
          `.trim());
        }
        if (!isFlutterProject(normalizedProjectPath)) {
            return textResult(`
🔴 THIS DOESN'T LOOK LIKE A FLUTTER PROJECT

I couldn't find:

pubspec.yaml

Please select the main Flutter project folder.
          `.trim());
        }
        const aabPath = path.join(normalizedProjectPath, "build", "app", "outputs", "bundle", "release", "app-release.aab");
        try {
            await execAsync("flutter build appbundle --release", {
                cwd: normalizedProjectPath,
                maxBuffer: 50 * 1024 * 1024,
            });
        }
        catch (error) {
            const execError = error;
            const buildOutput = execError.stderr ||
                execError.stdout ||
                execError.message ||
                String(error);
            return textResult(`
🔴 RELEASE BUILD FAILED

Flutter could not create the release AAB.

PROJECT
-------
${normalizedProjectPath}

BUILD MESSAGE
-------------
${buildOutput}

WHAT YOU SHOULD DO
------------------
1. Read the error above.
2. Fix the reported problem.
3. Run the release build again.

COMMAND
-------
flutter build appbundle --release
          `.trim());
        }
        if (!fs.existsSync(aabPath)) {
            return textResult(`
🔴 BUILD FINISHED, BUT THE AAB WAS NOT FOUND

Flutter completed the build command, but I couldn't find:

${aabPath}

Check:

build/app/outputs/bundle/release/

NEXT STEP
---------
👉 Find the generated .aab and run the AAB inspection.
          `.trim());
        }
        const stats = fs.statSync(aabPath);
        const sizeMB = formatMB(stats.size);
        return textResult(`
🟢 RELEASE BUILD SUCCESSFUL

Good news — your Android App Bundle was created successfully.

AAB FILE
--------
Name:
${path.basename(aabPath)}

Size:
${sizeMB} MB

Location:
${aabPath}

WHAT THIS MEANS
---------------
Your Flutter release build completed successfully.

WHAT TO DO NEXT
---------------
👉 Run the Smart AAB Inspection.

AAB:

${aabPath}

🟢 Flutter release build completed successfully.
        `.trim());
    }
    catch (error) {
        return textResult(`
🔴 RELEASE BUILD FAILED

Something unexpected happened.

Error:

${error instanceof Error
            ? error.message
            : String(error)}

NEXT STEP
---------
👉 Check the Flutter project and try again.
        `.trim());
    }
});
// ============================================================
// TOOL 5 — BASIC AAB ANALYSIS
// ============================================================
server.tool("analyze_aab", "Check whether an Android App Bundle exists and is readable.", {
    aabPath: z.string(),
}, async ({ aabPath }) => {
    try {
        const normalizedAabPath = path.normalize(aabPath.trim());
        if (!isAabPath(normalizedAabPath)) {
            return textResult(`
🔴 I NEED THE AAB FILE

You entered:

${normalizedAabPath}

That does not look like an AAB file.

An AAB file must end with:

.aab
          `.trim());
        }
        if (!fs.existsSync(normalizedAabPath)) {
            return textResult(`
🔴 AAB FILE NOT FOUND

I couldn't find:

${normalizedAabPath}

Please check the path and try again.
          `.trim());
        }
        const stats = fs.statSync(normalizedAabPath);
        if (!stats.isFile()) {
            return textResult(`
🔴 THAT PATH IS NOT AN AAB FILE

The selected path is not a file:

${normalizedAabPath}

👉 Select the actual .aab file.
          `.trim());
        }
        const fileHandle = fs.openSync(normalizedAabPath, "r");
        const header = Buffer.alloc(4);
        try {
            fs.readSync(fileHandle, header, 0, 4, 0);
        }
        finally {
            fs.closeSync(fileHandle);
        }
        const isZip = header[0] === 0x50 &&
            header[1] === 0x4b;
        if (!isZip) {
            return textResult(`
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
          `.trim());
        }
        return textResult(`
🟢 AAB FOUND AND READABLE

FILE
----
${path.basename(normalizedAabPath)}

SIZE
----
${formatMB(stats.size)} MB

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
        `.trim());
    }
    catch (error) {
        return textResult(`
🔴 I COULDN'T READ THE AAB

Something went wrong while opening:

${aabPath}

Error:

${error instanceof Error
            ? error.message
            : String(error)}

NEXT STEP
---------
👉 Check the file and try again.
        `.trim());
    }
});
// ============================================================
// TOOL 6 — SMART AAB DOCTOR
// ============================================================
server.tool("inspect_aab", "Deeply inspect an Android App Bundle and provide a meaningful release health report.", {
    aabPath: z.string(),
}, async ({ aabPath }) => {
    let tempScript = null;
    try {
        const normalizedAabPath = path.normalize(aabPath.trim());
        // --------------------------------------------------------
        // VALIDATE PATH
        // --------------------------------------------------------
        if (!isAabPath(normalizedAabPath)) {
            return textResult(`
🔴 I NEED THE AAB FILE

You entered:

${normalizedAabPath}

That does not look like an Android App Bundle.

The file must end with:

.aab
          `.trim());
        }
        if (!fs.existsSync(normalizedAabPath)) {
            return textResult(`
🔴 AAB FILE NOT FOUND

I couldn't find:

${normalizedAabPath}

NEXT STEP
---------
👉 Select the actual app-release.aab file.
          `.trim());
        }
        const fileStats = fs.statSync(normalizedAabPath);
        if (!fileStats.isFile()) {
            return textResult(`
🔴 THAT PATH IS NOT AN AAB FILE

The selected path is not a file:

${normalizedAabPath}

👉 Select the actual .aab file.
          `.trim());
        }
        // --------------------------------------------------------
        // CREATE TEMP POWERSHELL SCRIPT
        // --------------------------------------------------------
        tempScript =
            path.join(projectTempDirectory(), `smart-aab-${Date.now()}.ps1`);
        const escapedPath = normalizedAabPath.replace(/'/g, "''");
        /*
         * IMPORTANT:
         * Do not use PowerShell backticks inside this
         * JavaScript template literal.
         */
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
        fs.writeFileSync(tempScript, script, "utf8");
        // --------------------------------------------------------
        // RUN POWERSHELL
        // --------------------------------------------------------
        let stdout = "";
        try {
            const result = await execAsync(`powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tempScript}"`, {
                maxBuffer: 100 * 1024 * 1024,
            });
            stdout =
                result.stdout;
        }
        catch (error) {
            const execError = error;
            return textResult(`
🔴 I COULDN'T INSPECT THE AAB

The AAB exists, but Windows could not read its contents.

AAB:

${normalizedAabPath}

ERROR
-----
${execError.stderr ||
                execError.message ||
                String(error)}

WHAT YOU SHOULD DO
------------------
1. Make sure the AAB is not locked.
2. Build a fresh release bundle.
3. Try the inspection again.

COMMAND
-------
flutter build appbundle --release
          `.trim());
        }
        // --------------------------------------------------------
        // PARSE ZIP ENTRIES
        // --------------------------------------------------------
        const lines = stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        if (lines.length === 0) {
            return textResult(`
🔴 I COULDN'T INSPECT THE AAB

The file exists, but no bundle entries were returned.

AAB:

${normalizedAabPath}

NEXT STEP
---------
👉 Build a fresh AAB and try again.
          `.trim());
        }
        function classifyEntry(name) {
            const normalized = name
                .replace(/\\/g, "/")
                .toLowerCase();
            if (normalized.startsWith("debug/") ||
                normalized.includes("/debug/") ||
                normalized.startsWith("symbols/") ||
                normalized.includes("/symbols/") ||
                normalized.endsWith(".dbg") ||
                normalized.endsWith(".debug") ||
                normalized.includes("debugsymbols") ||
                normalized.includes("debug-symbols")) {
                return "DEBUG_METADATA";
            }
            if (normalized.startsWith("bundle-metadata/") ||
                normalized.includes("/bundle-metadata/") ||
                normalized.startsWith("meta-inf/") ||
                normalized.includes("/meta-inf/") ||
                normalized.endsWith(".kotlin_metadata") ||
                normalized.endsWith(".kotlin_module") ||
                normalized.endsWith(".version")) {
                return "METADATA";
            }
            if (normalized.includes("flutter_assets/")) {
                return "ASSET";
            }
            if (normalized.endsWith(".so")) {
                return "NATIVE";
            }
            if (normalized.endsWith(".dex")) {
                return "DEX";
            }
            if (normalized.startsWith("base/") ||
                normalized.startsWith("feature/")) {
                return "APP";
            }
            return "UNKNOWN";
        }
        const entries = [];
        for (const line of lines) {
            const firstSeparator = line.indexOf("|");
            if (firstSeparator ===
                -1) {
                continue;
            }
            const secondSeparator = line.indexOf("|", firstSeparator + 1);
            const name = line.substring(0, firstSeparator);
            const sizeText = secondSeparator ===
                -1
                ? line.substring(firstSeparator + 1)
                : line.substring(firstSeparator + 1, secondSeparator);
            const sha256 = secondSeparator ===
                -1
                ? ""
                : line.substring(secondSeparator + 1);
            const size = Number(sizeText);
            if (!name) {
                continue;
            }
            entries.push({
                name,
                size: Number.isFinite(size)
                    ? size
                    : 0,
                sha256,
                entryClass: classifyEntry(name),
            });
        }
        // --------------------------------------------------------
        // BASIC METRICS
        // --------------------------------------------------------
        const totalEntries = entries.length;
        const totalUncompressedSize = entries.reduce((sum, entry) => sum + entry.size, 0);
        const aabSize = fileStats.size;
        const meaningfulEntries = entries.filter((entry) => entry.entryClass !==
            "DEBUG_METADATA" &&
            entry.entryClass !==
                "METADATA");
        const debugMetadataEntries = entries.filter((entry) => entry.entryClass ===
            "DEBUG_METADATA");
        const metadataEntries = entries.filter((entry) => entry.entryClass ===
            "METADATA");
        // --------------------------------------------------------
        // CONTENT TYPES
        // --------------------------------------------------------
        const flutterAssets = entries.filter((entry) => entry.name
            .replace(/\\/g, "/")
            .toLowerCase()
            .includes("flutter_assets/"));
        const images = meaningfulEntries.filter((entry) => /\.(png|jpg|jpeg|webp|gif|bmp|heic|avif)$/i.test(entry.name));
        const audio = meaningfulEntries.filter((entry) => /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(entry.name));
        const videos = meaningfulEntries.filter((entry) => /\.(mp4|mov|mkv|webm|avi)$/i.test(entry.name));
        const fonts = meaningfulEntries.filter((entry) => /\.(ttf|otf|woff|woff2)$/i.test(entry.name));
        const nativeLibraries = entries.filter((entry) => entry.entryClass ===
            "NATIVE");
        const dexFiles = entries.filter((entry) => entry.entryClass ===
            "DEX");
        // --------------------------------------------------------
        // SIZE METRICS
        // --------------------------------------------------------
        const imageSize = images.reduce((sum, entry) => sum + entry.size, 0);
        const audioSize = audio.reduce((sum, entry) => sum + entry.size, 0);
        const videoSize = videos.reduce((sum, entry) => sum + entry.size, 0);
        const nativeSize = nativeLibraries.reduce((sum, entry) => sum + entry.size, 0);
        const meaningfulContentSize = meaningfulEntries.reduce((sum, entry) => sum + entry.size, 0);
        // --------------------------------------------------------
        // LARGEST FILES
        // --------------------------------------------------------
        const largestFiles = [
            ...meaningfulEntries,
        ]
            .sort((a, b) => b.size -
            a.size)
            .slice(0, 15);
        const largestImages = [
            ...images,
        ]
            .sort((a, b) => b.size -
            a.size)
            .slice(0, 10);
        const largestAudio = [
            ...audio,
        ]
            .sort((a, b) => b.size -
            a.size)
            .slice(0, 10);
        const largestVideos = [
            ...videos,
        ]
            .sort((a, b) => b.size -
            a.size)
            .slice(0, 5);
        // --------------------------------------------------------
        // DUPLICATES
        // --------------------------------------------------------
        const hashGroups = new Map();
        for (const entry of meaningfulEntries) {
            if (!entry.sha256) {
                continue;
            }
            const existing = hashGroups.get(entry.sha256);
            if (existing) {
                existing.push(entry);
            }
            else {
                hashGroups.set(entry.sha256, [entry]);
            }
        }
        const duplicateGroups = Array.from(hashGroups.values()).filter((group) => group.length > 1);
        let duplicateBytes = 0;
        for (const group of duplicateGroups) {
            const first = group[0];
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
        const architectures = new Set();
        for (const entry of nativeLibraries) {
            const match = entry.name.match(/(?:^|\/)base\/lib\/([^/]+)\//);
            if (match?.[1]) {
                architectures.add(match[1]);
            }
        }
        // --------------------------------------------------------
        // FINDINGS
        // --------------------------------------------------------
        const findings = [];
        // Base manifest
        const hasBaseManifest = entries.some((entry) => entry.name
            .replace(/\\/g, "/")
            .toLowerCase() ===
            "base/manifest/androidmanifest.xml");
        if (!hasBaseManifest) {
            findings.push({
                severity: "HIGH",
                kind: "PROBLEM",
                title: "Base Android manifest was not detected",
                reason: "The AAB does not contain the expected base/manifest/AndroidManifest.xml entry.",
                action: "Verify that this is a complete release AAB and rebuild it with flutter build appbundle --release.",
            });
        }
        // Executable content
        if (dexFiles.length ===
            0 &&
            nativeLibraries.length ===
                0) {
            findings.push({
                severity: "HIGH",
                kind: "PROBLEM",
                title: "No executable application content detected",
                reason: "The bundle does not contain DEX files or native Android libraries.",
                action: "Make sure this is the intended release AAB and rebuild it using flutter build appbundle --release.",
            });
        }
        // Very large images
        const veryLargeImages = images.filter((image) => image.size >=
            10 *
                1024 *
                1024);
        const largeImages = images.filter((image) => image.size >=
            2 *
                1024 *
                1024);
        if (veryLargeImages.length >
            0) {
            const preview = veryLargeImages
                .slice(0, 3)
                .map((image) => `${formatMB(image.size)} MB — ${image.name}`)
                .join("\n   ");
            findings.push({
                severity: "MEDIUM",
                kind: "OPTIMIZATION",
                title: "Very large images found",
                reason: `${veryLargeImages.length} image(s) are 10 MB or larger.\n   ${preview}`,
                action: "Consider reducing image resolution or compressing the images while preserving visual quality.",
            });
        }
        else if (largeImages.length >
            0) {
            const preview = largeImages
                .slice(0, 3)
                .map((image) => `${formatMB(image.size)} MB — ${image.name}`)
                .join("\n   ");
            findings.push({
                severity: "LOW",
                kind: "OPTIMIZATION",
                title: "Large images worth reviewing",
                reason: `${largeImages.length} image(s) are 2 MB or larger.\n   ${preview}`,
                action: "Review whether these images can be resized or compressed without affecting the app's appearance.",
            });
        }
        // Audio
        const veryLargeAudio = audio.filter((sound) => sound.size >=
            10 *
                1024 *
                1024);
        const largeAudio = audio.filter((sound) => sound.size >=
            5 *
                1024 *
                1024);
        if (veryLargeAudio.length >
            0) {
            const preview = veryLargeAudio
                .slice(0, 3)
                .map((sound) => `${formatMB(sound.size)} MB — ${sound.name}`)
                .join("\n   ");
            findings.push({
                severity: "MEDIUM",
                kind: "OPTIMIZATION",
                title: "Very large audio files found",
                reason: `${veryLargeAudio.length} audio file(s) are 10 MB or larger.\n   ${preview}`,
                action: "Consider reducing bitrate or using a more size-efficient encoding.",
            });
        }
        else if (largeAudio.length >
            0) {
            const preview = largeAudio
                .slice(0, 3)
                .map((sound) => `${formatMB(sound.size)} MB — ${sound.name}`)
                .join("\n   ");
            findings.push({
                severity: "LOW",
                kind: "OPTIMIZATION",
                title: "Large audio files worth reviewing",
                reason: `${largeAudio.length} audio file(s) are 5 MB or larger.\n   ${preview}`,
                action: "Review bitrate and encoding if reducing app size is important.",
            });
        }
        // Videos
        const veryLargeVideos = videos.filter((video) => video.size >=
            50 *
                1024 *
                1024);
        const largeVideos = videos.filter((video) => video.size >=
            20 *
                1024 *
                1024);
        if (veryLargeVideos.length >
            0) {
            const preview = veryLargeVideos
                .slice(0, 3)
                .map((video) => `${formatMB(video.size)} MB — ${video.name}`)
                .join("\n   ");
            findings.push({
                severity: "MEDIUM",
                kind: "OPTIMIZATION",
                title: "Very large video files found",
                reason: `${veryLargeVideos.length} video file(s) are 50 MB or larger.\n   ${preview}`,
                action: "Consider reducing video resolution, bitrate, duration, or encoding size.",
            });
        }
        else if (largeVideos.length >
            0) {
            const preview = largeVideos
                .slice(0, 3)
                .map((video) => `${formatMB(video.size)} MB — ${video.name}`)
                .join("\n   ");
            findings.push({
                severity: "LOW",
                kind: "OPTIMIZATION",
                title: "Large video files worth reviewing",
                reason: `${largeVideos.length} video file(s) are 20 MB or larger.\n   ${preview}`,
                action: "Review video encoding and resolution if reducing application size is important.",
            });
        }
        // Duplicate content
        if (duplicateGroups.length >
            0 &&
            duplicateBytes >=
                10 *
                    1024 *
                    1024) {
            findings.push({
                severity: "MEDIUM",
                kind: "OPTIMIZATION",
                title: "Significant duplicate content detected",
                reason: `${duplicateGroups.length} duplicate group(s) represent approximately ${formatMB(duplicateBytes)} MB of repeated content.`,
                action: "Check whether the repeated assets are intentionally included more than once.",
            });
        }
        else if (duplicateGroups.length >
            0 &&
            duplicateBytes >=
                2 *
                    1024 *
                    1024) {
            findings.push({
                severity: "LOW",
                kind: "OPTIMIZATION",
                title: "Duplicate content detected",
                reason: `${duplicateGroups.length} duplicate group(s) represent approximately ${formatMB(duplicateBytes)} MB of repeated content.`,
                action: "Review the duplicates if you want to reduce the application footprint.",
            });
        }
        // Overall content size
        if (meaningfulContentSize >
            300 *
                1024 *
                1024) {
            findings.push({
                severity: "MEDIUM",
                kind: "OPTIMIZATION",
                title: "Large amount of application content",
                reason: `Meaningful application content totals approximately ${formatMB(meaningfulContentSize)} MB uncompressed.`,
                action: "Review the largest assets and remove or compress anything the app does not need.",
            });
        }
        else if (meaningfulContentSize >
            200 *
                1024 *
                1024) {
            findings.push({
                severity: "LOW",
                kind: "OPTIMIZATION",
                title: "Application content is fairly large",
                reason: `Meaningful application content totals approximately ${formatMB(meaningfulContentSize)} MB uncompressed.`,
                action: "Review large assets if reducing the application footprint is important.",
            });
        }
        // Large non-media file
        const largestNonMediaFile = largestFiles.find((entry) => entry.entryClass !==
            "NATIVE" &&
            !/\.(png|jpg|jpeg|webp|gif|bmp|heic|avif|mp3|wav|ogg|m4a|aac|flac|mp4|mov|mkv|webm|avi)$/i.test(entry.name));
        if (largestNonMediaFile &&
            largestNonMediaFile.size >
                25 *
                    1024 *
                    1024) {
            findings.push({
                severity: "MEDIUM",
                kind: "OPTIMIZATION",
                title: "One particularly large application file was found",
                reason: `${largestNonMediaFile.name} is ${formatMB(largestNonMediaFile.size)} MB.`,
                action: "Review whether this file really needs to be bundled at this size.",
            });
        }
        // Architecture information
        if (architectures.size >=
            3) {
            findings.push({
                severity: "INFO",
                kind: "INFO",
                title: "Multiple Android architectures found",
                reason: `The bundle contains: ${Array.from(architectures).join(", ")}.`,
                action: "This can be normal for Flutter apps. Keep the architectures your app needs to support.",
            });
        }
        // Native libraries
        if (nativeLibraries.length >
            0) {
            findings.push({
                severity: "INFO",
                kind: "INFO",
                title: "Native Android libraries found",
                reason: `The AAB contains ${nativeLibraries.length} native library file(s), using approximately ${formatMB(nativeSize)} MB uncompressed.`,
                action: "This is normal for Flutter applications and many Flutter plugins.",
            });
        }
        // Debug metadata
        if (debugMetadataEntries.length >
            0) {
            findings.push({
                severity: "INFO",
                kind: "INFO",
                title: "Debug/build metadata ignored",
                reason: `${debugMetadataEntries.length} debug/build metadata file(s) were detected.`,
                action: "These entries are excluded from release health and optimization calculations.",
            });
        }
        // --------------------------------------------------------
        // FINDING GROUPS
        // --------------------------------------------------------
        const problemFindings = findings.filter((finding) => finding.kind ===
            "PROBLEM");
        const optimizationFindings = findings.filter((finding) => finding.kind ===
            "OPTIMIZATION");
        const informationFindings = findings.filter((finding) => finding.kind ===
            "INFO");
        // --------------------------------------------------------
        // SCORE
        // --------------------------------------------------------
        let score = 100;
        let highProblemCount = 0;
        let mediumProblemCount = 0;
        let lowProblemCount = 0;
        for (const finding of problemFindings) {
            if (finding.severity ===
                "HIGH") {
                highProblemCount++;
            }
            else if (finding.severity ===
                "MEDIUM") {
                mediumProblemCount++;
            }
            else if (finding.severity ===
                "LOW") {
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
            Math.max(0, Math.min(100, score));
        let healthLabel = "🟢 HEALTHY";
        if (score < 90) {
            healthLabel =
                "🟡 NEEDS REVIEW";
        }
        if (score < 70) {
            healthLabel =
                "🟠 ATTENTION NEEDED";
        }
        if (score < 40) {
            healthLabel =
                "🔴 SIGNIFICANT ISSUES";
        }
        // --------------------------------------------------------
        // OUTPUT
        // --------------------------------------------------------
        const output = [];
        output.push("🩺 APP RELEASE DOCTOR");
        output.push("SMART AAB INSPECTION");
        output.push("");
        output.push("I opened your AAB and checked its structure, application content, release risks, and optional optimizations.");
        output.push("");
        output.push("RELEASE HEALTH");
        output.push("--------------");
        output.push(`${healthLabel}  ${score}/100`);
        output.push("");
        output.push("The score measures actual release risks detected inside the AAB.");
        output.push("Optimization suggestions do NOT reduce the score.");
        output.push("Normal build metadata does NOT reduce the score.");
        output.push("This is NOT a Google Play approval score.");
        output.push("");
        // --------------------------------------------------------
        // AAB
        // --------------------------------------------------------
        output.push("AAB");
        output.push("---");
        output.push(`File: ${path.basename(normalizedAabPath)}`);
        output.push(`Upload file size: ${formatMB(aabSize)} MB`);
        output.push(`Uncompressed contents: ${formatMB(totalUncompressedSize)} MB`);
        output.push(`Meaningful content: ${formatMB(meaningfulContentSize)} MB`);
        output.push(`Files inside bundle: ${totalEntries}`);
        output.push("");
        output.push("Note: uncompressed content size is a diagnostic metric. It is not the same as the final Google Play download size.");
        output.push("");
        // --------------------------------------------------------
        // CONTENT SUMMARY
        // --------------------------------------------------------
        output.push("CONTENT SUMMARY");
        output.push("---------------");
        output.push(`📦 Flutter assets: ${flutterAssets.length}`);
        output.push(`🖼️ Images: ${images.length} (${formatMB(imageSize)} MB)`);
        output.push(`🔊 Audio: ${audio.length} (${formatMB(audioSize)} MB)`);
        output.push(`🎬 Videos: ${videos.length} (${formatMB(videoSize)} MB)`);
        output.push(`⚙️ Native libraries: ${nativeLibraries.length} (${formatMB(nativeSize)} MB)`);
        output.push(`🔤 Fonts: ${fonts.length}`);
        output.push(`📱 DEX files: ${dexFiles.length}`);
        output.push("");
        // --------------------------------------------------------
        // ARCHITECTURES
        // --------------------------------------------------------
        output.push("ANDROID ARCHITECTURES");
        output.push("---------------------");
        if (architectures.size >
            0) {
            output.push(Array.from(architectures).join(", "));
        }
        else {
            output.push("No native Android architectures detected.");
        }
        output.push("");
        // --------------------------------------------------------
        // NATIVE FOOTPRINT
        // --------------------------------------------------------
        output.push("NATIVE LIBRARY FOOTPRINT");
        output.push("------------------------");
        if (nativeLibraries.length >
            0) {
            output.push(`Total native libraries: ${nativeLibraries.length}`);
            output.push(`Uncompressed native size: ${formatMB(nativeSize)} MB`);
            const largestNative = [
                ...nativeLibraries,
            ]
                .sort((a, b) => b.size -
                a.size)
                .slice(0, 6);
            for (const nativeFile of largestNative) {
                output.push(`• ${formatMB(nativeFile.size)} MB — ${nativeFile.name}`);
            }
        }
        else {
            output.push("No native libraries detected.");
        }
        output.push("");
        // --------------------------------------------------------
        // RELEASE RISKS
        // --------------------------------------------------------
        output.push("RELEASE RISKS");
        output.push("-------------");
        output.push(`🔴 High: ${highProblemCount}`);
        output.push(`🟠 Medium: ${mediumProblemCount}`);
        output.push(`🟡 Low: ${lowProblemCount}`);
        output.push("");
        if (problemFindings.length ===
            0) {
            output.push("🟢 No obvious release risks were detected from the AAB contents.");
        }
        else {
            let number = 1;
            for (const finding of problemFindings) {
                let icon = "🟡";
                if (finding.severity ===
                    "HIGH") {
                    icon =
                        "🔴";
                }
                else if (finding.severity ===
                    "MEDIUM") {
                    icon =
                        "🟠";
                }
                output.push(`${number}. ${icon} ${finding.title}`);
                output.push(`   Why: ${finding.reason}`);
                output.push(`   What to do: ${finding.action}`);
                output.push("");
                number++;
            }
        }
        // --------------------------------------------------------
        // OPTIMIZATION
        // --------------------------------------------------------
        output.push("OPTIMIZATION SUGGESTIONS");
        output.push("------------------------");
        output.push(`🟡 ${optimizationFindings.length} suggestion(s)`);
        output.push("");
        if (optimizationFindings.length ===
            0) {
            output.push("🟢 No obvious size optimization opportunities were detected.");
        }
        else {
            let number = 1;
            for (const finding of optimizationFindings) {
                const icon = finding.severity ===
                    "MEDIUM"
                    ? "🟠"
                    : "🟡";
                output.push(`${number}. ${icon} ${finding.title}`);
                output.push(`   Why: ${finding.reason}`);
                output.push(`   Suggestion: ${finding.action}`);
                output.push("");
                number++;
            }
        }
        // --------------------------------------------------------
        // BUILD METADATA
        // --------------------------------------------------------
        output.push("BUILD / DEBUG METADATA");
        output.push("-----------------------");
        output.push(`ℹ️ Debug metadata ignored: ${debugMetadataEntries.length}`);
        output.push(`ℹ️ Normal metadata ignored: ${metadataEntries.length}`);
        output.push("These entries are excluded from release-risk and optimization calculations.");
        output.push("");
        // --------------------------------------------------------
        // INFORMATION
        // --------------------------------------------------------
        output.push("NORMAL / INFORMATIONAL");
        output.push("----------------------");
        if (informationFindings.length ===
            0) {
            output.push("No additional informational findings.");
        }
        else {
            for (const finding of informationFindings) {
                output.push(`ℹ️ ${finding.title}`);
                output.push(`   ${finding.reason}`);
                output.push(`   ${finding.action}`);
                output.push("");
            }
        }
        // --------------------------------------------------------
        // LARGEST FILES
        // --------------------------------------------------------
        output.push("TOP 10 LARGEST MEANINGFUL FILES");
        output.push("-------------------------------");
        if (largestFiles.length ===
            0) {
            output.push("No meaningful application files detected.");
        }
        else {
            for (let i = 0; i <
                Math.min(10, largestFiles.length); i++) {
                const entry = largestFiles[i];
                if (!entry) {
                    continue;
                }
                output.push(`${i + 1}. ${formatMB(entry.size)} MB — ${entry.name}`);
            }
        }
        output.push("");
        // --------------------------------------------------------
        // DUPLICATES
        // --------------------------------------------------------
        output.push("DUPLICATE FILE CHECK");
        output.push("--------------------");
        if (duplicateGroups.length ===
            0) {
            output.push("🟢 No duplicate application content detected.");
        }
        else {
            output.push(`Found ${duplicateGroups.length} duplicate group(s).`);
            output.push(`Potential repeated content: ${formatMB(duplicateBytes)} MB`);
            output.push("");
            const previewGroups = duplicateGroups.slice(0, 5);
            for (let i = 0; i <
                previewGroups.length; i++) {
                const group = previewGroups[i];
                if (!group) {
                    continue;
                }
                output.push(`Group ${i + 1}:`);
                for (const entry of group) {
                    output.push(`  ${formatMB(entry.size)} MB — ${entry.name}`);
                }
                output.push("");
            }
            if (duplicateGroups.length >
                5) {
                output.push(`Showing first 5 of ${duplicateGroups.length} duplicate groups.`);
                output.push("");
            }
        }
        // --------------------------------------------------------
        // WHAT THIS MEANS
        // --------------------------------------------------------
        output.push("WHAT THIS MEANS");
        output.push("---------------");
        if (highProblemCount >
            0) {
            output.push("🔴 Important release risks were detected. Review them before release.");
        }
        else if (mediumProblemCount >
            0) {
            output.push("🟠 Meaningful release risks were detected. Review them before publishing.");
        }
        else if (lowProblemCount >
            0) {
            output.push("🟡 Minor release risks were detected.");
        }
        else if (optimizationFindings.length >
            0) {
            output.push("🟢 No obvious release risks were detected. The remaining findings are optional optimizations.");
        }
        else {
            output.push("🟢 No obvious release risks or major optimization opportunities were detected.");
        }
        output.push("");
        // --------------------------------------------------------
        // SCORE
        // --------------------------------------------------------
        output.push("SCORE EXPLANATION");
        output.push("-----------------");
        output.push("HIGH release problem: -30 points");
        output.push("MEDIUM release problem: -12 points");
        output.push("LOW release problem: -4 points");
        output.push("Optimization suggestion: 0 points");
        output.push("Informational finding: 0 points");
        output.push("");
        output.push(`Current release problems affecting score: ${problemFindings.length}`);
        output.push(`Optimization suggestions not affecting score: ${optimizationFindings.length}`);
        output.push(`Informational findings not affecting score: ${informationFindings.length}`);
        output.push("");
        // --------------------------------------------------------
        // IMPORTANT
        // --------------------------------------------------------
        output.push("IMPORTANT");
        output.push("---------");
        output.push("This inspection focuses on the actual contents and structure of the AAB.");
        output.push("It does not replace Google Play's own validation.");
        output.push("A healthy Doctor score does not guarantee Google Play approval.");
        output.push("");
        // --------------------------------------------------------
        // NEXT STEP
        // --------------------------------------------------------
        output.push("NEXT STEP");
        output.push("---------");
        if (problemFindings.length >
            0) {
            output.push("👉 Review the release risks above.");
            output.push("👉 Fix anything relevant to your app.");
            output.push("👉 Build a fresh AAB and inspect it again.");
        }
        else if (optimizationFindings.length >
            0) {
            output.push("👉 Your AAB passed the release-risk inspection.");
            output.push("👉 The optimization suggestions are optional.");
            output.push("👉 You can continue with your release process.");
        }
        else {
            output.push("👉 Your AAB passed this inspection.");
            output.push("👉 You can continue with your release process.");
        }
        output.push("");
        output.push("🟢 SMART AAB INSPECTION COMPLETE");
        return textResult(output.join("\n").trim());
    }
    catch (error) {
        return textResult(`
🔴 AAB INSPECTION FAILED

I found the AAB, but something went wrong while inspecting it.

File:

${aabPath}

Error:

${error instanceof Error
            ? error.message
            : String(error)}

WHAT YOU SHOULD DO
------------------
1. Build a fresh AAB:

   flutter build appbundle --release

2. Find:

   build/app/outputs/bundle/release/app-release.aab

3. Run the inspection again.
        `.trim());
    }
    finally {
        if (tempScript) {
            try {
                if (fs.existsSync(tempScript)) {
                    fs.unlinkSync(tempScript);
                }
            }
            catch {
                // Ignore cleanup errors.
            }
        }
    }
});
// ============================================================
// MCP SERVER STARTUP
// ============================================================
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    console.error("Fatal MCP server error:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map