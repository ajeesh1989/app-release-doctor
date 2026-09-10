"use strict";

/* =========================================================
   APP RELEASE DOCTOR
   Frontend Application
   ========================================================= */

/* =========================================================
   STATE
   ========================================================= */

let selectedAabFile = null;
let selectedFlutterFiles = [];

let currentAabReport = "";
let currentProjectReport = "";
let currentReadinessReport = "";

let currentReadinessData = null;

let copiedTimer = null;

/* =========================================================
   DOM HELPERS
   ========================================================= */

const $ = (selector) => document.querySelector(selector);

const $$ = (selector) =>
  Array.from(document.querySelectorAll(selector));

/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  initializeTheme();
  initializeNavigation();
  initializeAabInspector();
  initializeFlutterProject();
  initializeReadiness();
  initializeButtons();
});

/* =========================================================
   THEME
   ========================================================= */

function initializeTheme() {
  const savedTheme = localStorage.getItem("ard-theme");

  const theme =
    savedTheme === "dark"
      ? "dark"
      : "light";

  document.documentElement.dataset.theme = theme;

  updateThemeButton(theme);

  const themeButton = $("#themeToggle");

  if (themeButton) {
    themeButton.addEventListener(
      "click",
      toggleTheme
    );
  }
}

function toggleTheme() {
  const currentTheme =
    document.documentElement.dataset.theme === "dark"
      ? "dark"
      : "light";

  const nextTheme =
    currentTheme === "dark"
      ? "light"
      : "dark";

  document.documentElement.dataset.theme = nextTheme;

  localStorage.setItem(
    "ard-theme",
    nextTheme
  );

  updateThemeButton(nextTheme);
}

function updateThemeButton(theme) {
  const button = $("#themeToggle");

  if (!button) {
    return;
  }

  /*
     Current HTML uses #themeIcon.
     Also support the older .theme-icon structure.
  */

  const icon =
    $("#themeIcon") ||
    button.querySelector(".theme-icon");

  const label =
    button.querySelector(".theme-label");

  if (theme === "dark") {
    if (icon) {
      icon.textContent = "☀";
    }

    if (label) {
      label.textContent = "Light";
    }

    button.setAttribute(
      "aria-label",
      "Switch to light theme"
    );

    button.setAttribute(
      "title",
      "Switch to light theme"
    );
  } else {
    if (icon) {
      icon.textContent = "☾";
    }

    if (label) {
      label.textContent = "Dark";
    }

    button.setAttribute(
      "aria-label",
      "Switch to dark theme"
    );

    button.setAttribute(
      "title",
      "Switch to dark theme"
    );
  }
}

/* =========================================================
   NAVIGATION
   ========================================================= */

function initializeNavigation() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const section =
        button.dataset.section;

      showSection(section);
    });
  });

  $$(".check-card[data-section]").forEach((card) => {
    card.addEventListener("click", () => {
      showSection(card.dataset.section);
    });
  });

  const heroButton =
    $("#heroInspectButton");

  if (heroButton) {
    heroButton.addEventListener(
      "click",
      () => {
        showSection("aab");
      }
    );
  }

  updatePageMeta(
    document.querySelector(".page-section.active")?.id ||
      "dashboard"
  );
}

function showSection(sectionName) {
  $$(".page-section").forEach((section) => {
    section.classList.toggle(
      "active",
      section.id === sectionName
    );
  });

  $$(".nav-item").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.section === sectionName
    );
  });

  updatePageMeta(sectionName);

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

function updatePageMeta(sectionName) {
  const title = $("#pageTitle");
  const subtitle = $("#pageSubtitle");

  const meta = {
    dashboard: {
      title: "Release Dashboard",
      subtitle:
        "Inspect your Android release before Google Play",
    },

    aab: {
      title: "AAB Inspector",
      subtitle:
        "Analyze your Android App Bundle before release",
    },

    project: {
      title: "Flutter Project",
      subtitle:
        "Check Android configuration and release readiness",
    },

    readiness: {
      title: "Play Store Readiness",
      subtitle:
        "Check whether your Flutter project is ready to upload",
    },
  };

  const current =
    meta[sectionName] || meta.dashboard;

  if (title) {
    title.textContent = current.title;
  }

  if (subtitle) {
    subtitle.textContent = current.subtitle;
  }
}

/* =========================================================
   GENERAL BUTTONS
   ========================================================= */

function initializeButtons() {
  const refreshButton =
    $("#refreshButton");

  if (refreshButton) {
    refreshButton.addEventListener(
      "click",
      () => {
        window.location.reload();
      }
    );
  }
}

/* =========================================================
   AAB INSPECTOR
   ========================================================= */

function initializeAabInspector() {
  const fileInput =
    $("#aabFile");

  const chooseButton =
    $("#chooseAabButton");

  const dropArea =
    $("#aabDropArea");

  const inspectButton =
    $("#inspectAabButton");

  if (chooseButton && fileInput) {
    chooseButton.addEventListener(
      "click",
      () => {
        fileInput.click();
      }
    );
  }

  if (fileInput) {
    fileInput.addEventListener(
      "change",
      () => {
        const file =
          fileInput.files &&
          fileInput.files[0];

        if (file) {
          setSelectedAab(file);
        }
      }
    );
  }

  if (dropArea) {
    dropArea.addEventListener(
      "dragover",
      (event) => {
        event.preventDefault();

        dropArea.classList.add(
          "dragging"
        );
      }
    );

    dropArea.addEventListener(
      "dragleave",
      () => {
        dropArea.classList.remove(
          "dragging"
        );
      }
    );

    dropArea.addEventListener(
      "drop",
      (event) => {
        event.preventDefault();

        dropArea.classList.remove(
          "dragging"
        );

        const file =
          event.dataTransfer &&
          event.dataTransfer.files &&
          event.dataTransfer.files[0];

        if (file) {
          setSelectedAab(file);
        }
      }
    );

    dropArea.addEventListener(
      "click",
      (event) => {
        if (
          event.target.closest("button")
        ) {
          return;
        }

        if (fileInput) {
          fileInput.click();
        }
      }
    );
  }

  if (inspectButton) {
    inspectButton.addEventListener(
      "click",
      inspectAab
    );
  }
}

function setSelectedAab(file) {
  if (!file) {
    return;
  }

  if (
    !file.name
      .toLowerCase()
      .endsWith(".aab")
  ) {
    showToast(
      "Please select an .aab file."
    );

    return;
  }

  selectedAabFile = file;

  const selectedFile =
    $("#selectedAab");

  if (selectedFile) {
    selectedFile.innerHTML = `
      <span class="selected-file-name">
        ${escapeHtml(file.name)}
      </span>

      <span class="selected-file-size">
        ${formatBytes(file.size)}
      </span>
    `;

    selectedFile.classList.add(
      "has-file"
    );
  }

  const inspectButton =
    $("#inspectAabButton");

  if (inspectButton) {
    inspectButton.disabled = false;
  }

  clearAabResult();
}

async function inspectAab() {
  if (!selectedAabFile) {
    showToast(
      "Please choose an AAB first."
    );

    return;
  }

  const loadingPanel =
    $("#loadingPanel");

  const resultPanel =
    $("#resultPanel");

  const inspectButton =
    $("#inspectAabButton");

  if (loadingPanel) {
    loadingPanel.classList.add(
      "active"
    );
  }

  if (resultPanel) {
    resultPanel.innerHTML = "";
  }

  if (inspectButton) {
    inspectButton.disabled = true;

    inspectButton.classList.add(
      "loading"
    );
  }

  try {
    const formData =
      new FormData();

    formData.append(
      "aab",
      selectedAabFile
    );

    const response =
      await fetch(
        "/api/inspect-aab",
        {
          method: "POST",
          body: formData,
        }
      );

    const data =
      await parseJsonResponse(
        response
      );

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
          "AAB inspection failed."
      );
    }

    currentAabReport =
      data.report || "";

    renderAabResult(data);

    showToast(
      "AAB inspection completed"
    );
  } catch (error) {
    console.error(error);

    if (resultPanel) {
      resultPanel.innerHTML =
        renderErrorCard(
          "Inspection failed",
          error.message ||
            "Could not inspect the AAB."
        );
    }

    showToast(
      "Inspection failed"
    );
  } finally {
    if (loadingPanel) {
      loadingPanel.classList.remove(
        "active"
      );
    }

    if (inspectButton) {
      inspectButton.disabled = false;

      inspectButton.classList.remove(
        "loading"
      );
    }
  }
}

/* =========================================================
   AAB RESULT
   ========================================================= */

