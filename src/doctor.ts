import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

// ============================================================
// TYPES
// ============================================================

export type DoctorResult = {
  success: boolean;
  score: number;
  health: string;
  report: string;
};

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
  severity: "HIGH" | "MEDIUM" | "LOW" | "INFO";
  kind: "PROBLEM" | "OPTIMIZATION" | "INFO";
  title: string;
  reason: string;
  action: string;
};

// ============================================================
// HELPERS
// ============================================================

export function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function isAabPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".aab");
}

function projectTempDirectory(): string {
  const directory = path.join(process.cwd(), ".tmp");

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {
      recursive: true,
    });
  }

  return directory;
}

function friendlyPath(value: string): string {
  return path.normalize(value.trim());
}

function isFlutterProject(projectPath: string): boolean {
  return fs.existsSync(
    path.join(projectPath, "pubspec.yaml")
  );
}

function getBuildGradlePath(
  projectPath: string
): string | null {
  const kts = path.join(
    projectPath,
    "android",
    "app",
    "build.gradle.kts"
  );

  const groovy = path.join(
    projectPath,
    "android",
    "app",
    "build.gradle"
  );

  if (fs.existsSync(kts)) {
    return kts;
  }

  if (fs.existsSync(groovy)) {
    return groovy;
  }

  return null;
}

function extractNumber(
  content: string,
  pattern: RegExp
): number | null {
  const match = content.match(pattern);

  if (!match?.[1]) {
    return null;
  }

  const value = Number(match[1]);

  return Number.isFinite(value)
    ? value
    : null;
}

function extractString(
  content: string,
  pattern: RegExp
): string | null {
  const match = content.match(pattern);

  return match?.[1] ?? null;
}

