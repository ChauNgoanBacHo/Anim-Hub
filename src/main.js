import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  screen,
  shell,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import started from "electron-squirrel-startup";
import { registerGoogleWorkspaceHandlers } from "./googleWorkspace.js";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const SPINE_ASSET_SCHEME = "spine-asset";
const assetToken = crypto.randomBytes(24).toString("hex");
let assetServer;
let assetBaseUrl;
async function startAssetServer() {
  assetServer = http.createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (!url.pathname.startsWith(`/${assetToken}/`)) { response.writeHead(403).end(); return; }
      let filePath = decodeURIComponent(url.pathname.slice(assetToken.length + 1));
      if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1);
      if (![".json", ".atlas", ".txt", ".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(filePath).toLowerCase())) { response.writeHead(403).end(); return; }
      const bytes = await fs.promises.readFile(filePath);
      response.writeHead(200, { "Content-Type": contentTypeFor(filePath), "Cache-Control": "no-store" });
      response.end(bytes);
    } catch (error) { response.writeHead(404).end("Asset not found"); }
  });
  await new Promise((resolve, reject) => { assetServer.once("error", reject); assetServer.listen(0, "127.0.0.1", resolve); });
  assetBaseUrl = `http://127.0.0.1:${assetServer.address().port}/${assetToken}`;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".atlas" || ext === ".txt") return "text/plain; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".m4a") return "audio/mp4";
  return "application/octet-stream";
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SPINE_ASSET_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
      stream: true,
    },
  },
]);

const createWindow = () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } =
    primaryDisplay.workAreaSize;
  const mainWindow = new BrowserWindow({
    width: screenWidth,
    height: screenHeight,
    minWidth: 900,
    minHeight: 680,
    center: true,
    backgroundColor: "#0e141a",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

function walkJsonFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files;
}

function walkAtlasFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkAtlasFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".atlas")) {
      files.push(fullPath);
    }
  }

  return files;
}


function scanLocalCatalog(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    throw new Error("Folder local không hợp lệ.");
  }
  const roots = directoryEntries(rootPath).filter((entry) => entry.isDirectory());
  const animation = roots.find((entry) => /_Animation$/i.test(entry.name));
  const ui = roots.find((entry) => /_UI_EN$/i.test(entry.name));
  if (!animation && !ui) throw new Error("Không tìm thấy folder *_Animation hoặc *_UI_EN trong folder đã chọn.");
  const tabs = [];
  if (animation) {
    const animationPath = path.join(rootPath, animation.name);
    for (const category of directoryEntries(animationPath).filter((entry) => entry.isDirectory() && !/_Cocos$/i.test(entry.name))) {
      const categoryPath = path.join(animationPath, category.name);
      const items = directoryEntries(categoryPath)
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({ name: entry.name, kind: "spine", group: "", localPath: path.join(categoryPath, entry.name) }));
      tabs.push({ title: stripProjectPrefix(category.name), source: "animation", sourceName: category.name, items });
    }
  }
  if (ui) {
    const uiPath = path.join(rootPath, ui.name);
    for (const category of directoryEntries(uiPath).filter((entry) => entry.isDirectory())) {
      const categoryPath = path.join(uiPath, category.name);
      const children = directoryEntries(categoryPath);
      const items = children.filter(isCatalogImage).map((entry) => ({ name: entry.name, kind: "image", group: "", localPath: path.join(categoryPath, entry.name) }));
      for (const group of children.filter((entry) => entry.isDirectory())) {
        const groupPath = path.join(categoryPath, group.name);
        items.push(...directoryEntries(groupPath).filter(isCatalogImage).map((entry) => ({ name: entry.name, kind: "image", group: group.name, localPath: path.join(groupPath, entry.name) })));
      }
      tabs.push({ title: stripProjectPrefix(category.name), source: "ui", sourceName: category.name, items });
    }
  }
  const rootName = animation?.name.replace(/_Animation$/i, "") || ui?.name.replace(/_UI_EN$/i, "") || path.basename(rootPath);
  return { rootPath, rootName, tabs };
}