function renderAabResult(data) {
  const resultPanel =
    $("#resultPanel");

  if (!resultPanel) {
    return;
  }

  const report =
    data.report || "";

  const score =
    normalizeScore(
      data.score,
      report
    );

  const health =
    data.health ||
    getHealthFromScore(score);

  const fileName =
    data.fileName ||
    selectedAabFile?.name ||
    "Android App Bundle";

  const sections =
    parseReportSections(report);

  const scoreClass =
    getScoreClass(score);

  resultPanel.innerHTML = `
    <div class="release-result">

      <div class="result-header">

        <div>

          <div class="eyebrow">
            INSPECTION COMPLETE
          </div>

          <h2>
            Release Health
          </h2>

          <p>
            ${escapeHtml(fileName)}
          </p>

        </div>

        <div class="health-score ${scoreClass}">

          <div class="score-number">
            ${escapeHtml(String(score))}
          </div>

          <div class="score-label">
            ${escapeHtml(health)}
          </div>

          <div class="score-caption">
            / 100
          </div>

        </div>

      </div>

      ${renderAabSummary(
        report,
        score,
        health
      )}

      <div class="result-toolbar">

        <button
          class="result-action"
          onclick="copyFullAabReport(this)"
        >
          <span>⧉</span>
          Copy report
        </button>

        <button
          class="result-action"
          onclick="downloadAabReport(this)"
        >
          <span>↓</span>
          Download
        </button>

        <button
          class="result-action"
          onclick="toggleDeveloperOutput(this)"
        >
          <span>⌘</span>
          Developer output
        </button>

        <button
          class="result-action"
          onclick="resetAabInspection()"
        >
          <span>＋</span>
          New inspection
        </button>

      </div>

      <div class="detail-sections">
        ${renderDetailSections(
          sections
        )}
      </div>

      <div
        class="developer-output"
        id="aabDeveloperOutput"
      >

        <div class="developer-output-header">

          <div>

            <strong>
              Raw inspection report
            </strong>

            <span>
              Full diagnostic output for debugging or sharing.
            </span>

          </div>

          <button
            class="mini-button"
            onclick="copyFullAabReport(this)"
          >
            Copy
          </button>

        </div>

        <pre>${escapeHtml(report)}</pre>

      </div>

    </div>
  `;
}

function renderAabSummary(
  report,
  score,
  health
) {
  const problems =
    extractProblemCount(report);

  const suggestions =
    extractSuggestionCount(report);

  const architectures =
    extractArchitectureSummary(
      report
    );

  const size =
    extractAabSize(report);

  return `
    <div class="summary-grid">

      <div class="summary-card">

        <div class="summary-card-label">
          Release score
        </div>

        <div class="summary-card-value">
          ${escapeHtml(String(score))}
          <span>/100</span>
        </div>

        <div class="summary-card-note">
          ${escapeHtml(health)}
        </div>

      </div>

      <div class="summary-card">

        <div class="summary-card-label">
          Release risks
        </div>

        <div class="summary-card-value">
          ${escapeHtml(String(problems))}
        </div>

        <div class="summary-card-note">
          Actual problems found
        </div>

      </div>

      <div class="summary-card">

        <div class="summary-card-label">
          Suggestions
        </div>

        <div class="summary-card-value">
          ${escapeHtml(String(suggestions))}
        </div>

        <div class="summary-card-note">
          Optimization opportunities
        </div>

      </div>

      <div class="summary-card">

        <div class="summary-card-label">
          Architectures
        </div>

        <div class="summary-card-value summary-small">
          ${escapeHtml(
            architectures || "Detected"
          )}
        </div>

        <div class="summary-card-note">
          Android native footprint
        </div>

      </div>

      ${
        size
          ? `
            <div class="summary-card">

              <div class="summary-card-label">
                Bundle size
              </div>

              <div class="summary-card-value summary-small">
                ${escapeHtml(size)}
              </div>

              <div class="summary-card-note">
                Uploaded AAB
              </div>

            </div>
          `
          : ""
      }

    </div>
  `;
}

/* =========================================================
   REPORT SECTION PARSER
   ========================================================= */

const KNOWN_REPORT_HEADINGS = [
  "AAB",
  "CONTENT SUMMARY",
  "ANDROID ARCHITECTURES",
  "NATIVE LIBRARY FOOTPRINT",
  "RELEASE RISKS",
  "OPTIMIZATION SUGGESTIONS",
  "BUILD / DEBUG METADATA",
  "NORMAL / INFORMATIONAL",
  "INFORMATIONAL FINDINGS",
  "TOP 10 LARGEST MEANINGFUL FILES",
  "LARGEST FILES",
  "DUPLICATE FILE CHECK",
  "DUPLICATE FILES",
  "WHAT THIS MEANS",
  "SCORE EXPLANATION",
  "IMPORTANT",
  "NEXT STEP",
];

function parseReportSections(report) {
  if (!report) {
    return [];
  }

  const lines =
    report
      .replace(/\r\n/g, "\n")
      .split("\n");

  const sections = [];

  let current = null;

  for (const rawLine of lines) {
    const line =
      rawLine.trim();

    if (!line) {
      if (current) {
        current.lines.push("");
      }

      continue;
    }

    const normalized =
      normalizeHeading(line);

    if (
      KNOWN_REPORT_HEADINGS.includes(
        normalized
      )
    ) {
      if (current) {
        sections.push(current);
      }

      current = {
        title: normalized,
        lines: [],
      };

      continue;
    }

    if (!current) {
      current = {
        title: "INSPECTION",
        lines: [],
      };
    }

    current.lines.push(line);
  }

  if (current) {
    sections.push(current);
  }

  return sections;
}