function detectReleaseSigning(
  content: string
): boolean {
  return (
    /signingConfigs\s*\{[\s\S]*?(release|create\s*\(\s*["']release["']\s*\))/i.test(
      content
    ) &&
    /signingConfig/i.test(content)
  );
}

function extractSdkValue(
  content: string,
  type: "compileSdk" | "targetSdk"
): number | null {
  const pattern =
    type === "compileSdk"
      ? /compileSdk\s*=?\s*(\d+)/i
      : /targetSdk\s*=?\s*(\d+)/i;

  return extractNumber(content, pattern);
}

function classifyEntry(
  name: string
): EntryClass {
  const normalized = name
    .replace(/\\/g, "/")
    .toLowerCase();

  if (
    normalized.startsWith("debug/") ||
    normalized.includes("/debug/") ||
    normalized.startsWith("symbols/") ||
    normalized.includes("/symbols/") ||
    normalized.endsWith(".dbg") ||
    normalized.endsWith(".debug") ||
    normalized.includes("debugsymbols") ||
    normalized.includes("debug-symbols")
  ) {
    return "DEBUG_METADATA";
  }

  if (
    normalized.startsWith("bundle-metadata/") ||
    normalized.includes("/bundle-metadata/") ||
    normalized.startsWith("meta-inf/") ||
    normalized.includes("/meta-inf/") ||
    normalized.endsWith(".kotlin_metadata") ||
    normalized.endsWith(".kotlin_module") ||
    normalized.endsWith(".version")
  ) {
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

  if (
    normalized.startsWith("base/") ||
    normalized.startsWith("feature/")
  ) {
    return "APP";
  }

  return "UNKNOWN";
}

function extensionMatches(
  name: string,
  expression: RegExp
): boolean {
  return expression.test(name);
}

// ============================================================
// SMART AAB INSPECTION
// ============================================================

export async function inspectAab(
  aabPath: string
): Promise<DoctorResult> {
  let tempScript: string | null = null;

  try {
    const normalizedAabPath =
      path.normalize(aabPath.trim());

    if (!isAabPath(normalizedAabPath)) {
      return {
        success: false,
        score: 0,
        health: "INVALID",
        report:
          "🔴 I NEED THE AAB FILE\n\nThe selected file does not end with .aab.",
      };
    }

    if (!fs.existsSync(normalizedAabPath)) {
      return {
        success: false,
        score: 0,
        health: "NOT FOUND",
        report:
          `🔴 AAB FILE NOT FOUND\n\n${normalizedAabPath}`,
      };
    }

    const fileStats =
      fs.statSync(normalizedAabPath);

    if (!fileStats.isFile()) {
      return {
        success: false,
        score: 0,
        health: "INVALID",
        report:
          "🔴 THAT PATH IS NOT AN AAB FILE",
      };
    }

    tempScript = path.join(
      projectTempDirectory(),
      `smart-aab-${Date.now()}.ps1`
    );

    const escapedPath =
      normalizedAabPath.replace(/'/g, "''");

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
      "utf8"
    );

    let stdout = "";

    try {
      const result = await execAsync(
        `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tempScript}"`,
        {
          maxBuffer: 100 * 1024 * 1024,
        }
      );

      stdout = result.stdout;
    } catch (error) {
      const e = error as {
        stderr?: string;
        stdout?: string;
        message?: string;
      };

      return {
        success: false,
        score: 0,
        health: "FAILED",
        report:
          `🔴 I COULDN'T INSPECT THE AAB\n\n${
            e.stderr ||
            e.stdout ||
            e.message ||
            String(error)
          }`,
      };
    }

    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return {
        success: false,
        score: 0,
        health: "FAILED",
        report:
          "🔴 NO AAB CONTENT WAS RETURNED",
      };
    }

    const entries: AabEntry[] = [];

    for (const line of lines) {
      const first =
        line.indexOf("|");

      if (first === -1) {
        continue;
      }

      const second =
        line.indexOf("|", first + 1);

      const name =
        line.substring(0, first);

      const sizeText =
        second === -1
          ? line.substring(first + 1)
          : line.substring(
              first + 1,
              second
            );

      const sha256 =
        second === -1
          ? ""
          : line.substring(second + 1);

      const size =
        Number(sizeText);

      if (!name) {
        continue;
      }

      entries.push({
        name,
        size:
          Number.isFinite(size)
            ? size
            : 0,
        sha256,
        entryClass:
          classifyEntry(name),
      });
    }

    const totalEntries =
      entries.length;

    const totalUncompressedSize =
      entries.reduce(
        (sum, entry) =>
          sum + entry.size,
        0
      );

    const aabSize =
      fileStats.size;

    const meaningfulEntries =
      entries.filter(
        (entry) =>
          entry.entryClass !==
            "DEBUG_METADATA" &&
          entry.entryClass !==
            "METADATA"
      );

    const debugMetadataEntries =
      entries.filter(
        (entry) =>
          entry.entryClass ===
          "DEBUG_METADATA"
      );

    const metadataEntries =
      entries.filter(
        (entry) =>
          entry.entryClass ===
          "METADATA"
      );

    const flutterAssets =
      entries.filter((entry) =>
        entry.name
          .replace(/\\/g, "/")
          .toLowerCase()
          .includes("flutter_assets/")
      );

    const images =
      meaningfulEntries.filter((entry) =>
        extensionMatches(
          entry.name,
          /\.(png|jpg|jpeg|webp|gif|bmp|heic|avif)$/i
        )
      );

    const audio =
      meaningfulEntries.filter((entry) =>
        extensionMatches(
          entry.name,
          /\.(mp3|wav|ogg|m4a|aac|flac)$/i
        )
      );

    const videos =
      meaningfulEntries.filter((entry) =>
        extensionMatches(
          entry.name,
          /\.(mp4|mov|mkv|webm|avi)$/i
        )
      );

    const fonts =
      meaningfulEntries.filter((entry) =>
        extensionMatches(
          entry.name,
          /\.(ttf|otf|woff|woff2)$/i
        )
      );

    const nativeLibraries =
      entries.filter(
        (entry) =>
          entry.entryClass ===
          "NATIVE"
      );

    const dexFiles =
      entries.filter(
        (entry) =>
          entry.entryClass ===
          "DEX"
      );

    const imageSize =
      images.reduce(
        (sum, entry) =>
          sum + entry.size,
        0
      );

    const audioSize =
      audio.reduce(
        (sum, entry) =>
          sum + entry.size,
        0
      );

    const videoSize =
      videos.reduce(
        (sum, entry) =>
          sum + entry.size,
        0
      );

    const nativeSize =
      nativeLibraries.reduce(
        (sum, entry) =>
          sum + entry.size,
        0
      );

    const meaningfulContentSize =
      meaningfulEntries.reduce(
        (sum, entry) =>
          sum + entry.size,
        0
      );

    const largestFiles =
      [...meaningfulEntries]
        .sort(
          (a, b) =>
            b.size - a.size
        )
        .slice(0, 15);

    const hashGroups =
      new Map<string, AabEntry[]>();

    for (
      const entry of meaningfulEntries
    ) {
      if (!entry.sha256) {
        continue;
      }

      const group =
        hashGroups.get(
          entry.sha256
        );

      if (group) {
        group.push(entry);
      } else {
        hashGroups.set(
          entry.sha256,
          [entry]
        );
      }
    }

    const duplicateGroups =
      Array.from(
        hashGroups.values()
      ).filter(
        (group) =>
          group.length > 1
      );

    let duplicateBytes = 0;

    for (
      const group of duplicateGroups
    ) {
      const first = group[0];

      if (!first) {
        continue;
      }

      duplicateBytes +=
        first.size *
        (group.length - 1);
    }

    const architectures =
      new Set<string>();

    for (
      const entry of nativeLibraries
    ) {
      const match =
        entry.name.match(
          /(?:^|\/)base\/lib\/([^/]+)\//
        );

      if (match?.[1]) {
        architectures.add(
          match[1]
        );
      }
    }

    const findings: Finding[] = [];

    const hasBaseManifest =
      entries.some(
        (entry) =>
          entry.name
            .replace(/\\/g, "/")
            .toLowerCase() ===
          "base/manifest/androidmanifest.xml"
      );

    if (!hasBaseManifest) {
      findings.push({
        severity: "HIGH",
        kind: "PROBLEM",
        title:
          "Base Android manifest was not detected",
        reason:
          "The expected base Android manifest was not found.",
        action:
          "Verify this is a complete release AAB and rebuild it.",
      });
    }

    if (
      dexFiles.length === 0 &&
      nativeLibraries.length === 0
    ) {
      findings.push({
        severity: "HIGH",
        kind: "PROBLEM",
        title:
          "No executable application content detected",
        reason:
          "No DEX files or native libraries were found.",
        action:
          "Build a fresh release AAB using flutter build appbundle --release.",
      });
    }

    const veryLargeImages =
      images.filter(
        (image) =>
          image.size >=
          10 * 1024 * 1024
      );

    const largeImages =
      images.filter(
        (image) =>
          image.size >=
          2 * 1024 * 1024
      );

    if (veryLargeImages.length > 0) {
      findings.push({
        severity: "MEDIUM",
        kind: "OPTIMIZATION",
        title:
          "Very large images found",
        reason:
          `${veryLargeImages.length} image(s) are 10 MB or larger.`,
        action:
          "Consider reducing resolution or compressing these images.",
      });
    } else if (largeImages.length > 0) {
      findings.push({
        severity: "LOW",
        kind: "OPTIMIZATION",
        title:
          "Large images worth reviewing",
        reason:
          `${largeImages.length} image(s) are 2 MB or larger.`,
        action:
          "Review whether these images can be resized or compressed.",
      });
    }

    const veryLargeAudio =
      audio.filter(
        (item) =>
          item.size >=
          10 * 1024 * 1024
      );

    const largeAudio =
      audio.filter(
        (item) =>
          item.size >=
          5 * 1024 * 1024
      );

    if (veryLargeAudio.length > 0) {
      findings.push({
        severity: "MEDIUM",
        kind: "OPTIMIZATION",
        title:
          "Very large audio files found",
        reason:
          `${veryLargeAudio.length} audio file(s) are 10 MB or larger.`,
        action:
          "Consider reducing bitrate or using more efficient encoding.",
      });
    } else if (largeAudio.length > 0) {
      findings.push({
        severity: "LOW",
        kind: "OPTIMIZATION",
        title:
          "Large audio files worth reviewing",
        reason:
          `${largeAudio.length} audio file(s) are 5 MB or larger.`,
        action:
          "Review bitrate and encoding.",
      });
    }

    const veryLargeVideos =
      videos.filter(
        (item) =>
          item.size >=
          50 * 1024 * 1024
      );

    const largeVideos =
      videos.filter(
        (item) =>
          item.size >=
          20 * 1024 * 1024
      );

    if (veryLargeVideos.length > 0) {
      findings.push({
        severity: "MEDIUM",
        kind: "OPTIMIZATION",
        title:
          "Very large video files found",
        reason:
          `${veryLargeVideos.length} video file(s) are 50 MB or larger.`,
        action:
          "Consider reducing video resolution, bitrate, or duration.",
      });
    } else if (largeVideos.length > 0) {
      findings.push({
        severity: "LOW",
        kind: "OPTIMIZATION",
        title:
          "Large video files worth reviewing",
        reason:
          `${largeVideos.length} video file(s) are 20 MB or larger.`,
        action:
          "Review video encoding and resolution.",
      });
    }

    if (
      duplicateGroups.length > 0 &&
      duplicateBytes >=
        10 * 1024 * 1024
    ) {
      findings.push({
        severity: "MEDIUM",
        kind: "OPTIMIZATION",
        title:
          "Significant duplicate content detected",
        reason:
          `${duplicateGroups.length} duplicate group(s) represent approximately ${formatMB(
            duplicateBytes
          )} MB of repeated content.`,
        action:
          "Check whether repeated assets are intentionally included more than once.",
      });
    } else if (
      duplicateGroups.length > 0 &&
      duplicateBytes >=
        2 * 1024 * 1024
    ) {
      findings.push({
        severity: "LOW",
        kind: "OPTIMIZATION",
        title:
          "Duplicate content detected",
        reason:
          `${duplicateGroups.length} duplicate group(s) represent approximately ${formatMB(
            duplicateBytes
          )} MB of repeated content.`,
        action:
          "Review duplicates if you want to reduce application size.",
      });
    }

    if (
      meaningfulContentSize >
      300 * 1024 * 1024
    ) {
      findings.push({
        severity: "MEDIUM",
        kind: "OPTIMIZATION",
        title:
          "Large amount of application content",
        reason:
          `Meaningful application content totals approximately ${formatMB(
            meaningfulContentSize
          )} MB uncompressed.`,
        action:
          "Review the largest assets.",
      });
    } else if (
      meaningfulContentSize >
      200 * 1024 * 1024
    ) {
      findings.push({
        severity: "LOW",
        kind: "OPTIMIZATION",
        title:
          "Application content is fairly large",
        reason:
          `Meaningful application content totals approximately ${formatMB(
            meaningfulContentSize
          )} MB uncompressed.`,
        action:
          "Review large assets if reducing size matters.",
      });
    }

    if (architectures.size >= 3) {
      findings.push({
        severity: "INFO",
        kind: "INFO",
        title:
          "Multiple Android architectures found",
        reason:
          `The bundle contains: ${Array.from(
            architectures
          ).join(", ")}.`,
        action:
          "This can be normal for Flutter applications.",
      });
    }

    if (nativeLibraries.length > 0) {
      findings.push({
        severity: "INFO",
        kind: "INFO",
        title:
          "Native Android libraries found",
        reason:
          `The AAB contains ${nativeLibraries.length} native library file(s), using approximately ${formatMB(
            nativeSize
          )} MB uncompressed.`,
        action:
          "This is normal for Flutter applications and many plugins.",
      });
    }

    if (debugMetadataEntries.length > 0) {
      findings.push({
        severity: "INFO",
        kind: "INFO",
        title:
          "Debug/build metadata ignored",
        reason:
          `${debugMetadataEntries.length} debug/build metadata file(s) detected.`,
        action:
          "These entries are excluded from release health calculations.",
      });
    }

    const problemFindings =
      findings.filter(
        (f) =>
          f.kind === "PROBLEM"
      );

    const optimizationFindings =
      findings.filter(
        (f) =>
          f.kind === "OPTIMIZATION"
      );

    const informationFindings =
      findings.filter(
        (f) =>
          f.kind === "INFO"
      );

    let score = 100;

    let high = 0;
    let medium = 0;
    let low = 0;

    for (
      const finding of problemFindings
    ) {
      if (
        finding.severity ===
        "HIGH"
      ) {
        high++;
      } else if (
        finding.severity ===
        "MEDIUM"
      ) {
        medium++;
      } else if (
        finding.severity ===
        "LOW"
      ) {
        low++;
      }
    }

    score -= high * 30;
    score -= medium * 12;
    score -= low * 4;

    score =
      Math.max(
        0,
        Math.min(100, score)
      );

    let health =
      "🟢 HEALTHY";

    if (score < 90) {
      health =
        "🟡 NEEDS REVIEW";
    }

    if (score < 70) {
      health =
        "🟠 ATTENTION NEEDED";
    }

    if (score < 40) {
      health =
        "🔴 SIGNIFICANT ISSUES";
    }

    const output: string[] = [];

    output.push(
      "🩺 APP RELEASE DOCTOR"
    );

    output.push(
      "SMART AAB INSPECTION"
    );

    output.push("");

    output.push(
      "I opened your AAB and checked its structure, application content, release risks, and optional optimizations."
    );

    output.push("");

    output.push(
      "RELEASE HEALTH"
    );

    output.push(
      "--------------"
    );

    output.push(
      `${health}  ${score}/100`
    );

    output.push("");

    output.push(
      "The score measures actual release risks detected inside the AAB."
    );

    output.push(
      "Optimization suggestions do NOT reduce the score."
    );

    output.push(
      "This is NOT a Google Play approval score."
    );

    output.push("");

    output.push("AAB");
    output.push("---");

    output.push(
      `File: ${path.basename(
        normalizedAabPath
      )}`
    );

    output.push(
      `Upload file size: ${formatMB(
        aabSize
      )} MB`
    );

    output.push(
      `Uncompressed contents: ${formatMB(
        totalUncompressedSize
      )} MB`
    );

    output.push(
      `Meaningful content: ${formatMB(
        meaningfulContentSize
      )} MB`
    );

    output.push(
      `Files inside bundle: ${totalEntries}`
    );

    output.push("");

    output.push(
      "CONTENT SUMMARY"
    );

    output.push(
      "---------------"
    );

    output.push(
      `📦 Flutter assets: ${flutterAssets.length}`
    );

    output.push(
      `🖼️ Images: ${images.length} (${formatMB(
        imageSize
      )} MB)`
    );

    output.push(
      `🔊 Audio: ${audio.length} (${formatMB(
        audioSize
      )} MB)`
    );

    output.push(
      `🎬 Videos: ${videos.length} (${formatMB(
        videoSize
      )} MB)`
    );

    output.push(
      `⚙️ Native libraries: ${nativeLibraries.length} (${formatMB(
        nativeSize
      )} MB)`
    );

    output.push(
      `🔤 Fonts: ${fonts.length}`
    );

    output.push(
      `📱 DEX files: ${dexFiles.length}`
    );

    output.push("");

    output.push(
      "ANDROID ARCHITECTURES"
    );

    output.push(
      "---------------------"
    );

    output.push(
      architectures.size > 0
        ? Array.from(
            architectures
          ).join(", ")
        : "No native architectures detected."
    );

    output.push("");

    output.push(
      "NATIVE LIBRARY FOOTPRINT"
    );

    output.push(
      "------------------------"
    );

    output.push(
      `Total native libraries: ${nativeLibraries.length}`
    );

    output.push(
      `Uncompressed native size: ${formatMB(
        nativeSize
      )} MB`
    );

    const largestNative =
      [...nativeLibraries]
        .sort(
          (a, b) =>
            b.size - a.size
        )
        .slice(0, 6);

    for (
      const native of largestNative
    ) {
      output.push(
        `• ${formatMB(
          native.size
        )} MB — ${native.name}`
      );
    }

    output.push("");

    output.push(
      "RELEASE RISKS"
    );

    output.push(
      "-------------"
    );

    output.push(
      `🔴 High: ${high}`
    );

    output.push(
      `🟠 Medium: ${medium}`
    );

    output.push(
      `🟡 Low: ${low}`
    );

    output.push("");

    if (
      problemFindings.length === 0
    ) {
      output.push(
        "🟢 No obvious release risks were detected from the AAB contents."
      );
    } else {
      let number = 1;

      for (
        const finding of problemFindings
      ) {
        output.push(
          `${number}. ${finding.title}`
        );

        output.push(
          `   Why: ${finding.reason}`
        );

        output.push(
          `   What to do: ${finding.action}`
        );

        output.push("");

        number++;
      }
    }

    output.push(
      "OPTIMIZATION SUGGESTIONS"
    );

    output.push(
      "------------------------"
    );

    output.push(
      `🟡 ${optimizationFindings.length} suggestion(s)`
    );

    output.push("");

    if (
      optimizationFindings.length === 0
    ) {
      output.push(
        "🟢 No obvious size optimization opportunities were detected."
      );
    } else {
      let number = 1;

      for (
        const finding of optimizationFindings
      ) {
        output.push(
          `${number}. ${finding.title}`
        );

        output.push(
          `   Why: ${finding.reason}`
        );

        output.push(
          `   Suggestion: ${finding.action}`
        );

        output.push("");

        number++;
      }
    }

    output.push(
      "BUILD / DEBUG METADATA"
    );

    output.push(
      "-----------------------"
    );

    output.push(
      `ℹ️ Debug metadata ignored: ${debugMetadataEntries.length}`
    );

    output.push(
      `ℹ️ Normal metadata ignored: ${metadataEntries.length}`
    );

    output.push("");

    output.push(
      "NORMAL / INFORMATIONAL"
    );

    output.push(
      "----------------------"
    );

    for (
      const finding of informationFindings
    ) {
      output.push(
        `ℹ️ ${finding.title}`
      );

      output.push(
        `   ${finding.reason}`
      );

      output.push(
        `   ${finding.action}`
      );

      output.push("");
    }

    output.push(
      "TOP 10 LARGEST MEANINGFUL FILES"
    );

    output.push(
      "-------------------------------"
    );

    for (
      let i = 0;
      i <
      Math.min(
        10,
        largestFiles.length
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
          entry.size
        )} MB — ${entry.name}`
      );
    }

    output.push("");

    output.push(
      "DUPLICATE FILE CHECK"
    );

    output.push(
      "--------------------"
    );

    if (
      duplicateGroups.length === 0
    ) {
      output.push(
        "🟢 No duplicate application content detected."
      );
    } else {
      output.push(
        `Found ${duplicateGroups.length} duplicate group(s).`
      );

      output.push(
        `Potential repeated content: ${formatMB(
          duplicateBytes
        )} MB`
      );

      output.push("");

      for (
        let i = 0;
        i <
        Math.min(
          5,
          duplicateGroups.length
        );
        i++
      ) {
        const group =
          duplicateGroups[i];

        if (!group) {
          continue;
        }

        output.push(
          `Group ${i + 1}:`
        );

        for (
          const entry of group
        ) {
          output.push(
            `  ${formatMB(
              entry.size
            )} MB — ${entry.name}`
          );
        }

        output.push("");
      }
    }

    output.push(
      "WHAT THIS MEANS"
    );

    output.push(
      "---------------"
    );

    if (problemFindings.length > 0) {
      output.push(
        "🔴 Release risks were detected. Review them before release."
      );
    } else if (
      optimizationFindings.length > 0
    ) {
      output.push(
        "🟢 No obvious release risks were detected. Remaining findings are optional optimizations."
      );
    } else {
      output.push(
        "🟢 No obvious release risks or major optimization opportunities were detected."
      );
    }

    output.push("");

    output.push(
      "SCORE EXPLANATION"
    );

    output.push(
      "-----------------"
    );

    output.push(
      "HIGH release problem: -30 points"
    );

    output.push(
      "MEDIUM release problem: -12 points"
    );

    output.push(
      "LOW release problem: -4 points"
    );

    output.push(
      "Optimization suggestion: 0 points"
    );

    output.push(
      "Informational finding: 0 points"
    );

    output.push("");

    output.push(
      `Current release problems affecting score: ${problemFindings.length}`
    );

    output.push(
      `Optimization suggestions not affecting score: ${optimizationFindings.length}`
    );

    output.push(
      `Informational findings not affecting score: ${informationFindings.length}`
    );

    output.push("");

    output.push(
      "IMPORTANT"
    );

    output.push(
      "---------"
    );

    output.push(
      "This inspection focuses on the actual contents and structure of the AAB."
    );

    output.push(
      "It does not replace Google Play's own validation."
    );

    output.push(
      "A healthy Doctor score does not guarantee Google Play approval."
    );

    output.push("");

    output.push(
      "NEXT STEP"
    );

    output.push(
      "---------"
    );

    if (problemFindings.length > 0) {
      output.push(
        "👉 Review the release risks above."
      );

      output.push(
        "👉 Build a fresh AAB after fixing them."
      );
    } else {
      output.push(
        "👉 Your AAB passed this inspection."
      );

      output.push(
        "👉 You can continue with your release process."
      );
    }

    output.push("");

    output.push(
      "🟢 SMART AAB INSPECTION COMPLETE"
    );

    return {
      success: true,
      score,
      health,
      report:
        output.join("\n").trim(),
    };
  } catch (error) {
    return {
      success: false,
      score: 0,
      health: "FAILED",
      report:
        `🔴 AAB INSPECTION FAILED\n\n${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
    };
  } finally {
    if (
      tempScript &&
      fs.existsSync(tempScript)
    ) {
      try {
        fs.unlinkSync(tempScript);
      } catch {
        // Ignore cleanup.
      }
    }
  }
}

// ============================================================
// FLUTTER PROJECT CHECK
// ============================================================

export async function checkFlutterProject(
  projectPath: string
): Promise<string> {
  const normalized =
    friendlyPath(projectPath);

  if (!fs.existsSync(normalized)) {
    return `
🔴 PROJECT NOT FOUND

I couldn't find:

${normalized}

Select the folder containing pubspec.yaml.
`.trim();
  }

  if (!isFlutterProject(normalized)) {
    return `
🔴 THIS DOESN'T LOOK LIKE A FLUTTER PROJECT

I couldn't find:

pubspec.yaml

Select the main Flutter project folder.
`.trim();
  }

  const gradle =
    getBuildGradlePath(normalized);

  if (!gradle) {
    return `
🔴 ANDROID BUILD FILE NOT FOUND

Expected:

android/app/build.gradle.kts

or:

android/app/build.gradle
`.trim();
  }

  const gradleContent =
    fs.readFileSync(
      gradle,
      "utf8"
    );

  const pubspec =
    fs.readFileSync(
      path.join(
        normalized,
        "pubspec.yaml"
      ),
      "utf8"
    );

  const compileSdk =
    extractSdkValue(
      gradleContent,
      "compileSdk"
    );

  const targetSdk =
    extractSdkValue(
      gradleContent,
      "targetSdk"
    );

  const compileInherited =
    /compileSdk\s*=?\s*flutter\.compileSdkVersion/i.test(
      gradleContent
    );

  const targetInherited =
    /targetSdk\s*=?\s*flutter\.targetSdkVersion/i.test(
      gradleContent
    );

  const applicationId =
    extractString(
      gradleContent,
      /applicationId\s*=?\s*"([^"]+)"/i
    );

  const version =
    extractString(
      pubspec,
      /^version:\s*([^\s#]+)$/m
    );

  let versionName:
    string | null = null;

  let versionCode:
    string | null = null;

  if (version) {
    const parts =
      version.split("+");

    versionName =
      parts[0] ?? null;

    versionCode =
      parts[1] ?? null;
  }

  let flutterVersion =
    "Unknown";

  try {
    const result =
      await execAsync(
        "flutter --version",
        {
          maxBuffer:
            5 * 1024 * 1024,
        }
      );

    const match =
      result.stdout.match(
        /Flutter\s+([\d.]+)/
      );

    if (match?.[1]) {
      flutterVersion =
        match[1];
    }
  } catch {
    flutterVersion =
      "Could not detect Flutter";
  }

  const compileOk =
    compileSdk !== null &&
    compileSdk >= 36;

  const targetOk =
    targetSdk !== null &&
    targetSdk >= 36;

  const signingOk =
    detectReleaseSigning(
      gradleContent
    );

  const appIdOk =
    !!applicationId;

  const versionOk =
    !!versionName;

  const versionCodeOk =
    !!versionCode &&
    /^\d+$/.test(versionCode);

  const output: string[] = [];

  output.push(
    compileOk ||
      compileInherited
      ? "🟢 FLUTTER PROJECT LOOKS HEALTHY"
      : "🟡 FLUTTER PROJECT NEEDS ATTENTION"
  );

  output.push("");

  output.push(
    "ANDROID"
  );

  output.push(
    "-------"
  );

  output.push(
    compileOk
      ? `✅ compileSdk: ${compileSdk}`
      : compileInherited
        ? "ℹ️ compileSdk: Flutter-managed"
        : `❌ compileSdk: ${
            compileSdk ??
            "not found"
          }`
  );

  output.push(
    targetOk
      ? `✅ targetSdk: ${targetSdk}`
      : targetInherited
        ? "ℹ️ targetSdk: Flutter-managed"
        : `❌ targetSdk: ${
            targetSdk ??
            "not found"
          }`
  );

  output.push(
    signingOk
      ? "✅ Release signing appears configured"
      : "❌ Release signing is not configured"
  );

  output.push("");

  output.push(
    "APP INFORMATION"
  );

  output.push(
    "---------------"
  );

  output.push(
    appIdOk
      ? `✅ Application ID: ${applicationId}`
      : "❌ Application ID not found"
  );

  output.push(
    versionName
      ? `✅ Version: ${versionName}`
      : "❌ Version not found"
  );

  output.push(
    versionCodeOk
      ? `✅ Version code: ${versionCode}`
      : "❌ Version code not found"
  );

  output.push("");

  output.push(
    "FLUTTER"
  );

  output.push(
    "-------"
  );

  output.push(
    `Flutter SDK: ${flutterVersion}`
  );

  output.push("");

  output.push(
    `Project: ${normalized}`
  );

  return output.join("\n");
}

// ============================================================
// BUILD RELEASE
// ============================================================

export async function buildRelease(
  projectPath: string
): Promise<string> {
  const normalized =
    friendlyPath(projectPath);

  if (!isFlutterProject(normalized)) {
    return `
🔴 THIS DOESN'T LOOK LIKE A FLUTTER PROJECT

pubspec.yaml was not found.

${normalized}
`.trim();
  }

  try {
    await execAsync(
      "flutter build appbundle --release",
      {
        cwd: normalized,
        maxBuffer:
          50 * 1024 * 1024,
      }
    );
  } catch (error) {
    const e = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    return `
🔴 RELEASE BUILD FAILED

${e.stderr ||
  e.stdout ||
  e.message ||
  String(error)}
`.trim();
  }

  const aabPath =
    path.join(
      normalized,
      "build",
      "app",
      "outputs",
      "bundle",
      "release",
      "app-release.aab"
    );

  if (!fs.existsSync(aabPath)) {
    return `
🔴 BUILD FINISHED, BUT AAB WAS NOT FOUND

Expected:

${aabPath}
`.trim();
  }

  const stats =
    fs.statSync(aabPath);

  return `
🟢 RELEASE BUILD SUCCESSFUL

AAB:
${path.basename(aabPath)}

SIZE:
${formatMB(stats.size)} MB

LOCATION:
${aabPath}

NEXT STEP
---------
👉 Run Smart AAB Inspection.
`.trim();
}