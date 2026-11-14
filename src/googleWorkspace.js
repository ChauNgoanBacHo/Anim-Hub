import { app, nativeImage, safeStorage, shell } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const CLIENT_ID = __GOOGLE_OAUTH_CLIENT_ID__;
const CLIENT_SECRET = __GOOGLE_OAUTH_CLIENT_SECRET__;
const WORKSPACE_DOMAIN = __GOOGLE_WORKSPACE_DOMAIN__;
const CLOSURE_SHEET_URL = __CLOSURE_SHEET_URL__;
const QUEUE_SHEET = "_ClosureUploadQueue";
const NOTES_SHEET_URL = __ANIMATION_NOTES_SHEET_URL__;
const QUEUE_CHUNK_SIZE = 35_000;
const clientConfigured = () =>
  /^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(CLIENT_ID) &&
  !/^(test|your-|example)/i.test(CLIENT_ID);
const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/spreadsheets",
];

const storePath = () => path.join(app.getPath("userData"), "google-workspace.json");
function readStore() {
  try { return JSON.parse(fs.readFileSync(storePath(), "utf8")); } catch { return {}; }
}
function writeStore(value) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(value, null, 2), "utf8");
}
function encrypt(value) {
  const raw = JSON.stringify(value);
  return safeStorage.isEncryptionAvailable()
    ? { encrypted: true, value: safeStorage.encryptString(raw).toString("base64") }
    : { encrypted: false, value: Buffer.from(raw).toString("base64") };
}
function decrypt(record) {
  if (!record?.value) return null;
  try {
    const bytes = Buffer.from(record.value, "base64");
    return JSON.parse(record.encrypted ? safeStorage.decryptString(bytes) : bytes.toString("utf8"));
  } catch { return null; }
}
function base64Url(value) { return Buffer.from(value).toString("base64url"); }
async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(60000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.error_description || `Google API ${response.status}`);
  return body;
}
async function accessToken() {
  const store = readStore();
  const tokens = decrypt(store.tokens);
  if (!tokens) throw new Error("Chưa đăng nhập Google Workspace.");
  if (tokens.access_token && Number(tokens.expires_at) > Date.now() + 60_000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error("Phiên Google đã hết hạn. Vui lòng đăng nhập lại.");
  const refreshed = await json("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...(CLIENT_SECRET ? { client_secret: CLIENT_SECRET } : {}), refresh_token: tokens.refresh_token, grant_type: "refresh_token" }),
  });
  const next = { ...tokens, ...refreshed, expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000 };
  writeStore({ ...store, tokens: encrypt(next) });
  return next.access_token;
}
async function userInfo(token) {
  return json("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token}` } });
}
async function status() {
  const store = readStore();
  const result = {
    configured: clientConfigured(),
    domain: WORKSPACE_DOMAIN || "",
    signedIn: false,
    user: store.user || null,
    workspace: {
      notesSheetUrl: NOTES_SHEET_URL,
      sheetUrl: CLOSURE_SHEET_URL,
    },
  };
  if (!store.tokens) return result;
  try {
    const token = await accessToken();
    const user = await userInfo(token);
    writeStore({ ...readStore(), user });
    return { ...result, signedIn: true, user };
  } catch { return result; }
}
async function signIn() {
  if (!clientConfigured()) throw new Error("Bản build chưa có Google Desktop OAuth Client ID hợp lệ.");
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  const oauthState = base64Url(crypto.randomBytes(24));
  const tokens = await new Promise((resolve, reject) => {
    let timer;
    const server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.pathname !== "/oauth/callback") return;
        if (url.searchParams.get("state") !== oauthState) throw new Error("OAuth state không hợp lệ.");
        if (url.searchParams.get("error")) throw new Error(`Google OAuth: ${url.searchParams.get("error")}`);
        const redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`;
        const result = await json("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: CLIENT_ID, ...(CLIENT_SECRET ? { client_secret: CLIENT_SECRET } : {}), code: url.searchParams.get("code") || "", code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code" }),
        });
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<h2>Đăng nhập thành công.</h2><p>Có thể đóng tab và quay lại xóm.</p>");
        clearTimeout(timer);
        resolve({ ...result, expires_at: Date.now() + Number(result.expires_in || 3600) * 1000 });
      } catch (error) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(error.message || "OAuth failed");
        reject(error);
      } finally { server.close(); }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`;
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.search = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", state: oauthState, code_challenge: challenge, code_challenge_method: "S256", ...(WORKSPACE_DOMAIN ? { hd: WORKSPACE_DOMAIN } : {}) });
      shell.openExternal(auth.toString());
    });
    timer = setTimeout(() => { server.close(); reject(new Error("Google OAuth timeout.")); }, 180_000);
  });
  const user = await userInfo(tokens.access_token);
  if (WORKSPACE_DOMAIN && !String(user.email || "").toLowerCase().endsWith(`@${WORKSPACE_DOMAIN.toLowerCase()}`)) {
    throw new Error(`Chỉ chấp nhận tài khoản @${WORKSPACE_DOMAIN}.`);
  }
  writeStore({ tokens: encrypt(tokens), user });
  return { signedIn: true, user };
}
function idFrom(value, type) {
  const text = String(value || "").trim();
  const pattern = type === "sheet" ? /\/spreadsheets\/d\/([\w-]+)/ : /\/folders\/([\w-]+)/;
  return text.match(pattern)?.[1] || (/^[\w-]{15,}$/.test(text) ? text : "");
}
function safeSheetTitle(title) { return String(title).replace(/[\\/?*\[\]:]/g, "-").slice(0, 100) || "Sheet"; }
function quoted(title) { return `'${safeSheetTitle(title).replaceAll("'", "''")}'`; }
async function createCatalog(sheetUrl, catalog) {
  const spreadsheetId = idFrom(sheetUrl, "sheet");
  if (!spreadsheetId) throw new Error("Link Google Sheet không hợp lệ.");
  const token = await accessToken();
  const metadata = await json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${token}` } });
  const sheets = (metadata.sheets || []).map((sheet) => sheet.properties).sort((a, b) => a.index - b.index);
  const existing = new Set(sheets.map((sheet) => sheet.title));
  const desiredTitles = catalog.tabs.map((tab) => safeSheetTitle(tab.title));
  const requests = [];
  const firstSheet = sheets[0];
  const firstDesired = desiredTitles[0];
  const isDefaultFirstSheet = firstSheet && /^(Sheet\s*1|Trang tính\s*1)$/i.test(firstSheet.title);
  if (firstDesired && isDefaultFirstSheet && !existing.has(firstDesired)) {
    requests.push({ updateSheetProperties: { properties: { sheetId: firstSheet.sheetId, title: firstDesired }, fields: "title" } });
    existing.delete(firstSheet.title);
    existing.add(firstDesired);
  }
  for (const title of desiredTitles) {
    if (!existing.has(title)) {
      requests.push({ addSheet: { properties: { title } } });
      existing.add(title);
    }
  }
  if (requests.length) await json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ requests }) });
  for (const tab of catalog.tabs) {
    const title = safeSheetTitle(tab.title);
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${quoted(title)}!A:C`)}:clear`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
    const values = [["Index", "File name", "Preview"], ...tab.items.map((item, index) => [index + 1, item.name, ""] )];
    await json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${quoted(title)}!A1`)}?valueInputOption=RAW`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ values }) });
  }
  const refreshed = await json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${token}` } });
  const sheetIds = new Map((refreshed.sheets || []).map((sheet) => [sheet.properties.title, sheet.properties.sheetId]));
  const layoutRequests = catalog.tabs.flatMap((tab) => {
    const sheetId = sheetIds.get(safeSheetTitle(tab.title));
    if (sheetId == null) return [];
    const dataRowHeight = tab.source === "ui" ? 260 : 44;
    const rowCount = Math.max(2, tab.items.length + 1);
    return [
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 70 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 320 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 340 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 38 }, fields: "pixelSize" } },
      { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: rowCount }, properties: { pixelSize: dataRowHeight }, fields: "pixelSize" } },
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 }, cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", wrapStrategy: "WRAP" } }, fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)" } },
      { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(horizontalAlignment,verticalAlignment)" } },
      { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE", wrapStrategy: "WRAP" } }, fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)" } },
      { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(horizontalAlignment,verticalAlignment)" } },
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    ];
  });
  if (layoutRequests.length) {
    await json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ requests: layoutRequests }) });
  }
  return { spreadsheetId, tabs: catalog.tabs.length };
}
async function loadSheet(sheetUrl, tabTitle = "") {
  const spreadsheetId = idFrom(sheetUrl, "sheet");
  if (!spreadsheetId) throw new Error("Link Google Sheet không hợp lệ.");
  const token = await accessToken();
  const metadata = await json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties`, { headers: { Authorization: `Bearer ${token}` } });
  const tabs = (metadata.sheets || []).map((sheet) => sheet.properties.title).filter((title) => title !== QUEUE_SHEET);
  const animationTabs = tabs.filter((title) => /(?:^|_)Spine$|(?:^|_)Symbols?$/i.test(title));
  if (animationTabs.length) tabs.unshift("All animations");
  const selected = tabTitle && tabs.includes(tabTitle) ? tabTitle : tabs[0] || "";
  let rows = [];
  if (selected) {
    const sources = selected === "All animations" ? animationTabs : [selected];
    const groups = await Promise.all(sources.map(async (sheetName) => {
      const data = await json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${quoted(sheetName)}!A:C`)}`, { headers: { Authorization: `Bearer ${token}` } });
      return (data.values || []).slice(1).map((row, index) => ({ sheetName, rowNumber: index + 2, index: row[0] || index + 1, name: row[1] || "", preview: row[2] || "" })).filter((row) => row.name);
    }));
    rows = groups.flat();
  }
  return { spreadsheetId, title: metadata.properties?.title || "Closure Sheet", tabs, selected, rows };
}

function localPreviewPayload(item) {
  if (!item.localPath || !fs.existsSync(item.localPath)) throw new Error(`Không tìm thấy ảnh local: ${item.fileName || "unknown"}`);
  const source = nativeImage.createFromPath(item.localPath);
  if (source.isEmpty()) throw new Error(`Không đọc được ảnh local: ${item.fileName || path.basename(item.localPath)}`);
  const original = source.getSize();
  const scale = Math.min(1, 300 / original.width, 220 / original.height);
  let width = Math.max(1, Math.round(original.width * scale));
  let height = Math.max(1, Math.round(original.height * scale));
  let bytes = source.resize({ width, height, quality: "good" }).toPNG();
  const maxPreviewBytes = 1.5 * 1024 * 1024;
  while (bytes.length > maxPreviewBytes && width > 80 && height > 80) {
    width = Math.max(1, Math.round(width * 0.8));
    height = Math.max(1, Math.round(height * 0.8));
    bytes = source.resize({ width, height, quality: "good" }).toPNG();
  }
  if (bytes.length > maxPreviewBytes) throw new Error(`Không thể tối ưu ảnh ${item.fileName || "preview"} xuống dưới 2 MB.`);
  const result = { ...item, mimeType: "image/png", dataBase64: bytes.toString("base64") };
  delete result.localPath;
  return result;
}

async function ensureQueueSheet(spreadsheetId, token) {
  const metadata = await json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${token}` } });
  const existing = (metadata.sheets || []).find((sheet) => sheet.properties.title === QUEUE_SHEET);
  if (!existing) {
    await json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: QUEUE_SHEET, hidden: true, gridProperties: { rowCount: 2000, columnCount: 40 } } } }] }),
    });
  }
  const headers = [["Job ID", "Status", "Sheet", "Cell", "File name", "MIME type", "Error", "Created at", "Updated at", ...Array.from({ length: 31 }, (_, index) => `Chunk ${index + 1}`)]];
  await json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${quoted(QUEUE_SHEET)}!A1`)}?valueInputOption=RAW`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: headers }),
  });
}