function normalizeHeading(value) {
  return value
    .replace(/^[-=*_#\s]+/, "")
    .replace(/[-=*_#\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function renderDetailSections(
  sections
) {
  if (!sections.length) {
    return `
      <div class="detail-card">

        <div class="detail-content">

          <pre>
${escapeHtml(currentAabReport)}
          </pre>

        </div>

      </div>
    `;
  }

  return sections
    .map(
      (section, index) =>
        renderDetailSection(
          section,
          index
        )
    )
    .join("");
}

function renderDetailSection(
  section,
  index
) {
  const title =
    prettyHeading(
      section.title
    );

  const content =
    section.lines
      .filter(
        (line) =>
          line.trim() !== ""
      )
      .map(
        (line) =>
          renderReportLine(line)
      )
      .join("");

  const severity =
    getSectionSeverity(
      section.title,
      section.lines.join("\n")
    );

  return `
    <details
      class="detail-card ${severity}"
      ${index < 3 ? "open" : ""}
    >

      <summary>

        <div class="detail-title-wrap">

          <span class="detail-status"></span>

          <span class="detail-title">
            ${escapeHtml(title)}
          </span>

        </div>

        <div class="detail-summary-actions">

          <span
            class="detail-copy"
            onclick="event.stopPropagation(); copySectionText(this)"
          >
            Copy
          </span>

          <span class="detail-chevron">
            ›
          </span>

        </div>

      </summary>

      <div class="detail-content">
        ${content}
      </div>

    </details>
  `;
}

function renderReportLine(line) {
  const trimmed =
    line.trim();

  if (
    trimmed.startsWith("❌") ||
    trimmed.startsWith("ERROR") ||
    trimmed.startsWith("FAIL")
  ) {
    return `
      <div class="report-line report-danger">

        <span class="report-marker">
          !
        </span>

        <span>
          ${formatInlineText(trimmed)}
        </span>

      </div>
    `;
  }

  if (
    trimmed.startsWith("⚠") ||
    trimmed.startsWith("WARNING") ||
    trimmed.startsWith("WARN")
  ) {
    return `
      <div class="report-line report-warning">

        <span class="report-marker">
          !
        </span>

        <span>
          ${formatInlineText(trimmed)}
        </span>

      </div>
    `;
  }

  if (
    trimmed.startsWith("✓") ||
    trimmed.startsWith("PASS") ||
    trimmed.startsWith("OK")
  ) {
    return `
      <div class="report-line report-success">

        <span class="report-marker">
          ✓
        </span>

        <span>
          ${formatInlineText(trimmed)}
        </span>

      </div>
    `;
  }

  if (
    trimmed.startsWith("•") ||
    trimmed.startsWith("- ")
  ) {
    return `
      <div class="report-line report-bullet">

        <span class="report-marker">
          •
        </span>

        <span>
          ${formatInlineText(
            trimmed.replace(
              /^[-•]\s*/,
              ""
            )
          )}
        </span>

      </div>
    `;
  }

  const keyValue =
    trimmed.match(
      /^([^:=]{2,60})\s*[:=]\s*(.+)$/
    );

  if (keyValue) {
    return `
      <div class="report-kv">

        <span class="report-key">
          ${escapeHtml(
            keyValue[1].trim()
          )}
        </span>

        <span class="report-value">
          ${formatInlineText(
            keyValue[2].trim()
          )}
        </span>

      </div>
    `;
  }

  return `
    <div class="report-line">
      ${formatInlineText(trimmed)}
    </div>
  `;
}

function formatInlineText(text) {
  let safe =
    escapeHtml(text);

  safe =
    safe.replace(
      /\b(healthy|ready|passed|pass|success)\b/gi,
      '<strong class="inline-success">$1</strong>'
    );

  safe =
    safe.replace(
      /\b(warning|attention|review|suggestion)\b/gi,
      '<strong class="inline-warning">$1</strong>'
    );

  safe =
    safe.replace(
      /\b(error|failed|problem|issue)\b/gi,
      '<strong class="inline-danger">$1</strong>'
    );

  return safe;
}

/* =========================================================
   REPORT EXTRACTION
   ========================================================= */

function normalizeScore(
  score,
  report
) {
  const numeric =
    Number(score);

  if (
    Number.isFinite(numeric) &&
    numeric >= 0 &&
    numeric <= 100
  ) {
    return Math.round(numeric);
  }

  const match =
    report.match(
      /(?:SCORE|HEALTH SCORE)\s*[:=]?\s*(\d{1,3})/i
    );

  if (match) {
    return Math.min(
      100,
      Math.max(
        0,
        Number(match[1])
      )
    );
  }

  return 0;
}

function getHealthFromScore(score) {
  if (score >= 90) {
    return "HEALTHY";
  }

  if (score >= 70) {
    return "NEEDS REVIEW";
  }

  if (score >= 40) {
    return "ATTENTION NEEDED";
  }

  return "SIGNIFICANT ISSUES";
}

function getScoreClass(score) {
  if (score >= 90) {
    return "score-good";
  }

  if (score >= 70) {
    return "score-review";
  }

  if (score >= 40) {
    return "score-warning";
  }

  return "score-danger";
}

function extractProblemCount(report) {
  const match =
    report.match(
      /(?:release risks?|actual problems?|problems?|issues?)\s*[:=]?\s*(\d+)/i
    );

  if (match) {
    return Number(match[1]);
  }

  const section =
    getSectionText(
      report,
      ["RELEASE RISKS"]
    );

  if (section) {
    const matches =
      section.match(
        /(?:❌|ERROR|FAIL|PROBLEM|ISSUE)/gi
      );

    return matches
      ? matches.length
      : 0;
  }

  return 0;
}

function extractSuggestionCount(report) {
  const match =
    report.match(
      /(?:suggestions?|optimization opportunities)\s*[:=]?\s*(\d+)/i
    );

  if (match) {
    return Number(match[1]);
  }

  const section =
    getSectionText(
      report,
      ["OPTIMIZATION SUGGESTIONS"]
    );

  if (section) {
    const matches =
      section.match(
        /(?:•|- |\bSUGGESTION\b)/gi
      );

    return matches
      ? matches.length
      : 0;
  }

  return 0;
}

function extractArchitectureSummary(
  report
) {
  const section =
    getSectionText(
      report,
      ["ANDROID ARCHITECTURES"]
    );

  if (!section) {
    return "";
  }

  const architectures = [];

  if (
    /\barm64-v8a\b/i.test(
      section
    )
  ) {
    architectures.push("arm64");
  }

  if (
    /\barmeabi-v7a\b/i.test(
      section
    )
  ) {
    architectures.push("armv7");
  }

  if (
    /\bx86_64\b/i.test(
      section
    )
  ) {
    architectures.push("x86_64");
  }

  if (
    /\bx86\b/i.test(section)
  ) {
    architectures.push("x86");
  }

  return architectures.join(
    " · "
  );
}

function extractAabSize(report) {
  const match =
    report.match(
      /(?:AAB SIZE|BUNDLE SIZE|FILE SIZE|SIZE)\s*[:=]\s*([0-9.]+\s*(?:KB|MB|GB|B))/i
    );

  return match
    ? match[1]
    : "";
}

function getSectionText(
  report,
  headings
) {
  const sections =
    parseReportSections(
      report
    );

  const normalized =
    headings.map(
      normalizeHeading
    );

  const found =
    sections.find(
      (section) =>
        normalized.includes(
          section.title
        )
    );

  return found
    ? found.lines.join("\n")
    : "";
}

/* =========================================================
   FLUTTER PROJECT
   ========================================================= */

function initializeFlutterProject() {
  const folderInput =
    $("#flutterProjectFolder");

  const chooseFolderButton =
    $("#chooseFlutterFolderButton");

  const uploadButton =
    $("#checkUploadedProjectButton");

  const dropArea =
    $("#flutterProjectDropArea");

  if (
    chooseFolderButton &&
    folderInput
  ) {
    chooseFolderButton.addEventListener(
      "click",
      () => {
        folderInput.click();
      }
    );
  }

  if (folderInput) {
    folderInput.addEventListener(
      "change",
      () => {
        const files =
          Array.from(
            folderInput.files || []
          );

        setFlutterProjectFiles(
          files
        );
      }
    );
  }

  if (uploadButton) {
    uploadButton.addEventListener(
      "click",
      checkUploadedFlutterProject
    );
  }

  if (dropArea) {
    initializeFlutterDropArea(
      dropArea
    );
  }

  const pathButton =
    $("#checkProjectButton");

  if (pathButton) {
    pathButton.addEventListener(
      "click",
      checkFlutterProjectPath
    );
  }

  const pathInput =
    $("#projectPath");

  if (pathInput) {
    pathInput.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Enter"
        ) {
          checkFlutterProjectPath();
        }
      }
    );
  }
}

function setFlutterProjectFiles(
  files
) {
  const validFiles =
    filterFlutterProjectFiles(
      files
    );

  selectedFlutterFiles =
    validFiles;

  const selected =
    $("#selectedFlutterProject");

  const button =
    $("#checkUploadedProjectButton");

  if (!files.length) {
    if (selected) {
      selected.textContent =
        "No project folder selected";

      selected.classList.remove(
        "has-file"
      );
    }

    if (button) {
      button.disabled = true;
    }

    return;
  }

  const hasPubspec =
    validFiles.some(
      (file) =>
        getRelativeFilePath(file)
          .split("/")
          .pop()
          .toLowerCase() ===
        "pubspec.yaml"
    );

  if (!hasPubspec) {
    if (selected) {
      selected.innerHTML = `
        <span class="upload-error">

          This does not look like a Flutter project.

          <small>
            pubspec.yaml was not found.
          </small>

        </span>
      `;

      selected.classList.add(
        "has-error"
      );
    }

    if (button) {
      button.disabled = true;
    }

    showToast(
      "pubspec.yaml was not found"
    );

    return;
  }

  const rootName =
    getProjectRootName(
      validFiles
    );

  if (selected) {
    selected.innerHTML = `
      <span class="selected-file-name">
        ${escapeHtml(rootName)}
      </span>

      <span class="selected-file-size">
        ${validFiles.length} files
      </span>
    `;

    selected.classList.remove(
      "has-error"
    );

    selected.classList.add(
      "has-file"
    );
  }

  if (button) {
    button.disabled = false;
  }

  showToast(
    `${validFiles.length} project files selected`
  );
}

function filterFlutterProjectFiles(
  files
) {
  const excluded = [
    /^\.git(?:\/|$)/i,
    /^\.dart_tool(?:\/|$)/i,
    /^build(?:\/|$)/i,
    /^android\/\.gradle(?:\/|$)/i,
    /^android\/.*build(?:\/|$)/i,
    /^android\/app\/build(?:\/|$)/i,
    /^ios\/Pods(?:\/|$)/i,
    /^ios\/\.symlinks(?:\/|$)/i,
    /^macos\/Pods(?:\/|$)/i,
    /^linux\/build(?:\/|$)/i,
    /^windows\/build(?:\/|$)/i,
    /^\.idea(?:\/|$)/i,
    /^node_modules(?:\/|$)/i,
  ];

  return files.filter(
    (file) => {
      const relative =
        getRelativeFilePath(
          file
        );

      return !excluded.some(
        (pattern) =>
          pattern.test(
            relative
          )
      );
    }
  );
}

function getRelativeFilePath(
  file
) {
  return (
    file.webkitRelativePath ||
    file.relativePath ||
    file.name ||
    ""
  )
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function getProjectRootName(
  files
) {
  if (!files.length) {
    return "Flutter project";
  }

  const first =
    getRelativeFilePath(
      files[0]
    );

  const parts =
    first.split("/");

  if (parts.length > 1) {
    return parts[0];
  }

  return "Flutter project";
}

/* =========================================================
   FLUTTER DRAG / DROP
   ========================================================= */

function initializeFlutterDropArea(
  dropArea
) {
  dropArea.addEventListener(
    "dragover",
    (event) => {
      event.preventDefault();

      dropArea.classList.add(
        "dragging"
      );
    }
  );

  dropArea.addEventListener(
    "dragleave",
    () => {
      dropArea.classList.remove(
        "dragging"
      );
    }
  );

  dropArea.addEventListener(
    "drop",
    async (event) => {
      event.preventDefault();

      dropArea.classList.remove(
        "dragging"
      );

      try {
        const items =
          Array.from(
            event.dataTransfer?.items ||
              []
          );

        const files = [];

        for (
          const item of items
        ) {
          if (
            item.kind !==
            "file"
          ) {
            continue;
          }

          const entry =
            item.webkitGetAsEntry
              ? item.webkitGetAsEntry()
              : null;

          if (entry) {
            await readEntryFiles(
              entry,
              files
            );
          } else {
            const file =
              item.getAsFile();

            if (file) {
              files.push(file);
            }
          }
        }

        setFlutterProjectFiles(
          files
        );
      } catch (error) {
        console.error(
          "Folder drop failed:",
          error
        );

        showToast(
          "Could not read the dropped folder"
        );
      }
    }
  );

  dropArea.addEventListener(
    "click",
    (event) => {
      if (
        event.target.closest(
          "button"
        )
      ) {
        return;
      }

      const input =
        $("#flutterProjectFolder");

      if (input) {
        input.click();
      }
    }
  );
}

async function readEntryFiles(
  entry,
  outputFiles
) {
  if (entry.isFile) {
    await new Promise(
      (resolve) => {
        entry.file(
          (file) => {
            try {
              const relativePath =
                buildEntryPath(
                  entry
                );

              try {
                Object.defineProperty(
                  file,
                  "webkitRelativePath",
                  {
                    value:
                      relativePath,
                    configurable:
                      true,
                  }
                );
              } catch {
                file.relativePath =
                  relativePath;
              }

              outputFiles.push(
                file
              );
            } catch {
              outputFiles.push(
                file
              );
            }

            resolve();
          },
          () => resolve()
        );
      }
    );

    return;
  }

  if (entry.isDirectory) {
    const reader =
      entry.createReader();

    await readAllDirectoryEntries(
      reader,
      async (childEntries) => {
        for (
          const child of childEntries
        ) {
          await readEntryFiles(
            child,
            outputFiles
          );
        }
      }
    );
  }
}

async function readAllDirectoryEntries(
  reader,
  callback
) {
  while (true) {
    const entries =
      await new Promise(
        (resolve) => {
          reader.readEntries(
            resolve,
            () => resolve([])
          );
        }
      );

    if (!entries.length) {
      break;
    }

    await callback(entries);
  }
}

function buildEntryPath(
  entry
) {
  const parts = [];

  let current =
    entry;

  while (current) {
    if (current.name) {
      parts.unshift(
        current.name
      );
    }

    current =
      current.parent;
  }

  return parts.join("/");
}

/* =========================================================
   CHECK UPLOADED FLUTTER PROJECT
   ========================================================= */

async function checkUploadedFlutterProject() {
  if (
    !selectedFlutterFiles.length
  ) {
    showToast(
      "Choose a Flutter folder first."
    );

    return;
  }

  const result =
    $("#projectResult");

  const button =
    $("#checkUploadedProjectButton");

  if (button) {
    button.disabled = true;

    button.classList.add(
      "loading"
    );
  }

  if (result) {
    result.innerHTML =
      renderLoadingCard(
        "Uploading project",
        "Preparing the Flutter project for inspection..."
      );
  }

  try {
    const formData =
      new FormData();

    for (
      const file of selectedFlutterFiles
    ) {
      const relativePath =
        getRelativeFilePath(
          file
        );

      formData.append(
        "projectFiles",
        file,
        relativePath
      );
    }

    const response =
      await fetch(
        "/api/check-project-upload",
        {
          method: "POST",
          body: formData,
        }
      );

    const data =
      await parseJsonResponse(
        response
      );

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
          "Flutter project check failed."
      );
    }

    currentProjectReport =
      data.report || "";

    renderProjectResult(
      data,
      "uploaded"
    );

    showToast(
      "Flutter project checked"
    );
  } catch (error) {
    console.error(error);

    if (result) {
      result.innerHTML =
        renderErrorCard(
          "Project check failed",
          error.message ||
            "Could not inspect the Flutter project."
        );
    }

    showToast(
      "Project check failed"
    );
  } finally {
    if (button) {
      button.disabled = false;

      button.classList.remove(
        "loading"
      );
    }
  }
}