function namingSuggestion(name, keepExtension = false) {
  const extension = keepExtension ? path.extname(name) : "";
  const stem = extension ? name.slice(0, -extension.length) : name;
  const clean = stem
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `${clean}${extension.toLowerCase()}`;
}

function namingReasons(name) {
  const reasons = [];
  if (name !== name.trim()) reasons.push("Dư khoảng trắng đầu/cuối");
  if (/\s/.test(name)) reasons.push("Có khoảng trắng");
  if (/[+-]/.test(name)) reasons.push("Có ký tự + hoặc -");
  if (/[^A-Za-z0-9_.+\-\s]/.test(name)) reasons.push("Có ký tự đặc biệt");
  if (/__+/.test(name)) reasons.push("Có underscore liên tiếp");
  return reasons;
}

function scanNamingIssues(sourceDir) {
  const issues = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const reasons = namingReasons(entry.name);
      if (reasons.length) issues.push({ type: entry.isDirectory() ? "Folder" : "File", name: entry.name, relativePath: path.relative(sourceDir, fullPath), reasons, suggestion: namingSuggestion(entry.name, entry.isFile()) });
      if (entry.isDirectory()) visit(fullPath);
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        try {
          const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
          if (!data?.skeleton || !data?.animations) continue;
          for (const animation of Object.keys(data.animations)) {
            const animationReasons = namingReasons(animation);
            if (animationReasons.length) issues.push({ type: "Animation", name: animation, relativePath: `${path.relative(sourceDir, fullPath)} → ${animation}`, reasons: animationReasons, suggestion: namingSuggestion(animation) });
          }
        } catch { /* Ignore non-Spine or invalid JSON here. */ }
      }
    }
  };
  visit(sourceDir);
  return issues;
}

function readAtlasPngs(atlasPath) {
  if (!fs.existsSync(atlasPath)) {
    return [];
  }

  const lines = fs.readFileSync(atlasPath, "utf8").split(/\r?\n/);
  return lines
    .filter((line) => line.trim().endsWith(".png"))
    .map((line) => line.trim());
}

function resolveAtlasTexturePaths(atlasPath) {
  const atlasDir = path.dirname(atlasPath);
  return readAtlasPngs(atlasPath).map((name) => path.resolve(atlasDir, name));
}

function atlasTexturesExist(atlasPath) {
  const texturePaths = resolveAtlasTexturePaths(atlasPath);
  return (
    texturePaths.length > 0 &&
    texturePaths.every((texturePath) => fs.existsSync(texturePath))
  );
}

function readSkinNames(rawSkins) {
  if (Array.isArray(rawSkins)) {
    return rawSkins
      .map((skin) => (skin && typeof skin === "object" ? skin.name : ""))
      .filter(Boolean);
  }

  if (rawSkins && typeof rawSkins === "object") {
    return Object.keys(rawSkins);
  }

  return [];
}

function animationDuration(animation) {
  let maxTime = 0;
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Number.isFinite(value.time)) maxTime = Math.max(maxTime, value.time);
    Object.values(value).forEach(visit);
  };
  visit(animation);
  return maxTime;
}

function normalizeBaseName(filePath) {
  return path.basename(filePath, path.extname(filePath)).toLowerCase();
}