async function queueImages(payload) {
  const spreadsheetId = payload.spreadsheetId || idFrom(CLOSURE_SHEET_URL, "sheet");
  if (!spreadsheetId) throw new Error("Closure Sheet ID không hợp lệ.");
  const token = await accessToken();
  await ensureQueueSheet(spreadsheetId, token);
  const jobId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const images = (payload.images || []).map((item) => item.localPath ? localPreviewPayload(item) : item);
  const rows = images.map((item) => {
    const chunks = String(item.dataBase64 || "").match(new RegExp(`.{1,${QUEUE_CHUNK_SIZE}}`, "g")) || [];
    if (chunks.length > 31) throw new Error(`Ảnh ${item.fileName || "preview"} vẫn quá lớn cho upload queue.`);
    return [jobId, "queued", item.sheetName, item.cell, item.fileName, item.mimeType || "image/png", "", createdAt, createdAt, ...chunks];
  });
  if (!rows.length) return { jobId, total: 0 };
  await json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${quoted(QUEUE_SHEET)}!A:AN`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
  });
  return { jobId, total: rows.length };
}

async function queueStatus(jobId, spreadsheetId = "") {
  const targetId = spreadsheetId || idFrom(CLOSURE_SHEET_URL, "sheet");
  if (!targetId || !jobId) throw new Error("Upload queue không hợp lệ.");
  const token = await accessToken();
  const data = await json(`https://sheets.googleapis.com/v4/spreadsheets/${targetId}/values/${encodeURIComponent(`${quoted(QUEUE_SHEET)}!A:G`)}`, { headers: { Authorization: `Bearer ${token}` } });
  const rows = (data.values || []).slice(1).filter((row) => row[0] === jobId);
  const counts = { queued: 0, processing: 0, done: 0, error: 0 };
  rows.forEach((row) => { const status = row[1] || "queued"; counts[status] = (counts[status] || 0) + 1; });
  const errors = rows.filter((row) => row[1] === "error").map((row) => `${row[4] || "Image"}: ${row[6] || "Upload failed"}`);
  return { total: rows.length, ...counts, errors };
}