/* =========================================================
   CHECK FLUTTER PROJECT BY PATH
   ========================================================= */

async function checkFlutterProjectPath() {
  const input =
    $("#projectPath");

  const result =
    $("#projectResult");

  const button =
    $("#checkProjectButton");

  const projectPath =
    input?.value.trim() ||
    "";

  if (!projectPath) {
    showToast(
      "Enter your Flutter project path."
    );

    if (input) {
      input.focus();
    }

    return;
  }

  if (button) {
    button.disabled = true;

    button.classList.add(
      "loading"
    );
  }

  if (result) {
    result.innerHTML =
      renderLoadingCard(
        "Checking Flutter project",
        "Reading Android configuration and release settings..."
      );
  }

  try {
    const response =
      await fetch(
        "/api/check-project",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            projectPath,
          }),
        }
      );

    const data =
      await parseJsonResponse(
        response
      );

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
          "Flutter project check failed."
      );
    }

    currentProjectReport =
      data.report || "";

    renderProjectResult(
      data,
      "path"
    );

    showToast(
      "Flutter project checked"
    );
  } catch (error) {
    console.error(error);

    if (result) {
      result.innerHTML =
        renderErrorCard(
          "Project check failed",
          error.message ||
            "Could not inspect the Flutter project."
        );
    }

    showToast(
      "Project check failed"
    );
  } finally {
    if (button) {
      button.disabled = false;

      button.classList.remove(
        "loading"
      );
    }
  }
}

/* =========================================================
   FLUTTER RESULT
   ========================================================= */

function renderProjectResult(
  data,
  source
) {
  const result =
    $("#projectResult");

  if (!result) {
    return;
  }

  const report =
    data.report || "";

  const status =
    detectProjectStatus(
      report
    );

  const values =
    extractProjectValues(
      report
    );

  result.innerHTML = `
    <div class="project-release-result">

      <div class="result-header project-result-header">

        <div>

          <div class="eyebrow">
            FLUTTER PROJECT CHECK
          </div>

          <h2>
            ${escapeHtml(status.title)}
          </h2>

          <p>
            ${
              source === "uploaded"
                ? "Uploaded project"
                : escapeHtml(
                    data.projectPath ||
                      $("#projectPath")?.value ||
                      ""
                  )
            }
          </p>

        </div>

        <div class="project-status-badge ${status.className}">

          <span>
            ${status.icon}
          </span>

          ${escapeHtml(status.label)}

        </div>

      </div>

      ${renderProjectChecks(
        values,
        report
      )}

      ${renderProjectExplanation(
        report,
        status
      )}

      <div class="result-toolbar">

        <button
          class="result-action"
          onclick="copyFullProjectReport(this)"
        >
          <span>⧉</span>
          Copy report
        </button>

        <button
          class="result-action"
          onclick="downloadProjectReport(this)"
        >
          <span>↓</span>
          Download
        </button>

        <button
          class="result-action"
          onclick="toggleProjectDeveloperOutput(this)"
        >
          <span>⌘</span>
          Developer output
        </button>

      </div>

      <div
        class="developer-output"
        id="projectDeveloperOutput"
      >

        <div class="developer-output-header">

          <div>

            <strong>
              Raw project report
            </strong>

            <span>
              Full diagnostic output for debugging or sharing.
            </span>

          </div>

          <button
            class="mini-button"
            onclick="copyFullProjectReport(this)"
          >
            Copy
          </button>

        </div>

        <pre>${escapeHtml(report)}</pre>

      </div>

    </div>
  `;
}

function extractProjectValues(
  report
) {
  return {
    compileSdk:
      extractValue(
        report,
        [
          "COMPILE SDK",
          "COMPILESDK",
        ]
      ),

    targetSdk:
      extractValue(
        report,
        [
          "TARGET SDK",
          "TARGETSDK",
        ]
      ),

    signing:
      extractValue(
        report,
        [
          "RELEASE SIGNING",
          "SIGNING",
        ]
      ),

    applicationId:
      extractValue(
        report,
        [
          "APPLICATION ID",
          "APP ID",
        ]
      ),

    versionName:
      extractValue(
        report,
        [
          "VERSION NAME",
          "VERSION",
        ]
      ),

    versionCode:
      extractValue(
        report,
        [
          "VERSION CODE",
        ]
      ),

    flutter:
      extractValue(
        report,
        [
          "FLUTTER SDK",
          "FLUTTER VERSION",
        ]
      ),
  };
}

function extractValue(
  report,
  labels
) {
  const lines =
    report
      .replace(/\r\n/g, "\n")
      .split("\n");

  for (
    const label of labels
  ) {
    const escaped =
      escapeRegExp(label);

    const pattern =
      new RegExp(
        `^\\s*${escaped}\\s*[:=\\-]\\s*(.+)$`,
        "i"
      );

    for (
      const line of lines
    ) {
      const match =
        line.match(
          pattern
        );

      if (match) {
        return match[1].trim();
      }
    }
  }

  for (
    const label of labels
  ) {
    const escaped =
      escapeRegExp(label);

    const match =
      report.match(
        new RegExp(
          `${escaped}\\s*[:=]\\s*([^\\n]+)`,
          "i"
        )
      );

    if (match) {
      return match[1].trim();
    }
  }

  return "";
}