function resolveAtlasPath(jsonPath, atlasCandidatesByDir) {
  const dir = path.dirname(jsonPath);
  const jsonBase = normalizeBaseName(jsonPath);
  const directAtlasPath = path.join(
    dir,
    `${path.basename(jsonPath, ".json")}.atlas`,
  );

  if (fs.existsSync(directAtlasPath)) {
    return atlasTexturesExist(directAtlasPath) ? directAtlasPath : "";
  }

  const candidates = atlasCandidatesByDir.get(dir) ?? [];
  if (candidates.length === 0) {
    return "";
  }

  const validCandidates = candidates.filter((atlasPath) =>
    atlasTexturesExist(atlasPath),
  );
  if (validCandidates.length === 0) {
    return "";
  }

  const exactCandidate = validCandidates.find(
    (atlasPath) => normalizeBaseName(atlasPath) === jsonBase,
  );
  if (exactCandidate) {
    return exactCandidate;
  }

  const looseCandidate = validCandidates.find((atlasPath) => {
    const atlasBase = normalizeBaseName(atlasPath);
    return atlasBase.includes(jsonBase) || jsonBase.includes(atlasBase);
  });
  if (looseCandidate) {
    return looseCandidate;
  }

  if (validCandidates.length === 1) {
    return validCandidates[0];
  }

  return "";
}

function scanSpineFolder(sourceDir) {
  const jsonFiles = walkJsonFiles(sourceDir);
  const atlasFiles = walkAtlasFiles(sourceDir);
  const atlasCandidatesByDir = new Map();
  const results = [];

  for (const atlasPath of atlasFiles) {
    const dir = path.dirname(atlasPath);
    const existing = atlasCandidatesByDir.get(dir) ?? [];
    existing.push(atlasPath);
    atlasCandidatesByDir.set(dir, existing);
  }

  for (const filePath of jsonFiles) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }

    if (!parsed?.skeleton || !parsed?.bones || !parsed?.slots) {
      continue;
    }

    const dir = path.dirname(filePath);
    const atlasPath = resolveAtlasPath(filePath, atlasCandidatesByDir);
    if (!atlasPath || !fs.existsSync(atlasPath)) {
      continue;
    }

    const slots = Array.isArray(parsed.slots) ? parsed.slots : [];
    const slotsWithAttachment = slots.filter((slot) => slot?.attachment).length;
    const usesAdditiveBlend = slots.some((slot) => slot?.blend === "additive");
    const pngNames = readAtlasPngs(atlasPath);
    const pngPaths = resolveAtlasTexturePaths(atlasPath);
    const atlasPages = Math.max(pngNames.length, 1);
    const estDrawcall = Math.max(
      atlasPages,
      Math.ceil(slotsWithAttachment / 8),
    );
    const animations =
      parsed.animations && typeof parsed.animations === "object"
        ? Object.keys(parsed.animations)
        : [];
    const animationDetails = animations.map((name) => ({
      name,
      duration: animationDuration(parsed.animations[name]),
    }));
    const skins = readSkinNames(parsed.skins);

    results.push({
      id: `${filePath}:${atlasPath}`,
      fileName: path.basename(filePath),
      relativeName: path.relative(sourceDir, filePath),
      jsonPath: filePath,
      atlasPath,
      pngPaths,
      version:
        typeof parsed.skeleton?.spine === "string"
          ? parsed.skeleton.spine
          : "unknown",
      slots: slotsWithAttachment,
      usesAdditiveBlend,
      atlasPages,
      estDrawcall,
      animations,
      animationDetails,
      skins,
    });
  }

  return results;
}