async function clearCatalog() {
  const spreadsheetId = idFrom(CLOSURE_SHEET_URL, "sheet");
  if (!spreadsheetId) throw new Error("CLOSURE_SHEET_URL không hợp lệ.");
  const token = await accessToken();
  const metadata = await json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const sheets = (metadata.sheets || []).map((sheet) => sheet.properties);
  const usedIds = new Set(sheets.map((sheet) => sheet.sheetId));
  let temporarySheetId = 900000000 + Math.floor(Math.random() * 90000000);
  while (usedIds.has(temporarySheetId)) temporarySheetId += 1;
  const temporaryTitle = `__closure_reset_${Date.now()}__`;
  const requests = [
    { addSheet: { properties: { sheetId: temporarySheetId, title: temporaryTitle } } },
    ...sheets.map((sheet) => ({ deleteSheet: { sheetId: sheet.sheetId } })),
    { updateSheetProperties: { properties: { sheetId: temporarySheetId, title: "Sheet1", index: 0 }, fields: "title,index" } },
  ];
  await json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
  return { cleared: true };
}

async function transferOwnership(payload) {
  const sheetId = idFrom(payload.sheetUrl, "sheet");
  const folderId = idFrom(payload.driveUrl, "folder");
  const email = String(payload.email || "").trim().toLowerCase();
  if (!sheetId || !folderId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Nhập đúng link Sheet, folder Drive và email nhận.");
  const token = await accessToken();
  const user = await userInfo(token);
  if (email === user.email?.toLowerCase()) throw new Error("Email nhận đang là tài khoản đăng nhập.");
  if (email.split("@")[1] !== user.email?.toLowerCase().split("@")[1]) throw new Error("Chỉ chuyển owner sang email cùng domain công ty.");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = "https://www.googleapis.com/drive/v3/files";
  const folder = await json(`${base}/${folderId}?fields=id,name,mimeType,driveId&supportsAllDrives=true`, { headers });
  if (folder.mimeType !== "application/vnd.google-apps.folder") throw new Error("Drive path phải là folder.");
  if (folder.driveId) throw new Error("Shared Drive thuộc tổ chức, không thể chuyển owner cá nhân.");
  const targets = new Map([[sheetId, { id: sheetId, name: "Closure Sheet" }]]);
  const visited = new Set();
  async function visit(item) {
    if (visited.has(item.id)) return;
    visited.add(item.id); targets.set(item.id, item);
    if (item.mimeType !== "application/vnd.google-apps.folder") return;
    let pageToken = "";
    do {
      const params = new URLSearchParams({ q: `'${item.id}' in parents and trashed=false`, fields: "nextPageToken,files(id,name,mimeType)", pageSize: "1000" });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await json(`${base}?${params}`, { headers });
      for (const child of page.files || []) await visit(child);
      pageToken = page.nextPageToken || "";
    } while (pageToken);
  }
  await visit(folder);
  const results = [];
  // Transfer children before parents; do not follow Drive shortcuts.
  for (const item of Array.from(targets.values()).reverse()) {
    try {
      const permissions = await json(`${base}/${item.id}/permissions?fields=permissions(id,emailAddress,role)`, { headers });
      const existing = permissions.permissions?.find((p) => p.emailAddress?.toLowerCase() === email);
      if (existing?.role !== "owner") {
        await json(`${base}/${item.id}/permissions${existing ? `/${existing.id}` : ""}?transferOwnership=true&sendNotificationEmail=true`, {
          method: existing ? "PATCH" : "POST", headers,
          body: JSON.stringify(existing ? { role: "owner" } : { type: "user", role: "owner", emailAddress: email }),
        });
      }
      results.push({ name: item.name, ok: true });
    } catch (error) { results.push({ name: item.name, ok: false, error: error.message }); }
  }
  return { results, total: results.length, done: results.filter((item) => item.ok).length };
}

async function animationNotes(action, payload, onProgress = () => {}) {
  const token = await accessToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const spreadsheetId = idFrom(NOTES_SHEET_URL, "sheet");
  if (!spreadsheetId) throw new Error("Chưa cấu hình ANIMATION_NOTES_SHEET_URL trong env.");
  if (action === "games") {
    const database = await json(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, { headers });
    return { games: (database.sheets || []).map((s) => s.properties.title).filter((title) => /^\d+$/.test(title)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) };
  }
  const gameId = String(payload.gameId || "").trim();
  if (!/^\d+$/.test(gameId)) throw new Error("Game ID chỉ gồm chữ số.");
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const range = encodeURIComponent(`${quoted(gameId)}!A:H`);
  const metadata = await json(`${base}?fields=sheets.properties`, { headers });
  const tab = metadata.sheets?.find((s) => s.properties.title === gameId);
  let stored = [];
  if (tab) {
    const data = await json(`${base}/values/${range}`, { headers });
    stored = (data.values || []).slice(1).filter((r) => r[0]).map((r) => ({ fileId: r[0], name: r[1] || "", animation: r[2] || "", note: r[3] || "", general: r[4] || "", status: r[5] || "active", folder: r[6] || "" }));
  }
  if (action === "load") return { rows: stored };
  let rows;
  if (action === "scan") {
    const folderId = idFrom(payload.driveUrl, "folder");
    if (!folderId) throw new Error("Nhập link hoặc ID folder Drive hợp lệ.");
    const fresh = []; const visited = new Set();
    let filesRead = 0;
    async function visit(id, folder) {
      if (visited.has(id)) return; visited.add(id);
      onProgress(`Đang quét ${folder || "folder gốc"} · ${visited.size} folder · ${filesRead} file Spine · ${fresh.length} anim`);
      let pageToken = "";
      do {
        const params = new URLSearchParams({ q: `'${id}' in parents and trashed=false`, fields: "nextPageToken,files(id,name,mimeType)", pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
        if (pageToken) params.set("pageToken", pageToken);
        const page = await json(`https://www.googleapis.com/drive/v3/files?${params}`, { headers });
        for (const file of page.files || []) {
          if (file.mimeType === "application/vnd.google-apps.folder") await visit(file.id, `${folder}/${file.name}`);
          else if (/\.json$/i.test(file.name) && !/\.meta$/i.test(file.name)) {
            onProgress(`Đang đọc ${file.name} · ${visited.size} folder · ${filesRead} file Spine · ${fresh.length} anim`);
            const data = await json(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, { headers, signal: AbortSignal.timeout(60000) });
            if (!data.skeleton || !data.animations) continue;
            filesRead += 1;
            for (const animation of Object.keys(data.animations)) fresh.push({ fileId: file.id, name: file.name.replace(/\.json$/i, ""), animation, folder, status: "active" });
          }
        }
        pageToken = page.nextPageToken || "";
      } while (pageToken);
    }
    await visit(folderId, "");
    const key = (r) => `${r.fileId}\n${r.animation}`;
    const old = new Map(stored.map((r) => [key(r), r]));
    const seen = new Set(fresh.map(key));
    rows = fresh.map((r) => ({ ...old.get(key(r)), ...r, note: old.get(key(r))?.note || "", general: old.get(key(r))?.general || "" }));
    rows.push(...stored.filter((r) => !seen.has(key(r))).map((r) => ({ ...r, status: "missing" })));
    rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.animation.localeCompare(b.animation));
    return animationNotes("save", { gameId, rows });
  }
  if (action === "save-spine") {
    const edits = new Map((payload.rows || []).filter((row) => row.fileId === payload.fileId).map((row) => [row.animation, row]));
    if (!stored.some((row) => row.fileId === payload.fileId)) throw new Error("Không tìm thấy Spine trên database. Load hoặc Scan lại.");
    const rows = stored.map((row) => {
      const edit = row.fileId === payload.fileId ? edits.get(row.animation) : null;
      return edit ? { ...row, note: String(edit.note || ""), general: String(edit.general || "") } : row;
    });
    return animationNotes("save", { gameId, rows });
  }
  if (action === "save-note") {
    let changed = false;
    const updated = stored.map((row) => {
      if (row.fileId !== payload.fileId || (!payload.general && row.animation !== payload.animation)) return row;
      changed = true;
      return { ...row, [payload.general ? "general" : "note"]: String(payload.text || "") };
    });
    if (!changed) throw new Error("Không tìm thấy animation trên database. Scan hoặc Load lại game.");
    return animationNotes("save", { gameId, rows: updated });
  }
  if (action !== "save") throw new Error("Notes action không hợp lệ.");
  const edits = new Map((payload.rows || []).map((r) => [`${r.fileId}\n${r.animation}`, r]));
  rows = stored.map((r) => edits.get(`${r.fileId}\n${r.animation}`) || r);
  const keys = new Set(rows.map((r) => `${r.fileId}\n${r.animation}`));
  rows.push(...Array.from(edits.values()).filter((r) => !keys.has(`${r.fileId}\n${r.animation}`)));
  if (!tab) await json(`${base}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: gameId, gridProperties: { frozenRowCount: 1 } } } }] }) });
  const values = [["Drive file ID", "Spine", "Animation", "Hướng dẫn gọi", "Ghi chú Spine", "Status", "Folder", "Updated at"], ...rows.map((r) => [r.fileId, r.name, r.animation, r.note || "", r.general || "", r.status || "active", r.folder || "", new Date().toISOString()])];
  await json(`${base}/values/${encodeURIComponent(`${quoted(gameId)}!A1`)}?valueInputOption=RAW`, { method: "PUT", headers, body: JSON.stringify({ values }) });
  return { rows };
}

export function registerGoogleWorkspaceHandlers(ipcMain) {
  ipcMain.handle("animation-notes", async (event, action, payload) => { try { return { ok: true, ...await animationNotes(action, payload, (message) => { if (!event.sender.isDestroyed()) event.sender.send("animation-notes-progress", message); }) }; } catch (error) { return { ok: false, error: error.message }; } });
  ipcMain.handle("workspace-transfer-owner", wrapTransfer);
  async function wrapTransfer(_event, payload) { try { return { ok: true, ...await transferOwnership(payload) }; } catch (error) { return { ok: false, error: error.message }; } }
  const wrap = (handler) => async (_event, ...args) => { try { return { ok: true, ...(await handler(...args)) }; } catch (error) { return { ok: false, error: error.message || String(error) }; } };
  ipcMain.handle("workspace-google-status", wrap(status));
  ipcMain.handle("workspace-google-sign-in", wrap(signIn));
  ipcMain.handle("workspace-google-sign-out", async () => { const store = readStore(); delete store.tokens; delete store.user; writeStore(store); return { ok: true }; });
  ipcMain.handle("workspace-create-catalog", wrap(createCatalog));
  ipcMain.handle("workspace-load-sheet", wrap(loadSheet));
  ipcMain.handle("workspace-clear-catalog", wrap(clearCatalog));
  ipcMain.handle("workspace-queue-images", wrap(queueImages));
  ipcMain.handle("workspace-queue-status", wrap(queueStatus));
}