function renderProjectChecks(
  values,
  report
) {
  const target =
    values.targetSdk ||
    "Not detected";

  const compile =
    values.compileSdk ||
    "Not detected";

  const signing =
    values.signing ||
    detectSigning(report);

  const appId =
    values.applicationId ||
    "Not detected";

  const version =
    values.versionName ||
    "Not detected";

  const versionCode =
    values.versionCode ||
    "Not detected";

  return `
    <div class="project-check-grid">

      ${renderProjectCheckCard(
        "Compile SDK",
        compile,
        isSdkGood(compile),
        "Android compile configuration"
      )}

      ${renderProjectCheckCard(
        "Target SDK",
        target,
        isSdkGood(target),
        "Google Play target requirement"
      )}

      ${renderProjectCheckCard(
        "Release signing",
        signing,
        isSigningGood(signing),
        "Production signing configuration"
      )}

      ${renderProjectCheckCard(
        "Application ID",
        appId,
        appId !== "Not detected",
        "Android package identifier"
      )}

      ${renderProjectCheckCard(
        "Version",
        version,
        version !== "Not detected",
        "Release version name"
      )}

      ${renderProjectCheckCard(
        "Version code",
        versionCode,
        versionCode !== "Not detected",
        "Play Store version code"
      )}

    </div>
  `;
}

function renderProjectCheckCard(
  title,
  value,
  good,
  note
) {
  return `
    <div class="project-check-card ${
      good
        ? "good"
        : "attention"
    }">

      <div class="project-check-icon">
        ${good ? "✓" : "!"}
      </div>

      <div class="project-check-content">

        <div class="project-check-title">
          ${escapeHtml(title)}
        </div>

        <div class="project-check-value">
          ${escapeHtml(value)}
        </div>

        <div class="project-check-note">
          ${escapeHtml(note)}
        </div>

      </div>

    </div>
  `;
}

function isSdkGood(value) {
  const match =
    String(value).match(
      /\d+/
    );

  if (!match) {
    return false;
  }

  /*
     Play Store readiness target:
     Android SDK 36
  */

  return (
    Number(match[0]) >= 36
  );
}

function detectSigning(report) {
  if (
    /release signing.*configured|release signing.*ready|signing.*configured/i.test(
      report
    )
  ) {
    return "Configured";
  }

  if (
    /release signing.*not configured|signing.*missing|unsigned/i.test(
      report
    )
  ) {
    return "Not configured";
  }

  return "Not detected";
}

function isSigningGood(
  value
) {
  return /configured|ready|yes|true/i.test(
    String(value)
  );
}

function detectProjectStatus(
  report
) {
  if (
    /READY FOR RELEASE|PROJECT READY|ALL CHECKS PASSED/i.test(
      report
    )
  ) {
    return {
      title:
        "Project is release-ready",

      label:
        "READY",

      className:
        "status-good",

      icon:
        "✓",
    };
  }

  if (
    /NEEDS ATTENTION|ATTENTION REQUIRED|WARN|WARNING|ISSUE|PROBLEM/i.test(
      report
    )
  ) {
    return {
      title:
        "Project needs attention",

      label:
        "NEEDS ATTENTION",

      className:
        "status-warning",

      icon:
        "!",
    };
  }

  return {
    title:
      "Project check completed",

    label:
      "CHECKED",

    className:
      "status-neutral",

    icon:
      "✓",
  };
}

function renderProjectExplanation(
  report,
  status
) {
  const explanation =
    extractNamedBlock(
      report,
      [
        "EXPLANATION",
        "WHAT THIS MEANS",
      ]
    );

  const fix =
    extractNamedBlock(
      report,
      [
        "FIX",
        "RECOMMENDATION",
      ]
    );

  const next =
    extractNamedBlock(
      report,
      [
        "NEXT STEP",
        "NEXT STEPS",
      ]
    );

  if (
    !explanation &&
    !fix &&
    !next
  ) {
    return `
      <div class="project-explanation">

        <div class="explanation-icon">
          ${escapeHtml(status.icon)}
        </div>

        <div>

          <strong>
            ${escapeHtml(status.title)}
          </strong>

          <p>
            Review the diagnostic output below for the exact Android configuration findings.
          </p>

        </div>

      </div>
    `;
  }

  return `
    <div class="project-explanation-grid">

      ${
        explanation
          ? `
            <div class="project-info-block">

              <span>
                Explanation
              </span>

              <p>
                ${formatMultiline(
                  explanation
                )}
              </p>

            </div>
          `
          : ""
      }

      ${
        fix
          ? `
            <div class="project-info-block">

              <span>
                Fix
              </span>

              <p>
                ${formatMultiline(
                  fix
                )}
              </p>

            </div>
          `
          : ""
      }

      ${
        next
          ? `
            <div class="project-info-block">

              <span>
                Next step
              </span>

              <p>
                ${formatMultiline(
                  next
                )}
              </p>

            </div>
          `
          : ""
      }

    </div>
  `;
}

function extractNamedBlock(
  report,
  names
) {
  const lines =
    report
      .replace(/\r\n/g, "\n")
      .split("\n");

  const normalizedNames =
    names.map(
      normalizeHeading
    );

  let active =
    false;

  const collected = [];

  for (
    const line of lines
  ) {
    const normalized =
      normalizeHeading(line);

    if (
      normalizedNames.includes(
        normalized
      )
    ) {
      active = true;
      continue;
    }

    if (
      active &&
      normalized &&
      KNOWN_REPORT_HEADINGS.includes(
        normalized
      )
    ) {
      break;
    }

    if (active) {
      collected.push(
        line.trim()
      );
    }
  }

  return collected
    .filter(Boolean)
    .join(" ");
}

function formatMultiline(
  value
) {
  return escapeHtml(
    value
  ).replace(
    /\n/g,
    "<br>"
  );
}

/* =========================================================
   PLAY STORE READINESS
   ========================================================= */

function initializeReadiness() {
  const runButton =
    $("#runReadinessButton");

  const currentProjectButton =
    $("#useCurrentProjectButton");

  const projectPathInput =
    $("#readinessProjectPath");

  if (runButton) {
    runButton.addEventListener(
      "click",
      runPlayStoreReadiness
    );
  }

  if (currentProjectButton) {
    currentProjectButton.addEventListener(
      "click",
      useCurrentProjectForReadiness
    );
  }

  if (projectPathInput) {
    projectPathInput.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Enter"
        ) {
          runPlayStoreReadiness();
        }
      }
    );
  }
}

function useCurrentProjectForReadiness() {
  const readinessInput =
    $("#readinessProjectPath");

  const projectInput =
    $("#projectPath");

  if (
    !readinessInput
  ) {
    return;
  }

  const currentPath =
    projectInput?.value.trim() ||
    "";

  if (!currentPath) {
    showToast(
      "Enter a project path in Flutter Project first."
    );

    return;
  }

  readinessInput.value =
    currentPath;

  showToast(
    "Current project path loaded"
  );

  runPlayStoreReadiness();
}

async function runPlayStoreReadiness() {
  const input =
    $("#readinessProjectPath");

  const result =
    $("#readinessResult");

  const empty =
    $("#readinessEmpty");

  const button =
    $("#runReadinessButton");

  const projectPath =
    input?.value.trim() ||
    "";

  if (!projectPath) {
    showToast(
      "Enter your Flutter project path."
    );

    if (input) {
      input.focus();
    }

    return;
  }

  if (button) {
    button.disabled = true;

    button.classList.add(
      "loading"
    );
  }

  if (empty) {
    empty.style.display =
      "none";
  }

  if (result) {
    result.innerHTML =
      renderReadinessLoading(
        projectPath
      );
  }

  try {
    const response =
      await fetch(
        "/api/check-play-store-readiness",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            projectPath,
          }),
        }
      );

    const data =
      await parseJsonResponse(
        response
      );

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
          "Play Store readiness check failed."
      );
    }

    currentReadinessReport =
      data.report || "";

    currentReadinessData =
      buildReadinessResult(
        data
      );

    renderReadinessResult(
      currentReadinessData
    );

    showToast(
      "Play Store readiness check completed"
    );
  } catch (error) {
    console.error(
      "Play Store readiness failed:",
      error
    );

    if (result) {
      result.innerHTML =
        renderErrorCard(
          "Readiness check failed",
          error.message ||
            "Could not check Play Store readiness."
        );
    }

    showToast(
      "Readiness check failed"
    );
  } finally {
    if (button) {
      button.disabled = false;

      button.classList.remove(
        "loading"
      );
    }
  }
}