async function writeFileReplacing(filePath, buffer) {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fs.promises.writeFile(filePath, buffer);
      return;
    } catch (error) {
      const isLocked =
        error.code === "EBUSY" ||
        error.code === "EPERM" ||
        error.code === "EACCES";
      if (!isLocked || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
}


async function saveBatchGifs(outputDir, files) {
  const writtenFiles = [];
  for (const file of files) {
    if (!file?.fileName || !file?.dataBase64) continue;
    const safeName = path
      .basename(file.fileName)
      .replace(/[^A-Za-z0-9._-]+/g, "_");
    const gifPath = path.join(
      outputDir,
      safeName.toLowerCase().endsWith(".gif") ? safeName : `${safeName}.gif`,
    );
    await writeFileReplacing(gifPath, Buffer.from(file.dataBase64, "base64"));
    writtenFiles.push(gifPath);
  }
  return writtenFiles;
}

function registerIpcHandlers() {
  ipcMain.handle("asset-base-url", () => assetBaseUrl);
  ipcMain.handle("open-sheet-link", async (_event, url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "docs.google.com" || !parsed.pathname.startsWith("/spreadsheets/")) return;
    await shell.openExternal(parsed.href);
  });
  registerGoogleWorkspaceHandlers(ipcMain);
  ipcMain.handle("select-folder", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Spine Animation Folder",
    });

    if (canceled || !filePaths.length) {
      return "";
    }

    return filePaths[0];
  });
  ipcMain.handle("scan-local-catalog", async (_event, rootPath) => {
    try { return { ok: true, ...scanLocalCatalog(rootPath) }; }
    catch (error) { return { ok: false, error: error.message || String(error) }; }
  });


  ipcMain.handle("select-export-folder", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Select PNG Export Folder",
    });

    if (canceled || !filePaths.length) {
      return "";
    }

    return filePaths[0];
  });

  ipcMain.handle("scan-spine-folder", async (_event, sourceDir) => {
    try {
      if (!sourceDir || !fs.existsSync(sourceDir)) {
        return {
          files: [],
          error: "Folder không tồn tại hoặc không thể truy cập.",
        };
      }

      return {
        files: scanSpineFolder(sourceDir),
        error: "",
      };
    } catch (error) {
      return {
        files: [],
        error:
          error instanceof Error ? error.message : "Không thể scan folder.",
      };
    }
  });

  ipcMain.handle("scan-naming-issues", async (_event, sourceDir) => {
    try {
      if (!sourceDir || !fs.existsSync(sourceDir)) return { issues: [], error: "Folder không tồn tại hoặc không thể truy cập." };
      return { issues: scanNamingIssues(sourceDir), error: "" };
    } catch (error) {
      return { issues: [], error: error instanceof Error ? error.message : "Không thể kiểm tra naming." };
    }
  });


  ipcMain.handle("save-batch-gifs", async (_event, payload) => {
    try {
      const outputDir = payload?.outputDir;
      const files = Array.isArray(payload?.files) ? payload.files : [];
      if (!outputDir || !fs.existsSync(outputDir)) {
        return {
          ok: false,
          writtenFiles: [],
          error: "Folder export không tồn tại hoặc không thể truy cập.",
        };
      }
      const writtenFiles = await saveBatchGifs(outputDir, files);
      return { ok: true, writtenFiles, error: "" };
    } catch (error) {
      return {
        ok: false,
        writtenFiles: [],
        error: error instanceof Error ? error.message : "Không thể lưu GIF.",
      };
    }
  });

  ipcMain.handle("open-folder", async (_event, folderPath) => {
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { ok: false, error: "Folder không tồn tại." };
    }

    const error = await shell.openPath(folderPath);
    return { ok: !error, error };
  });
}

function installSpineAssetProtocol() {
  protocol.handle(SPINE_ASSET_SCHEME, async (request) => {
    console.log("[spine-asset]", request.url);
    const corsHeaders = { "Access-Control-Allow-Origin": "*" };
    try {
      const url = new URL(request.url);
      let filePath = decodeURIComponent(url.pathname);

      // Windows custom protocol URLs come through as /C:/path/to/file.
      // Strip the leading slash so fs can resolve the drive letter path.
      if (/^\/[A-Za-z]:\//.test(filePath)) {
        filePath = filePath.slice(1);
      }

      // Electron's network stack handles local file streaming and MIME types.
      // Pass through its response instead of constructing a Node Response body.
      const response = await net.fetch(pathToFileURL(filePath).href);
      return new Response(response.body, {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": contentTypeFor(filePath), "Cache-Control": "no-cache" },
      });
    } catch (error) {
      console.error("[spine-asset] Failed:", request.url, error);
      return new Response("Not found", {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }
  });
}

app.whenReady().then(async () => {
  await startAssetServer();
  registerIpcHandlers();
  installSpineAssetProtocol();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
app.on("will-quit", () => assetServer?.close());