function buildReadinessResult(
  data
) {
  const report =
    data.report || "";

  const values =
    extractReadinessValues(
      report
    );

  const checks = [
    createReadinessCheck(
      "Target SDK",
      values.targetSdk,
      isTargetSdkReady(
        values.targetSdk
      ),
      "Google Play target SDK requirement",
      "target"
    ),

    createReadinessCheck(
      "Compile SDK",
      values.compileSdk,
      isCompileSdkReady(
        values.compileSdk
      ),
      "Android build configuration",
      "compile"
    ),

    createReadinessCheck(
      "Release signing",
      values.signing,
      isSigningGood(
        values.signing
      ),
      "Production release signing configuration",
      "signing"
    ),

    createReadinessCheck(
      "Application ID",
      values.applicationId,
      isPresentValue(
        values.applicationId
      ),
      "Android package identifier",
      "application"
    ),

    createReadinessCheck(
      "Version name",
      values.versionName,
      isPresentValue(
        values.versionName
      ),
      "Release version name",
      "version"
    ),

    createReadinessCheck(
      "Version code",
      values.versionCode,
      isValidVersionCode(
        values.versionCode
      ),
      "Play Store release version code",
      "version-code"
    ),
  ];

  const blockers =
    checks.filter(
      (check) =>
        check.status ===
        "blocker"
    ).length;

  /*
     A readiness warning is a real concern
     but not necessarily a hard blocker.

     Suggestions and informational findings
     do not reduce the readiness score.
  */

  const warnings =
    countReadinessWarnings(
      report,
      checks
    );

  const suggestions =
    countReadinessSuggestions(
      report
    );

  const score =
    calculateReadinessScore(
      blockers,
      warnings
    );

  const status =
    getReadinessStatus(
      blockers,
      warnings,
      score
    );

  return {
    report,
    projectPath:
      data.projectPath ||
      $("#readinessProjectPath")?.value ||
      "",

    checks,

    blockers,
    warnings,
    suggestions,

    score,

    status,
  };
}

function extractReadinessValues(
  report
) {
  const projectValues =
    extractProjectValues(
      report
    );

  return {
    compileSdk:
      projectValues.compileSdk ||
      extractReadinessValue(
        report,
        [
          "COMPILE SDK",
          "COMPILE SDK VERSION",
          "COMPILESDK",
        ]
      ),

    targetSdk:
      projectValues.targetSdk ||
      extractReadinessValue(
        report,
        [
          "TARGET SDK",
          "TARGET SDK VERSION",
          "TARGETSDK",
        ]
      ),

    signing:
      projectValues.signing ||
      detectSigning(report),

    applicationId:
      projectValues.applicationId ||
      extractReadinessValue(
        report,
        [
          "APPLICATION ID",
          "APPLICATIONID",
          "APP ID",
          "PACKAGE NAME",
          "PACKAGE",
        ]
      ),

    versionName:
      projectValues.versionName ||
      extractReadinessVersionName(
        report
      ),

    versionCode:
      projectValues.versionCode ||
      extractReadinessValue(
        report,
        [
          "VERSION CODE",
          "VERSIONCODE",
          "BUILD NUMBER",
          "BUILD",
        ]
      ),
  };
}

function extractReadinessValue(
  report,
  labels
) {
  const lines =
    report
      .replace(/\r\n/g, "\n")
      .split("\n");

  for (
    const line of lines
  ) {
    const trimmed =
      line.trim();

    for (
      const label of labels
    ) {
      const escaped =
        escapeRegExp(label);

      const match =
        trimmed.match(
          new RegExp(
            `^${escaped}\\s*[:=\\-]\\s*(.+)$`,
            "i"
          )
        );

      if (match) {
        return match[1].trim();
      }

      const inline =
        trimmed.match(
          new RegExp(
            `${escaped}\\s*[:=]\\s*(.+)$`,
            "i"
          )
        );

      if (inline) {
        return inline[1].trim();
      }
    }
  }

  return "";
}

function extractReadinessVersionName(
  report
) {
  const explicit =
    extractReadinessValue(
      report,
      [
        "VERSION NAME",
      ]
    );

  if (explicit) {
    return explicit;
  }

  const lines =
    report
      .replace(/\r\n/g, "\n")
      .split("\n");

  for (
    const line of lines
  ) {
    const match =
      line.match(
        /^\s*VERSION\s*[:=]\s*([^\n]+)/i
      );

    if (match) {
      return match[1].trim();
    }
  }

  return "";
}

function createReadinessCheck(
  title,
  value,
  passed,
  note,
  key
) {
  return {
    title,
    value:
      value ||
      "Not detected",

    passed,

    status:
      passed
        ? "good"
        : "blocker",

    note,

    key,
  };
}

function isTargetSdkReady(
  value
) {
  const match =
    String(value).match(
      /\d+/
    );

  if (!match) {
    return false;
  }

  return (
    Number(match[0]) >= 36
  );
}

function isCompileSdkReady(
  value
) {
  const match =
    String(value).match(
      /\d+/
    );

  if (!match) {
    return false;
  }

  return (
    Number(match[0]) >= 36
  );
}

function isPresentValue(
  value
) {
  if (!value) {
    return false;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  return (
    normalized !== "" &&
    normalized !==
      "not detected" &&
    normalized !==
      "unknown" &&
    normalized !==
      "missing" &&
    normalized !==
      "not configured"
  );
}

function isValidVersionCode(
  value
) {
  if (!isPresentValue(value)) {
    return false;
  }

  const match =
    String(value).match(
      /\d+/
    );

  if (!match) {
    return false;
  }

  return (
    Number(match[0]) > 0
  );
}

function calculateReadinessScore(
  blockers,
  warnings
) {
  /*
     Starting score = 100

     Actual blockers = -20 each
     Warnings        = -8 each

     Suggestions do not reduce
     the readiness score.
  */

  const score =
    100 -
    blockers * 20 -
    warnings * 8;

  return Math.max(
    0,
    Math.min(
      100,
      score
    )
  );
}

function getReadinessStatus(
  blockers,
  warnings,
  score
) {
  if (blockers > 0) {
    return {
      label:
        "NOT READY",

      className:
        "blocked",

      icon:
        "!",
    };
  }

  if (
    warnings > 0 ||
    score < 90
  ) {
    return {
      label:
        "READY WITH REVIEW",

      className:
        "review",

      icon:
        "!",
    };
  }

  return {
    label:
      "READY FOR RELEASE",

    className:
      "ready",

    icon:
      "✓",
  };
}

function countReadinessWarnings(
  report,
  checks
) {
  /*
     A failed readiness check is already
     counted as a blocker, so do not count
     it again as a warning.

     Warnings are extracted only from
     warning/attention diagnostics.
  */

  let count = 0;

  const warningSection =
    getSectionText(
      report,
      [
        "RELEASE RISKS",
        "WHAT THIS MEANS",
      ]
    );

  if (warningSection) {
    const matches =
      warningSection.match(
        /(?:⚠|WARNING|WARN|ATTENTION)/gi
      );

    if (matches) {
      count += matches.length;
    }
  }

  const globalWarnings =
    report.match(
      /(?:^|\n)\s*(?:⚠|WARNING|WARN)\b/gi
    );

  if (globalWarnings) {
    count += globalWarnings.length;
  }

  /*
     Avoid double-counting the same warning
     text in very small reports.
  */

  return Math.min(
    10,
    Math.max(
      0,
      count
    )
  );
}

function countReadinessSuggestions(
  report
) {
  const section =
    getSectionText(
      report,
      [
        "OPTIMIZATION SUGGESTIONS",
      ]
    );

  if (!section) {
    return 0;
  }

  const matches =
    section.match(
      /(?:•|- |\bSUGGESTION\b)/gi
    );

  return matches
    ? matches.length
    : 0;
}

function renderReadinessLoading(
  projectPath
) {
  return `
    <div class="readiness-loading">

      <div class="loader"></div>

      <div>

        <strong>
          Checking Play Store readiness
        </strong>

        <span>
          Reviewing SDK versions, signing and release configuration...
        </span>

        <small>
          ${escapeHtml(projectPath)}
        </small>

      </div>

    </div>
  `;
}

function renderReadinessResult(
  data
) {
  const result =
    $("#readinessResult");

  const empty =
    $("#readinessEmpty");

  if (!result) {
    return;
  }

  if (empty) {
    empty.style.display =
      "none";
  }

  const status =
    data.status;

  const scoreClass =
    getReadinessScoreClass(
      data.score
    );

  const projectPath =
    data.projectPath ||
    "Flutter project";

  result.innerHTML = `
    <div class="readiness-release-result">

      <div class="readiness-result-header">

        <div class="readiness-result-heading">

          <div class="eyebrow">
            READINESS CHECK COMPLETE
          </div>

          <h2>
            Play Store Readiness
          </h2>

          <p class="readiness-project-path">
            ${escapeHtml(projectPath)}
          </p>

        </div>

        <div class="readiness-score ${scoreClass}">

          <div class="readiness-score-number">
            ${escapeHtml(
              String(data.score)
            )}
          </div>

          <div class="readiness-score-copy">

            <span class="readiness-status ${status.className}">
              ${escapeHtml(
                status.label
              )}
            </span>

            <span class="readiness-score-caption">
              / 100
            </span>

          </div>

        </div>

      </div>

      <div class="readiness-question">

        <div class="readiness-question-icon">
          ${status.icon}
        </div>

        <div>

          <strong>
            Can I safely upload this release?
          </strong>

          <p>
            ${
              data.blockers > 0
                ? "Not yet. Resolve the release blockers before uploading this project."
                : data.warnings > 0
                ? "The project passes the core checks, but review the warnings before uploading."
                : "The core release checks passed. The project is ready for the next release step."
            }
          </p>

        </div>

      </div>

      <div class="readiness-check-grid">

        ${data.checks
          .map(
            (check) =>
              renderReadinessCheck(
                check
              )
          )
          .join("")}

      </div>

      <div class="readiness-counts">

        ${renderReadinessCount(
          data.blockers,
          "Blockers",
          "blocker",
          "!"
        )}

        ${renderReadinessCount(
          data.warnings,
          "Warnings",
          "warning",
          "!"
        )}

        ${renderReadinessCount(
          data.suggestions,
          "Suggestions",
          "suggestion",
          "•"
        )}

      </div>

      ${renderReadinessExplanation(
        data
      )}

      <div class="readiness-toolbar">

        <button
          class="result-action"
          onclick="copyFullReadinessReport(this)"
        >
          <span>⧉</span>
          Copy report
        </button>

        <button
          class="result-action"
          onclick="downloadReadinessReport(this)"
        >
          <span>↓</span>
          Download
        </button>

        <button
          class="result-action"
          onclick="resetReadiness()"
        >
          <span>＋</span>
          New check
        </button>

      </div>

      <div class="developer-output" id="readinessDeveloperOutput">

        <div class="developer-output-header">

          <div>

            <strong>
              Raw readiness report
            </strong>

            <span>
              Full diagnostic output for debugging or sharing.
            </span>

          </div>

          <button
            class="mini-button"
            onclick="copyFullReadinessReport(this)"
          >
            Copy
          </button>

        </div>

        <pre>
${escapeHtml(data.report)}
        </pre>

      </div>

      <div class="readiness-disclaimer">

        <span>ⓘ</span>

        <span>
          App Release Doctor checks your local project configuration
          against the release checks implemented by this tool.
          Passing these checks does not guarantee Google Play approval.
        </span>

      </div>

    </div>
  `;
}

function renderReadinessCheck(
  check
) {
  const statusClass =
    check.passed
      ? "good"
      : "blocker";

  return `
    <div class="readiness-check ${statusClass}">

      <div class="readiness-check-icon">

        ${
          check.passed
            ? "✓"
            : "!"
        }

      </div>

      <div class="readiness-check-body">

        <div class="readiness-check-title">
          ${escapeHtml(
            check.title
          )}
        </div>

        <div class="readiness-check-value">
          ${escapeHtml(
            check.value
          )}
        </div>

        <div class="readiness-check-note">
          ${escapeHtml(
            check.note
          )}
        </div>

      </div>

    </div>
  `;
}

function renderReadinessCount(
  number,
  label,
  className,
  icon
) {
  return `
    <div class="readiness-count ${className}">

      <div class="readiness-count-icon">
        ${icon}
      </div>

      <div class="readiness-count-copy">

        <div class="readiness-count-number">
          ${escapeHtml(
            String(number)
          )}
        </div>

        <div class="readiness-count-label">
          ${escapeHtml(label)}
        </div>

      </div>

    </div>
  `;
}

function renderReadinessExplanation(
  data
) {
  let title =
    "Release assessment";

  let message =
    "The core release configuration checks have been evaluated.";

  if (data.blockers > 0) {
    title =
      "Action required";

    message =
      "One or more release requirements are not satisfied. Fix the blockers before creating or uploading the release.";
  } else if (data.warnings > 0) {
    title =
      "Review before release";

    message =
      "The core requirements pass, but the diagnostic report contains warnings that should be reviewed before release.";
  } else {
    title =
      "Core checks passed";

    message =
      "Target SDK, compile SDK, signing and release identity checks are satisfied by the information detected in the project.";
  }

  return `
    <div class="readiness-explanation">

      <div class="readiness-explanation-title">
        ${escapeHtml(title)}
      </div>

      <p>
        ${escapeHtml(message)}
      </p>

    </div>
  `;
}

function getReadinessScoreClass(
  score
) {
  if (score >= 90) {
    return "score-good";
  }

  if (score >= 70) {
    return "score-review";
  }

  if (score >= 40) {
    return "score-warning";
  }

  return "score-danger";
}

/* =========================================================
   READINESS COPY / DOWNLOAD / RESET
   ========================================================= */

async function copyFullReadinessReport(
  button
) {
  if (!currentReadinessReport) {
    showToast(
      "No readiness report available."
    );

    return;
  }

  const data =
    currentReadinessData;

  const report =
    buildReadableReadinessReport(
      data
    );

  await copyText(
    report,
    button,
    "Readiness report copied"
  );
}

function buildReadableReadinessReport(
  data
) {
  if (!data) {
    return currentReadinessReport || "";
  }

  const lines = [];

  lines.push(
    "APP RELEASE DOCTOR"
  );

  lines.push(
    "PLAY STORE READINESS"
  );

  lines.push(
    ""
  );

  lines.push(
    `Score: ${data.score}/100`
  );

  lines.push(
    `Status: ${data.status.label}`
  );

  lines.push(
    ""
  );

  lines.push(
    `Blockers: ${data.blockers}`
  );

  lines.push(
    `Warnings: ${data.warnings}`
  );

  lines.push(
    `Suggestions: ${data.suggestions}`
  );

  lines.push(
    ""
  );

  lines.push(
    "RELEASE CHECKS"
  );

  for (
    const check of data.checks
  ) {
    lines.push(
      `${check.passed ? "✓" : "!"} ${check.title}: ${check.value}`
    );
  }

  lines.push(
    ""
  );

  lines.push(
    "PROJECT"
  );

  lines.push(
    data.projectPath ||
      "Not specified"
  );

  lines.push(
    ""
  );

  lines.push(
    "IMPORTANT"
  );

  lines.push(
    "Passing these checks does not guarantee Google Play approval."
  );

  lines.push(
    ""
  );

  lines.push(
    "RAW DIAGNOSTIC REPORT"
  );

  lines.push(
    data.report || ""
  );

  return lines.join("\n");
}

function downloadReadinessReport(
  button
) {
  if (!currentReadinessReport) {
    showToast(
      "No readiness report available."
    );

    return;
  }

  const report =
    buildReadableReadinessReport(
      currentReadinessData
    );

  downloadTextFile(
    "play-store-readiness-report.txt",
    report,
    button
  );
}

function resetReadiness() {
  currentReadinessReport =
    "";

  currentReadinessData =
    null;

  const result =
    $("#readinessResult");

  const empty =
    $("#readinessEmpty");

  if (result) {
    result.innerHTML = "";
  }

  if (empty) {
    empty.style.display =
      "";
  }

  const input =
    $("#readinessProjectPath");

  if (input) {
    input.value = "";
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

/* =========================================================
   COPY
   ========================================================= */

async function copyText(
  text,
  sourceElement = null,
  successMessage = "Copied"
) {
  try {
    if (
      navigator.clipboard &&
      window.isSecureContext
    ) {
      await navigator.clipboard.writeText(
        text
      );
    } else {
      const textarea =
        document.createElement(
          "textarea"
        );

      textarea.value =
        text;

      textarea.style.position =
        "fixed";

      textarea.style.left =
        "-9999px";

      textarea.style.top =
        "-9999px";

      textarea.style.opacity =
        "0";

      document.body.appendChild(
        textarea
      );

      textarea.focus();

      textarea.select();

      const copied =
        document.execCommand(
          "copy"
        );

      textarea.remove();

      if (!copied) {
        throw new Error(
          "Copy command failed."
        );
      }
    }

    if (sourceElement) {
      setCopiedState(
        sourceElement
      );
    }

    showToast(
      successMessage
    );
  } catch (error) {
    console.error(
      "Copy failed:",
      error
    );

    showToast(
      "Copy failed"
    );
  }
}

function setCopiedState(
  element
) {
  if (!element) {
    return;
  }

  const original =
    element.dataset.originalText ||
    element.textContent;

  element.dataset.originalText =
    original;

  element.textContent =
    "Copied ✓";

  element.classList.add(
    "is-success"
  );

  clearTimeout(
    copiedTimer
  );

  copiedTimer =
    setTimeout(() => {
      element.textContent =
        original;

      element.classList.remove(
        "is-success"
      );
    }, 1800);
}

async function copyFullAabReport(
  button
) {
  if (!currentAabReport) {
    showToast(
      "No AAB report available."
    );

    return;
  }

  await copyText(
    currentAabReport,
    button,
    "AAB report copied"
  );
}

async function copyFullProjectReport(
  button
) {
  if (!currentProjectReport) {
    showToast(
      "No project report available."
    );

    return;
  }

  await copyText(
    currentProjectReport,
    button,
    "Project report copied"
  );
}

async function copySectionText(
  element
) {
  const card =
    element.closest(
      ".detail-card"
    );

  if (!card) {
    return;
  }

  const content =
    card.querySelector(
      ".detail-content"
    );

  if (!content) {
    return;
  }

  const title =
    card.querySelector(
      ".detail-title"
    )?.textContent.trim() ||
    "Section";

  const text =
    content.innerText.trim();

  await copyText(
    `${title}\n\n${text}`,
    element,
    "Section copied"
  );
}

/* =========================================================
   DOWNLOAD
   ========================================================= */

function downloadTextFile(
  filename,
  text,
  sourceElement = null
) {
  try {
    if (
      !text ||
      !String(text).trim()
    ) {
      showToast(
        "Nothing to download."
      );

      return;
    }

    const blob =
      new Blob(
        [text],
        {
          type:
            "text/plain;charset=utf-8",
        }
      );

    const url =
      URL.createObjectURL(
        blob
      );

    const anchor =
      document.createElement(
        "a"
      );

    anchor.href =
      url;

    anchor.download =
      filename;

    anchor.style.display =
      "none";

    document.body.appendChild(
      anchor
    );

    anchor.click();

    anchor.remove();

    setTimeout(() => {
      URL.revokeObjectURL(
        url
      );
    }, 1500);

    if (sourceElement) {
      setDownloadedState(
        sourceElement
      );
    }

    showToast(
      "Report downloaded"
    );
  } catch (error) {
    console.error(
      "Download failed:",
      error
    );

    showToast(
      "Download failed"
    );
  }
}

function setDownloadedState(
  element
) {
  if (!element) {
    return;
  }

  const original =
    element.dataset.originalText ||
    element.textContent;

  element.dataset.originalText =
    original;

  element.textContent =
    "Downloaded ✓";

  element.classList.add(
    "is-success"
  );

  setTimeout(() => {
    element.textContent =
      original;

    element.classList.remove(
      "is-success"
    );
  }, 1800);
}

function downloadAabReport(
  button
) {
  if (!currentAabReport) {
    showToast(
      "No AAB report available."
    );

    return;
  }

  const baseName =
    (
      selectedAabFile?.name ||
      "app-release"
    )
      .replace(
        /\.aab$/i,
        ""
      )
      .replace(
        /[^a-z0-9_-]+/gi,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      );

  downloadTextFile(
    `${baseName || "app-release"}-report.txt`,
    currentAabReport,
    button
  );
}

function downloadProjectReport(
  button
) {
  if (!currentProjectReport) {
    showToast(
      "No project report available."
    );

    return;
  }

  downloadTextFile(
    "flutter-project-release-report.txt",
    currentProjectReport,
    button
  );
}

/* =========================================================
   DEVELOPER OUTPUT
   ========================================================= */

function toggleDeveloperOutput(
  button
) {
  const output =
    $("#aabDeveloperOutput");

  if (!output) {
    return;
  }

  const isOpen =
    output.classList.toggle(
      "active"
    );

  if (button) {
    button.classList.toggle(
      "is-active",
      isOpen
    );
  }
}

function toggleProjectDeveloperOutput(
  button
) {
  const output =
    $("#projectDeveloperOutput");

  if (!output) {
    return;
  }

  const isOpen =
    output.classList.toggle(
      "active"
    );

  if (button) {
    button.classList.toggle(
      "is-active",
      isOpen
    );
  }
}

/* =========================================================
   RESET AAB
   ========================================================= */

function resetAabInspection() {
  selectedAabFile =
    null;

  currentAabReport =
    "";

  const input =
    $("#aabFile");

  const selected =
    $("#selectedAab");

  const button =
    $("#inspectAabButton");

  if (input) {
    input.value = "";
  }

  if (selected) {
    selected.textContent =
      "No file selected";

    selected.classList.remove(
      "has-file"
    );
  }

  if (button) {
    button.disabled = true;
  }

  clearAabResult();

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

function clearAabResult() {
  const result =
    $("#resultPanel");

  if (result) {
    result.innerHTML = "";
  }
}

/* =========================================================
   LOADING / ERROR
   ========================================================= */

function renderLoadingCard(
  title,
  message
) {
  return `
    <div class="loading-card">

      <div class="loader"></div>

      <div>

        <strong>
          ${escapeHtml(title)}
        </strong>

        <span>
          ${escapeHtml(message)}
        </span>

      </div>

    </div>
  `;
}

function renderErrorCard(
  title,
  message
) {
  return `
    <div class="error-card">

      <div class="error-card-icon">
        !
      </div>

      <div>

        <strong>
          ${escapeHtml(title)}
        </strong>

        <p>
          ${escapeHtml(message)}
        </p>

      </div>

    </div>
  `;
}

/* =========================================================
   TOAST
   ========================================================= */

function showToast(
  message
) {
  let toast =
    $("#ardToast");

  if (!toast) {
    toast =
      document.createElement(
        "div"
      );

    toast.id =
      "ardToast";

    toast.className =
      "toast";

    document.body.appendChild(
      toast
    );
  }

  toast.textContent =
    message;

  toast.classList.add(
    "visible"
  );

  clearTimeout(
    toast._hideTimer
  );

  toast._hideTimer =
    setTimeout(() => {
      toast.classList.remove(
        "visible"
      );
    }, 2200);
}

/* =========================================================
   HTTP HELPERS
   ========================================================= */

async function parseJsonResponse(
  response
) {
  const text =
    await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(
      text
    );
  } catch {
    throw new Error(
      `Server returned an invalid response (${response.status}).`
    );
  }
}

/* =========================================================
   TEXT / FORMATTING HELPERS
   ========================================================= */

function prettyHeading(
  value
) {
  const map = {
    AAB:
      "AAB",

    "CONTENT SUMMARY":
      "Content Summary",

    "ANDROID ARCHITECTURES":
      "Android Architectures",

    "NATIVE LIBRARY FOOTPRINT":
      "Native Library Footprint",

    "RELEASE RISKS":
      "Release Risks",

    "OPTIMIZATION SUGGESTIONS":
      "Optimization Suggestions",

    "BUILD / DEBUG METADATA":
      "Build / Debug Metadata",

    "NORMAL / INFORMATIONAL":
      "Informational Findings",

    "INFORMATIONAL FINDINGS":
      "Informational Findings",

    "TOP 10 LARGEST MEANINGFUL FILES":
      "Largest Meaningful Files",

    "LARGEST FILES":
      "Largest Files",

    "DUPLICATE FILE CHECK":
      "Duplicate File Check",

    "DUPLICATE FILES":
      "Duplicate Files",

    "WHAT THIS MEANS":
      "What This Means",

    "SCORE EXPLANATION":
      "Score Explanation",

    IMPORTANT:
      "Important",

    "NEXT STEP":
      "Next Step",

    INSPECTION:
      "Inspection",
  };

  return (
    map[value] ||
    value
      .toLowerCase()
      .replace(
        /\b\w/g,
        (char) =>
          char.toUpperCase()
      )
  );
}

function getSectionSeverity(
  title,
  text
) {
  const upper =
    `${title}\n${text}`.toUpperCase();

  if (
    title ===
      "RELEASE RISKS" &&
    /❌|ERROR|FAIL|PROBLEM|ISSUE/.test(
      upper
    )
  ) {
    return "has-danger";
  }

  if (
    /❌|ERROR|FAIL/.test(
      upper
    )
  ) {
    return "has-danger";
  }

  if (
    /⚠|WARNING|WARN|ATTENTION/.test(
      upper
    )
  ) {
    return "has-warning";
  }

  if (
    /✓|PASS|READY|HEALTHY|SUCCESS/.test(
      upper
    )
  ) {
    return "has-success";
  }

  return "";
}

function escapeHtml(
  value
) {
  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}

function escapeRegExp(
  value
) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function formatBytes(
  bytes
) {
  if (
    !Number.isFinite(bytes) ||
    bytes <= 0
  ) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  const index =
    Math.floor(
      Math.log(bytes) /
        Math.log(1024)
    );

  const safeIndex =
    Math.min(
      index,
      units.length - 1
    );

  const value =
    bytes /
    Math.pow(
      1024,
      safeIndex
    );

  return `${value.toFixed(
    safeIndex === 0
      ? 0
      : value >= 100
      ? 0
      : value >= 10
      ? 1
      : 2
  )} ${units[safeIndex]}`;
}

/* =========================================================
   GLOBAL EXPORTS
   Required by inline onclick handlers
   ========================================================= */

window.copyFullAabReport =
  copyFullAabReport;

window.copyFullProjectReport =
  copyFullProjectReport;

window.copySectionText =
  copySectionText;

window.copyFullReadinessReport =
  copyFullReadinessReport;

window.downloadAabReport =
  downloadAabReport;

window.downloadProjectReport =
  downloadProjectReport;

window.downloadReadinessReport =
  downloadReadinessReport;

window.toggleDeveloperOutput =
  toggleDeveloperOutput;

window.toggleProjectDeveloperOutput =
  toggleProjectDeveloperOutput;

window.resetAabInspection =
  resetAabInspection;

window.resetReadiness =
  resetReadiness;