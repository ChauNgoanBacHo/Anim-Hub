import "./index.css";
import mascotIcon from "../assets/icon-mascot-transparent.png";
import mascotSuccess from "../assets/mascot-success-face.png";
import mascotFail from "../assets/mascot-fail-face.png";
import mascotCaution from "../assets/mascot-caution.png";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import gifsicle from "gifsicle-wasm-browser";
import { SpineStage } from "./spineStage.js";

const FPS = 20,
  SIZE = 512,
  GIF_ALPHA_THRESHOLD = 96,
  MAX_GIF_BYTES = 512 * 1024,
  app = document.querySelector("#app");
const OBJECT_SIZES = [50, 60, 70, 80, 90, 100];
const GLOBAL_DURATIONS = [0.5, 1, 1.5];
const savedObjectSize = Number(localStorage.getItem("gif-object-size"));
const savedGlobalDuration = Number(localStorage.getItem("gif-global-duration"));
const state = {
  source: localStorage.getItem("gif-source") || "",
  output: localStorage.getItem("gif-output") || "",
  backgroundMode: ["checker", "transparent", "color"].includes(localStorage.getItem("gif-background-mode")) ? localStorage.getItem("gif-background-mode") : localStorage.getItem("gif-bake-checker") !== "false" ? "checker" : "transparent",
  backgroundColor: /^#[0-9a-f]{6}$/i.test(localStorage.getItem("gif-background-color") || "") ? localStorage.getItem("gif-background-color") : "#202226",
  bakeChecker: localStorage.getItem("gif-bake-checker") !== "false",
  combineSymbols: localStorage.getItem("gif-combine-symbols") === "true",
  exportMode: ["single", "group", "both"].includes(localStorage.getItem("gif-export-mode")) ? localStorage.getItem("gif-export-mode") : localStorage.getItem("gif-combine-symbols") === "true" ? "group" : "single",
  groupFileName: localStorage.getItem("gif-group-name") || "anim_group",
  gifGroups: [],
  optimizeGif: localStorage.getItem("gif-optimize") === "true",
  objectSize: OBJECT_SIZES.includes(savedObjectSize) ? savedObjectSize : 80,
  cropPadding: Number(localStorage.getItem("gif-crop-padding")) || 8,
  groupPerRow: Number(localStorage.getItem("gif-group-per-row")) || 5,
  globalDuration: GLOBAL_DURATIONS.includes(savedGlobalDuration)
    ? savedGlobalDuration
    : 1,
  files: [],
  configs: new Map(),
  active: "",
  stage: null,
  spine: null,
  previewFrame: 0,
  previewStartedAt: 0,
  previewPaused: false,
  previewPauseTime: 0,
  scanning: false,
  exporting: false,
  progress: 0,
  status: "",
  error: "",
  search: "",
  module: "home",
  notes: { driveUrl: "", gameId: "", rows: [], busy: false, message: "", error: "", sheetUrl: "", dirty: false, games: [], initialized: false, saving: false, revision: 0, onlyNoted: false },
  ownership: { sheetUrl: "", moveSheetUrl: "", moveFolderUrl: "", driveUrl: "", email: localStorage.getItem("ownership-recipient-email") || "owner@enotion.io", busy: false, message: "", error: "", results: [] },
  google: { configured: false, signedIn: false, user: null, busy: false },
  workspace: {
    driveUrl: localStorage.getItem("closure-local-root") || "",
    animationFolder: localStorage.getItem("closure-animation-folder") || "_Animation",
    animationPath: localStorage.getItem("closure-animation-path") || "",
    uiPath: localStorage.getItem("closure-ui-path") || "",
    useAnimation: true,
    animationMode: "local",
    uiMode: "local",
    animationDrive: localStorage.getItem("closure-animation-drive") || "",
    uiDrive: localStorage.getItem("closure-ui-drive") || "",
    useUi: true,
    uiFolder: localStorage.getItem("closure-ui-folder") || "_UI_EN",
    sourceFolderUrl: localStorage.getItem("closure-source-folder-url") || "",
    sheetUrl: "",
    catalog: null,
    sheet: null,
    uploadRows: [],
    busy: false,
    progress: 0,
    message: "",
    error: "",
  },
  naming: {
    folder: localStorage.getItem("naming-folder") || "",
    issues: [],
    scanning: false,
    error: "",
  },
};
const icon = (name) =>
  name === "folder"
    ? '<svg viewBox="0 0 24 24"><path d="M3 8h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm0 0V5a2 2 0 0 1 2-2h5l2 2h5"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>';
const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const keyOf = (f, a) => `${f.id}::${a}`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const renderObjectSize = () => (state.objectSize === 100 ? 96 : state.objectSize);
const fmt = (v) => `${Number(v || 0).toFixed(2)}s`;
const durationOf = (f, a) =>
  Math.max(
    0,
    Number(f.animationDetails?.find((x) => x.name === a)?.duration) || 0,
  );
function configOf(f, a) {
  const k = keyOf(f, a);
  if (!state.configs.has(k)) {
    state.configs.set(k, {
      selected: false,
      skin: f.skins?.[0] || "",
      start: 0,
      end: state.globalDuration,
    });
  }
  return state.configs.get(k);
}
function items() {
  return state.files.flatMap((file) =>
    file.animations.map((animation) => ({
      file,
      animation,
      config: configOf(file, animation),
    })),
  );
}
function selected() {
  return items().filter((x) => x.config.selected);
}
function visibleFiles() {
  const query = state.search.trim().toLowerCase();
  if (!query) return state.files;
  return state.files
    .map((file) => {
      if (file.fileName.toLowerCase().includes(query)) return file;
      return {
        ...file,
        animations: file.animations.filter((animation) =>
          animation.toLowerCase().includes(query),
        ),
      };
    })
    .filter((file) => file.animations.length);
}
function clean(v) {
  return String(v)
    .replace(/\.json$/i, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_");
}

function normalizeGifAlpha(source) {
  const pixels = new Uint8ClampedArray(source);
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < GIF_ALPHA_THRESHOLD) {
      pixels[index] = 0;
      pixels[index + 1] = 0;
      pixels[index + 2] = 0;
      pixels[index + 3] = 0;
    } else {
      // GIF only supports 1-bit alpha. Converting edge pixels to opaque here
      // prevents semi-transparent RGB values from becoming cyan palette noise.
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

function visiblePixelBounds(canvas) {
  const { width, height } = canvas;
  const pixels = canvas
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, width, height).data;
  const columns = new Uint32Array(width);
  const rows = new Uint32Array(height);
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] < GIF_ALPHA_THRESHOLD) continue;
      columns[x] += 1;
      rows[y] += 1;
      total += 1;
    }
  }
  if (!total) return null;
  const trim = Math.floor(total * 0.005);
  const quantileEdge = (counts, reverse = false) => {
    let discarded = 0;
    if (reverse) {
      for (let index = counts.length - 1; index >= 0; index -= 1) {
        discarded += counts[index];
        if (discarded > trim) return index;
      }
      return 0;
    }
    for (let index = 0; index < counts.length; index += 1) {
      discarded += counts[index];
      if (discarded > trim) return index;
    }
    return counts.length - 1;
  };
  return {
    left: quantileEdge(columns),
    top: quantileEdge(rows),
    right: quantileEdge(columns, true),
    bottom: quantileEdge(rows, true),
  };
}

function expandCrop(bounds, padding, maxWidth, maxHeight) {
  if (!bounds) return { x: 0, y: 0, width: maxWidth, height: maxHeight };
  const x = Math.max(0, bounds.left - padding);
  const y = Math.max(0, bounds.top - padding);
  const right = Math.min(maxWidth - 1, bounds.right + padding);
  const bottom = Math.min(maxHeight - 1, bounds.bottom + padding);
  return { x, y, width: Math.max(1, right - x + 1), height: Math.max(1, bottom - y + 1) };
}

function framePixelsForExport(
  frameCanvas,
  bakeChecker,
  width = SIZE,
  height = SIZE,
  backgroundColor = null,
) {
  if (!bakeChecker && !backgroundColor) {
    return frameCanvas
      .getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, width, height).data;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (backgroundColor) {
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, width, height);
  } else {
  const cell = 24;
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      context.fillStyle =
        (x / cell + y / cell) % 2 === 0 ? "#c8ced8" : "#8f99a8";
      context.fillRect(x, y, cell, cell);
    }
  }
  }
  context.drawImage(frameCanvas, 0, 0);
  return context.getImageData(0, 0, width, height).data;
}

function resizedCanvas(source, width, height) {
  if (source.width === width && source.height === height) return source;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function fileToBase64(file) {
  if (file.dataBase64) return file.dataBase64;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return bytesToBase64(bytes);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function elapsedLabel(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function operationDuration(startedAt) {
  const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)} phút ${seconds % 60} giây` : `${seconds} giây`;
}
async function waitForUploadQueue(jobId, total, spreadsheetId, tabLabel = "") {
  const w = state.workspace;
  const startedAt = Date.now();
  const timeoutMs = Math.max(20 * 60 * 1000, (Math.ceil(total / 60) + 5) * 60 * 1000);
  let lastCompleted = -1;
  let lastProgressAt = startedAt;
  while (Date.now() - startedAt < timeoutMs) {
    if (w.catalogOperation && w.catalogCancelled) throw new Error("Đã huỷ Create / Update Sheet.");
    const result = await window.spinePreview.queueStatus(jobId, spreadsheetId);
    if (!result?.ok) throw new Error(result?.error || "Không đọc được upload queue.");
    const completed = result.done + result.error;
    if (completed !== lastCompleted) {
      lastCompleted = completed;
      lastProgressAt = Date.now();
    }
    w.progress = total ? completed / total : 1;
    const elapsed = elapsedLabel(Date.now() - startedAt);
    const waitingForFirstCommit = completed === 0 && result.processing === 0 && Date.now() - startedAt >= 60_000;
    const stalled = result.queued > 0 && result.processing === 0 && Date.now() - lastProgressAt >= 120_000;
    w.message = stalled
      ? `Upload stalled · ${completed}/${total} completed · no progress for ${elapsedLabel(Date.now() - lastProgressAt)} · check Apps Script Executions`
      : result.processing
      ? `Uploading images · ${completed}/${total} completed · ${result.processing} processing · ${elapsed}`
      : waitingForFirstCommit
        ? `Trigger is processing the first batch · ${completed}/${total} status committed · ${result.queued} queued · elapsed ${elapsed}`
        : `Waiting for trigger (runs every minute) · ${completed}/${total} completed · ${result.queued} queued · elapsed ${elapsed}`;
    if (tabLabel) w.message = `Tab: ${tabLabel} · ${w.message}`;
    render();
    if (completed >= total) return result;
    await wait(3000);
  }
  throw new Error(`Upload queue quá ${Math.ceil(timeoutMs / 60000)} phút chưa hoàn tất. Kiểm tra Apps Script trigger và Executions.`);
}

async function optimizeGifFile(file) {
  const source = base64ToBytes(file.dataBase64);
  try {
    const output = await gifsicle.run({
      input: [{ file: source.buffer, name: "input.gif" }],
      command: [
        "-O3 --lossy=80 --colors 128 input.gif -o /out/optimized.gif",
      ],
      isStrict: true,
    });
    if (!output?.[0]) return file;
    const optimized = new Uint8Array(await output[0].arrayBuffer());
    if (!optimized.length || optimized.length >= source.length) return file;
    return { ...file, dataBase64: bytesToBase64(optimized) };
  } catch (error) {
    console.warn("Gifsicle optimize failed; keeping original GIF.", error);
    return file;
  }
}

async function encodeWithinSize({
  duration,
  width,
  height,
  bakeChecker,
  backgroundColor,
  renderFrame,
  onProgress,
}) {
  const profiles = [
        { scale: 1, fps: 20, colors: 256 },
        { scale: 0.9, fps: 18, colors: 192 },
        { scale: 0.8, fps: 15, colors: 128 },
        { scale: 0.7, fps: 12, colors: 96 },
        { scale: 0.6, fps: 10, colors: 64 },
        { scale: 0.5, fps: 8, colors: 48 },
        { scale: 0.4, fps: 6, colors: 32 },
        { scale: 0.3, fps: 5, colors: 24 },
        { scale: 0.22, fps: 4, colors: 16 },
      ];
  let result = null;
  for (let profileIndex = 0; profileIndex < profiles.length; profileIndex += 1) {
    const profile = profiles[profileIndex];
    const outputWidth = Math.max(2, Math.round(width * profile.scale));
    const outputHeight = Math.max(2, Math.round(height * profile.scale));
    const frameCount = Math.max(2, Math.round(duration * profile.fps));
    const gif = GIFEncoder();
    for (let frame = 0; frame < frameCount; frame += 1) {
      const elapsed = (frame / Math.max(1, frameCount - 1)) * duration;
      const rawCanvas = await renderFrame(elapsed);
      const frameCanvas = resizedCanvas(rawCanvas, outputWidth, outputHeight);
      const pixels = normalizeGifAlpha(
        framePixelsForExport(
          frameCanvas,
          bakeChecker,
          outputWidth,
          outputHeight,
          backgroundColor,
        ),
      );
      const palette = quantize(pixels, profile.colors, {
        format: "rgba4444",
        oneBitAlpha: true,
        clearAlpha: true,
        clearAlphaThreshold: 0,
        clearAlphaColor: 0,
      });
      const bitmap = applyPalette(pixels, palette, "rgba4444");
      const transparentIndex = palette.findIndex((color) => color[3] === 0);
      if (transparentIndex >= 0) {
        const transparentIndexes = new Set(
          palette
            .map((color, index) => (color[3] === 0 ? index : -1))
            .filter((index) => index >= 0),
        );
        for (let index = 0; index < bitmap.length; index += 1) {
          if (transparentIndexes.has(bitmap[index])) bitmap[index] = transparentIndex;
        }
      }
      gif.writeFrame(bitmap, outputWidth, outputHeight, {
        palette,
        delay: (duration * 1000) / frameCount,
        repeat: 0,
        transparent: transparentIndex >= 0,
        transparentIndex: Math.max(0, transparentIndex),
        dispose: 2,
      });
      onProgress?.(frame, frameCount, profileIndex, profiles.length);
      await new Promise(requestAnimationFrame);
    }
    gif.finish();
    const bytes = gif.bytes();
    result = { bytes, ...profile, width: outputWidth, height: outputHeight };
    if (bytes.length <= MAX_GIF_BYTES) break;
  }
  return result;
}

let updateState = {status:"idle",available:false};
window.spinePreview.onAppUpdateState?.((value) => {
  updateState = value;
  app.querySelectorAll('[data-do="check-app-update"]').forEach((button) => { button.textContent = value.available ? "Có bản cập nhật" : "Cập nhật"; });
  app.querySelectorAll("[data-app-version]").forEach((label) => { label.textContent = value.current ? `v${value.current}` : ""; });
});
async function showAppUpdates() {
  if (document.querySelector(".update-dialog")) return;
  const dialog = document.createElement("dialog"); dialog.className = "note-dialog update-dialog";
  const busyStatuses = ["checking","downloading","installing"];
  function paint(value) {
    if (!dialog.open) return;
    const messages = {
      idle:"Kiểm tra bản mới trên GitHub Releases.",
      checking:"Đang kiểm tra bản mới và chữ ký release…",
      available:`Có bản ${value.latest}. Tải bản mới dưới nền, sau đó khởi động lại để cài.`,
      downloading:`Đang tải bản ${value.latest} · ${Math.round((value.progress || 0)*100)}%`,
      ready:`Bản ${value.latest} đã tải và xác thực. Lưu công việc trước khi khởi động lại để cài.`,
      installing:"Đang kiểm tra và chuẩn bị cài. App sẽ đóng khi helper sẵn sàng…",
      current:"Bạn đang dùng phiên bản mới nhất hiện có cho app.",
      unavailable:`GitHub có bản ${value.latest}, nhưng bản này chưa hỗ trợ cập nhật tự động cho máy của bạn. Bạn vẫn có thể tiếp tục dùng bản ${value.current}.`,
      installed:`Đã chạy bản ${value.installedVersion} sau cập nhật.`,
      error:"Không thể kiểm tra hoặc tải bản cập nhật lúc này.",
    };
    dialog.innerHTML = `<h2>Cập nhật Xóm</h2><small>Phiên bản đang dùng: ${esc(value.current || "")}</small><p role="status">${esc(messages[value.status] || "")}</p>${value.error ? `<p class="update-error" role="alert">${esc(value.error)}</p>` : ""}${value.status === "downloading" ? `<progress max="1" value="${value.progress || 0}"></progress>` : ""}<div class="module-actions"><button class="copy-sheet-action" data-close ${value.status === "installing" ? "disabled" : ""}>Đóng</button>${!busyStatuses.includes(value.status) ? value.status === "ready" ? `<button class="primary-action" data-install>Khởi động lại & cài</button>` : value.status === "available" ? `<button class="primary-action" data-download>Tải cập nhật</button>` : `<button class="primary-action" data-check>Kiểm tra lại</button>` : ""}</div>`;
    dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.querySelector("[data-check]")?.addEventListener("click",()=>window.spinePreview.checkAppUpdate().catch(showError));
    dialog.querySelector("[data-download]")?.addEventListener("click",()=>window.spinePreview.downloadAppUpdate().catch(showError));
    dialog.querySelector("[data-install]")?.addEventListener("click",async () => {
      if (state.exporting || state.workspace.busy || state.ownership.busy || state.notes.busy || state.notes.saving || state.notes.dirty) { showError(new Error("Hoàn tất tác vụ và lưu ghi chú trước khi cập nhật bro.")); return; }
      try { await window.spinePreview.installAppUpdate(); } catch(error) {showError(error);}
    });
  }
  function showError(error) {paint({...updateState,error:error.message});}
  dialog.addEventListener("cancel",(event)=>{if(updateState.status === "installing") event.preventDefault();});
  const unsubscribe = window.spinePreview.onAppUpdateState(paint);
  dialog.addEventListener("close",()=>{unsubscribe();dialog.remove();},{once:true});
  document.body.append(dialog); dialog.showModal();
  try {
    updateState = await window.spinePreview.appUpdateState(); paint(updateState);
    if (["idle","current","error"].includes(updateState.status)) await window.spinePreview.checkAppUpdate();
  } catch(error) {showError(error);}
}

function appUpdateControl() {
  return `<div class="app-update-control"><span class="app-version" data-app-version>${updateState.current ? `v${esc(updateState.current)}` : ""}</span><button data-do="check-app-update">${updateState.available ? "Có bản cập nhật" : "Cập nhật"}</button></div>`;
}

function appNav() {
  return `<div class="feature-topbar"><button class="feature-back" data-do="back-home">← Về Xóm</button><div class="feature-account">${state.google.signedIn ? `<div><strong>${esc(state.google.user?.name || "Google Workspace")}</strong><span>${esc(state.google.user?.email || "")}</span></div><button data-do="google-sign-out">Sign out</button>` : `<div><strong>Google Workspace</strong><span>${state.google.configured ? "Login for Google Sheets" : "OAuth chưa cấu hình"}</span></div><button data-do="google-sign-in" ${!state.google.configured ? "disabled" : ""}>Login</button>`}${appUpdateControl()}</div></div>`;
}

app.addEventListener("click", async (event) => {
  const link = event.target.closest(".closure-sheet-link");
  if (!link) return;
  event.preventDefault();
  try {
    await window.spinePreview.openSheetLink(link.href.trim());
  } catch (error) {
    state.workspace.error = "Không mở được trình duyệt. Đóng app và chạy lại npm start để cập nhật chức năng mở link.";
    render();
  }
});

function workspaceSettings() {
  const w = state.workspace;
  const sheetUrl = String(w.sheetUrl || "").trim();
  const url = /^https:\/\/docs\.google\.com\/spreadsheets\//.test(sheetUrl) ? sheetUrl : "";
  return `<section class="workspace-settings"><div class="sheet-link-field"><span>Closure Sheet URL</span>${state.module === "catalog" ? `<p class="sheet-workflow-hint">Đây là sheet gốc. Trước khi ghi data vào sheet, nên bấm <strong>Clear all data</strong>. Sau khi tạo sheet, bấm <strong>Make a copy</strong> để tạo một sheet mới dùng cho closure.</p>` : ""}${url ? `<a class="closure-sheet-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)} <b aria-hidden="true">↗</b></a>` : `<p>Closure Sheet chưa được cấu hình trong bản build</p>`}</div></section>`;
}

function render() {
  document.body.dataset.module = state.module;
  const protectedFeatures = { catalog: "Tạo Sheet", upload: "Upload GIF", ownership: "Chuyển owner", notes: "Sổ tay animation" };
  if (protectedFeatures[state.module] && !state.google.signedIn) {
    app.innerHTML = `${appNav()}<main class="module-page"><header class="module-header"><div><h1>${protectedFeatures[state.module]}</h1></div></header>${featureLoginNotice()}${state.workspace.error ? `<div class="notice error">${esc(state.workspace.error)}</div>` : ""}</main>`;
    return;
  }
  if (state.module === "home") return renderHome();
  if (state.module === "export") return renderExporter();
  if (state.module === "upload") return renderUpload();
  if (state.module === "naming") return renderNaming();
  if (state.module === "notes") return renderAnimationNotes();
  if (state.module === "ownership") return renderOwnership();
  return renderCatalog();
}

function renderHome() {
  const features = [
    ["catalog", "01", "Tạo Sheet", "Scan Animation và UI_EN trên máy, dựng cấu trúc tab closure."],
    ["export", "02", "Tạo GIF", "Preview, trim và batch export Spine animation."],
    ["upload", "03", "Upload GIF", "Load Sheet, drag GIF vào từng row và upload."],
    ["ownership", "04", "Chuyển owner", "Bàn giao Sheet và folder asset cho tài khoản quản lý."],
    ["naming", "05", "Cảnh sát chính tả", "Kiểm tra folder, file và animation name trước handoff."],
    ["notes", "06", "Sổ tay animation", "Ghi cách gọi animation để dev tra cứu và implement nhanh hơn."],
  ];
app.innerHTML = `<main class="feature-home"><header><div class="app-logo"><img class="mascot-logo" src="${mascotIcon}" alt="Xóm Nhà Lá"><div><strong>Xóm Nhà Lá</strong><span>Bộ đồ nghề của cả xóm</span></div></div><div class="feature-account">${state.google.signedIn ? `<div><strong>${esc(state.google.user?.name || "Google Workspace")}</strong><span>${esc(state.google.user?.email || "")}</span></div><button data-do="google-sign-out">Sign out</button>` : `<div><strong>Google Workspace</strong><span>${state.google.configured ? "Login để dùng Google Sheets" : "Build chưa có OAuth Client ID"}</span></div><button data-do="google-sign-in" ${!state.google.configured ? "disabled" : ""}>Login</button>`}${appUpdateControl()}</div></header><section class="feature-hero"><small>NHỎ MÀ CÓ VÕ</small><h1>Chuyện gì cũng có tool.</h1></section><section class="feature-columns">${[["Closure", "Tạo tài liệu và hoàn tất bàn giao", features.slice(0, 4)], ["Handoff", "Kiểm tra asset và hướng dẫn implement", features.slice(4)]].map(([group, subtitle, items]) => `<section class="feature-category"><div class="feature-category-title"><h2>${group}</h2><p>${subtitle}</p></div><div class="feature-grid">${items.map(([id, number, title, description]) => `<button data-do="switch-module" data-module="${id}"><span class="feature-number">${number}</span><i class="feature-symbol" aria-hidden="true">${({ catalog: "▦", export: "▶", upload: "↥", naming: "Aa", ownership: "⇄", notes: "≡" })[id]}</i><div><h2>${title}</h2><p>${description}</p></div></button>`).join("")}</div></section>`).join("")}</section><footer class="app-credit">Powered by TiTi</footer></main>`;
}

function pageNotice() {
  const w = state.workspace;
  return `${w.error ? `<div class="notice error">${esc(w.error)}</div>` : ""}${w.message ? `<div class="notice ok">${esc(w.message)}</div>` : ""}`;
}

function confirmClearCatalog() {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "clear-catalog-confirm";
    let confirmed = false;
    dialog.innerHTML = `<h2>Xoá toàn bộ dữ liệu?</h2><p>Tất cả tab và dữ liệu trong Closure Sheet sẽ bị xoá. Sheet chỉ còn một tab trắng mặc định.</p><div class="module-actions"><button class="copy-sheet-action" data-cancel>Huỷ</button><button class="primary-action" data-confirm>Xác nhận</button></div>`;
    dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
    dialog.querySelector("[data-confirm]").onclick = () => { confirmed = true; dialog.close(); };
    dialog.addEventListener("close", () => { dialog.remove(); resolve(confirmed); }, { once: true });
    document.body.append(dialog); dialog.showModal(); dialog.querySelector("[data-cancel]").focus();
  });
}

function confirmOwnership(kind, email, url) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "upload-result-dialog ownership-confirm";
    let confirmed = false;
    dialog.innerHTML = `<div class="result-mascot"><img src="${mascotCaution}" alt="Bà cô nhắc cẩn thận"></div><h2>Thím nhắc con, bút sa gà chết, nhìn kỹ email trước khi bấm</h2><p class="result-detail">Bạn sắp chuyển quyền sở hữu ${kind === "sheet" ? "Sheet này" : "folder này và toàn bộ file/folder con"} sang:</p><strong class="owner-recipient">${esc(email)}</strong><p class="result-detail">Sau khi chuyển, bạn không còn là chủ sở hữu. Việc chuyển lại cần chủ sở hữu mới hoặc quản trị viên hỗ trợ.</p><div class="result-next-actions"><button class="copy-sheet-action" data-cancel>Huỷ</button><button class="primary-action" data-confirm>Xác nhận chuyển</button></div>`;
    dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
    dialog.querySelector("[data-confirm]").onclick = () => { confirmed = true; dialog.close(); };
    dialog.addEventListener("close", () => { dialog.remove(); resolve(confirmed); }, { once: true });
    document.body.append(dialog); dialog.showModal(); dialog.querySelector("[data-cancel]").focus();
  });
}

function showUploadResult(ok, detail, workflow = "catalog") {
  document.querySelector(".upload-result-dialog")?.close();
  const dialog = document.createElement("dialog");
  dialog.className = `upload-result-dialog ${ok ? "success" : "failure"}`;
  dialog.setAttribute("aria-label", ok ? "Upload thành công" : "Upload thất bại");
  const title = !ok ? "Tạch rồi con, làm lại đi" : workflow === "upload" ? "Vui chưa con, còn bước cuối nữa" : workflow === "export" ? "GIF xong rồi đó, upload tiếp đi con!" : "Chưa chắc giòn đâu, còn làm tiếp.";
  const destinations = workflow === "upload" ? [["ownership", "Chuyển Owner"]] : workflow === "export" ? [["upload", "Upload GIF"]] : [["export", "Tạo GIF"], ["upload", "Upload GIF"]];
  dialog.innerHTML = `<div class="result-mascot"><img src="${ok ? mascotSuccess : mascotFail}" alt="Chủ xóm"></div><p class="result-kicker">BÀ CÔ BÁO TIN</p><h2>${title}</h2><p class="result-detail">${esc(detail || "")}</p><div class="result-next-actions">${ok ? destinations.map(([id, label]) => `<button class="primary-action" data-result-module="${id}">${label}</button>`).join("") : `<button class="primary-action" data-result-close>Để con xem lại</button>`}</div>`;
  dialog.querySelectorAll("button").forEach((button) => {
    button.onclick = () => {
      dialog.close();
      if (button.dataset.resultModule) {
        state.workspace.message = ""; state.workspace.error = "";
        state.module = button.dataset.resultModule; render();
        if (state.module === "export" && state.source && !state.files.length) scan();
      }
    };
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog); dialog.showModal();
}

function featureLoginNotice() {
  if (state.google.signedIn) return "";
  const reasons = {
    catalog: "Đăng nhập Google công ty để scan asset, tạo và cập nhật Sheet.",
    upload: "Đăng nhập Google công ty để load Sheet và upload GIF.",
    ownership: "Đăng nhập Google công ty bằng tài khoản sở hữu Sheet và asset để chuyển owner.",
    notes: "Đăng nhập Google công ty để đọc database, scan Drive và lưu ghi chú animation.",
  };
  return `<aside class="feature-login-notice" role="status"><div><strong>Cần đăng nhập Google</strong><p>${reasons[state.module] || ""}</p>${!state.google.configured ? `<p>Bản build chưa được cấu hình Google OAuth.</p>` : ""}</div><button class="primary-action" data-do="google-sign-in" ${!state.google.configured || state.google.busy ? "disabled" : ""}>${state.google.busy ? "Đang đăng nhập…" : "Login Google"}</button></aside>`;
}

window.spinePreview.onCatalogScanProgress?.((message) => {
  if (!state.workspace.busy) return;
  state.workspace.message = message;
  if (state.module === "catalog") render();
});

function renderCatalog() {
  const w = state.workspace;
  const catalog = w.catalog;
  const sheetConfigured = state.google.signedIn && w.sheetUrl;
  const actions = `<div class="module-actions"><button class="danger-action" data-do="clear-catalog" ${!sheetConfigured || w.busy ? "disabled" : ""}>Clear all data</button><button class="copy-sheet-action" data-do="copy-sheet" ${!w.sheetUrl || w.busy ? "disabled" : ""}>Make a copy ↗</button></div>`;
  const hasSource = w.useUi && Boolean(w.sourceFolderUrl.trim());
  const sourceCard = hasSource ? `<article><header><div><b>SOURCE</b><span>Source PSD / Spine</span></div><div class="catalog-tab-actions"><strong>10</strong><button data-do="upload-source-tab" ${!sheetConfigured || w.busy ? "disabled" : ""}>Upload</button></div></header><ol><li><span>PSD</span><small>7 dòng</small></li><li><span>SPINE</span><small>3 dòng</small></li></ol></article>` : "";
  const preview = catalog
    ? `<div class="catalog-summary"><div><strong>${esc(catalog.rootName)}</strong><span>${catalog.tabs.length + (hasSource ? 1 : 0)} tabs · ${catalog.tabs.reduce((sum, tab) => sum + tab.items.length, 0)} items</span></div>${w.busy ? `<progress max="1" value="${w.progress}"></progress>` : ""}</div><div class="catalog-tabs">${sourceCard}${catalog.tabs.map((tab, tabIndex) => `<article><header><div><b>${esc(tab.title)}</b><span>${tab.source === "ui" ? "UI images" : "Animation assets"}</span></div><div class="catalog-tab-actions"><strong>${tab.items.length}</strong><button data-do="upload-catalog-tab" data-tab-index="${tabIndex}" ${!sheetConfigured || w.busy ? "disabled" : ""}>Upload</button></div></header><ol>${tab.items.slice(0, 8).map((item) => `<li><span>${esc(item.name)}</span>${item.group ? `<small>${esc(item.group)}</small>` : ""}</li>`).join("")}${tab.items.length > 8 ? `<li class="more">+${tab.items.length - 8} more</li>` : ""}</ol></article>`).join("")}</div>`
    : `<div class="module-empty"><b>${w.busy ? "Đang scan nguồn asset" : "Chưa có kết quả Scan"}</b><span>${w.busy ? "Tiến trình đang được cập nhật ở phía trên. Thời gian phụ thuộc số folder và tốc độ Drive." : "Tick Animation hoặc UI, nhập link Drive và chọn folder local tương ứng, rồi bấm Scan."}</span></div>`;
app.innerHTML = `${appNav()}<main class="module-page"><header class="module-header"><div><h1>Tạo Sheet</h1><p>Đọc cấu trúc Animation/UI_EN trên máy và tạo tab closure tự động.</p></div>${actions}</header>${featureLoginNotice()}${workspaceSettings()}<section class="drive-source catalog-sources">${[["useAnimation","animationPath","animationDrive","Animation"],["useUi","uiPath","uiDrive","UI"]].map(([toggle,key,drive,label]) => `<section class="catalog-source"><label class="catalog-source-toggle"><input type="checkbox" data-catalog-toggle="${toggle}" ${w[toggle] ? "checked" : ""} ${w.busy ? "disabled" : ""}> ${label}</label><div class="catalog-source-option"><label><span class="source-label">Link Drive · lấy link folder cho sheet <button type="button" class="source-info" aria-label="Thông tin nguồn Drive">i<span class="source-info-tooltip" role="tooltip">Drive chỉ dùng để tìm link folder tương ứng và ghi vào cột Folder trên Sheet. App không tải JSON hay ảnh từ Drive.</span></button></span><input data-workspace="${drive}" value="${esc(w[drive])}" ${!w[toggle] || w.busy ? "disabled" : ""}></label></div><div class="catalog-source-option"><label><span class="source-label">Local · nguồn thông tin và upload ảnh lên sheet <button type="button" class="source-info" aria-label="Thông tin nguồn Local">i<span class="source-info-tooltip" role="tooltip">App scan thông tin asset từ local và điều chỉnh size, quality ảnh thành thumbnail để upload lên Sheet. Tên folder local cần khớp với Drive.</span></button></span></label><div class="catalog-source-path"><input data-workspace="${key}" value="${esc(w[key])}" ${!w[toggle] || w.busy ? "disabled" : ""}><button data-do="pick-catalog-source" data-source="${key}" ${!w[toggle] || w.busy ? "disabled" : ""}>Browse</button></div></div>${toggle === "useUi" ? `<div class="catalog-source-option"><label><span>Link folder source · không bắt buộc</span><input data-workspace="sourceFolderUrl" value="${esc(w.sourceFolderUrl)}" placeholder="Link folder Drive chứa source PSD / Spine" ${!w[toggle] || w.busy ? "disabled" : ""}></label></div>` : ""}</section>`).join("")}<div class="module-actions catalog-scan-actions"><button data-do="scan-local" ${w.busy || !(w.useAnimation || w.useUi) || (w.useAnimation && (!w.animationPath || !w.animationDrive)) || (w.useUi && (!w.uiPath || !w.uiDrive)) ? "disabled" : ""}>${w.busy && !w.catalogOperation ? "Scanning…" : "Scan"}</button><button class="primary-action" data-do="create-catalog" ${!catalog || !sheetConfigured || w.busy ? "disabled" : ""}>Create / Update Sheet</button>${w.catalogOperation ? `<button class="copy-sheet-action" data-do="cancel-catalog" ${w.catalogCancelled ? "disabled" : ""}>${w.catalogCancelled ? "Đang huỷ…" : "Cancel"}</button>` : ""}</div></section>${pageNotice()}<section class="catalog-preview">${preview}</section></main>`;
}

function renderUpload() {
  const w = state.workspace;
  const sheet = w.sheet;
  const selectedCount = w.uploadRows.filter((row) => row.file).length;
  const canUpload = selectedCount && state.google.signedIn && w.sheetUrl && !w.busy;
  const rows = w.uploadRows.length
    ? `<div class="upload-head"><span>#</span><span>Animation item</span><span>GIF file</span></div>${w.uploadRows.map((row, index) => `<div class="upload-row ${row.status || ""}" data-upload-index="${index}"><span>${esc(row.index)}</span><div><b>${esc(row.name)}</b><small>${esc(row.sheetName || sheet.selected)} · Row ${row.rowNumber} · Demo ${esc(row.demoCell || `C${row.rowNumber}`)}</small></div><button class="file-drop ${row.file ? "has-file" : ""}" data-do="pick-upload-file"><input type="file" accept="image/gif" data-upload-file="${index}"><strong>${row.file ? esc(row.file.name) : "Drop GIF or choose file"}</strong><span>${row.status === "done" ? "Uploaded" : row.status === "uploading" ? "Queued / uploading…" : row.status === "failed" ? "Failed" : row.file ? `✓ Đã chọn GIF · ${Math.round(row.file.size / 1024)} KB · Bấm để đổi` : "GIF only"}</span></button>${row.file ? `<button class="remove-upload-gif" data-do="remove-upload-gif" data-index="${index}" title="Bỏ GIF đã chọn" aria-label="Bỏ GIF đã chọn" ${w.busy ? "disabled" : ""}>×</button>` : ""}</div>`).join("")}`
    : `<div class="module-empty"><b>Chưa có animation rows</b><span>Closure Sheet được cấu hình sẵn trong bản build; bấm Load Sheet để bắt đầu.</span></div>`;
  app.innerHTML = `${appNav()}<main class="module-page"><header class="module-header"><div><h1>Upload GIF</h1><p>Load animation rows, gắn GIF và upload qua queue tự động.</p></div><div class="module-actions"><button class="primary-action" data-do="upload-all" ${canUpload ? "" : "disabled"}>Upload ${selectedCount || ""} GIF</button>${w.uploadingGifs ? `<button class="copy-sheet-action" data-do="cancel-catalog" ${w.catalogCancelled ? "disabled" : ""}>${w.catalogCancelled ? "Đang huỷ…" : "Cancel"}</button>` : ""}</div></header>${featureLoginNotice()}${workspaceSettings()}<section class="upload-controls"><button data-do="load-sheet" ${!state.google.signedIn || !w.sheetUrl || w.busy ? "disabled" : ""}>${w.busy ? "Loading…" : "Load Sheet"}</button></section>${sheet ? `<section class="upload-folder-controls"><label class="batch-gif-picker"><span>Folder GIF · dùng chung GIF output</span><div class="upload-output-path"><input readonly value="${esc(state.output)}" placeholder="Chọn GIF output trong trang Tạo GIF"><button data-do="output" ${w.busy ? "disabled" : ""}>Browse</button><button data-do="scan-upload-output" ${!state.output || w.busy ? "disabled" : ""}>Scan</button></div></label></section>` : ""}${pageNotice()}${w.busy ? `<div class="upload-progress"><span style="width:${Math.max(0.02, w.progress) * 100}%"></span></div>` : ""}<section class="upload-list">${rows}</section></main>`;
}

app.addEventListener("input", (event) => {
  const t = event.target;
  if (t.dataset.noteIndex !== undefined) { state.notes.rows[Number(t.dataset.noteIndex)].note = t.value; state.notes.dirty = true; }
  if (t.dataset.noteGeneral) { state.notes.rows.filter((row) => row.fileId === t.dataset.noteGeneral).forEach((row) => { row.general = t.value; }); state.notes.dirty = true; }
  if (t.dataset.noteIndex !== undefined || t.dataset.noteGeneral) state.notes.revision += 1;
});

async function loadNotesGames() {
  const n = state.notes;
  n.initialized = true; n.busy = true;
  try {
    const result = await window.spinePreview.animationNotes("games", {});
    if (!result?.ok) throw new Error(result?.error || "Không load được database.");
    n.games = result.games;
  } catch (error) { n.error = error.message; }
  finally { n.busy = false; if (state.module === "notes") render(); }
}

window.spinePreview.onAnimationNotesProgress?.((message) => {
  const progress = app.querySelector("[data-notes-progress]");
  if (progress) progress.textContent = message;
});

function positionNotesPopover(button) {
  const popover = button.querySelector(".note-popover");
  if (!popover) return;
  const anchor = button.getBoundingClientRect();
  const edge = 16;
  popover.style.position = "fixed";
  popover.style.bottom = "auto";
  popover.style.left = "0px";
  popover.style.top = "0px";
  const box = popover.getBoundingClientRect();
  const left = Math.max(edge, Math.min(anchor.left, window.innerWidth - box.width - edge));
  const above = anchor.top - box.height - 10;
  const top = above >= edge ? above : Math.min(anchor.bottom + 10, Math.max(edge, window.innerHeight - box.height - edge));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}
app.addEventListener("pointerover", (event) => {
  const button = event.target.closest(".spine-note-button");
  if (button) positionNotesPopover(button);
});
app.addEventListener("focusin", (event) => {
  const button = event.target.closest(".spine-note-button");
  if (button) positionNotesPopover(button);
});
window.addEventListener("scroll", () => {
  const button = app.querySelector(".spine-note-button:hover, .spine-note-button:focus-visible");
  if (button) positionNotesPopover(button);
}, true);

function renderAnimationNotes() {
  const n = state.notes;
  if (!n.initialized && state.google.signedIn) loadNotesGames();
  const notesDatabaseLink = /^https:\/\/docs\.google\.com\/spreadsheets\//.test(n.sheetUrl) ? `<section class="workspace-settings"><div class="sheet-link-field"><span>Sheet database gốc</span><a class="closure-sheet-link" href="${esc(n.sheetUrl)}" target="_blank" rel="noopener noreferrer">${esc(n.sheetUrl)} <b aria-hidden="true">↗</b></a></div></section>` : "";
  const groups = new Map();
  n.rows.forEach((row, index) => { if (!groups.has(row.fileId)) groups.set(row.fileId, []); groups.get(row.fileId).push({ row, index }); });
  app.innerHTML = `${appNav()}<main class="module-page"><header class="module-header"><div><h1>Sổ tay animation</h1><p>Hướng dẫn gọi animation cho dev · mỗi game một tab database.</p></div></header>${featureLoginNotice()}${notesDatabaseLink}<section class="notes-guidance"><h2>Khi nào cần ghi chú?</h2><p class="notes-guidance-question">Bạn có thể ghi chú các Spine đặc thù của game xuất hiện ở giao diện nào và khi nào. Các animation thông dụng có thể để trống.</p></section><section class="workspace-settings notes-new-game"><div class="notes-new-game-heading"><h2>Tạo game mới / cập nhật asset</h2><p>Nhập folder Drive và game ID để tạo tab mới hoặc cập nhật danh sách animation cho game đã có.</p></div><label><span>Folder Drive</span><input data-notes-field="driveUrl" value="${esc(n.driveUrl)}" ${n.busy ? "disabled" : ""}></label><label><span>Game ID · tên tab</span><input data-notes-field="gameId" value="${esc(n.gameId)}" ${n.busy ? "disabled" : ""}></label><div class="module-actions"><button class="copy-sheet-action" data-do="notes-scan" ${n.busy || !n.driveUrl || !n.gameId || !state.google.signedIn ? "disabled" : ""}>Scan</button></div></section><section class="workspace-settings notes-database-controls"><div class="notes-games-field"><span>Game có sẵn trên database</span><div class="notes-game-list">${n.games.map((id) => `<button class="notes-game-button ${id === n.gameId ? "selected" : ""}" data-do="choose-notes-game" data-game="${esc(id)}" ${n.busy || n.saving ? "disabled" : ""}>${esc(id)}</button>`).join("")}</div></div></section><section class="catalog-preview">${n.busy ? `<div class="notice" data-notes-progress>Đang xử lý…</div>` : ""}${n.error ? `<div class="notice error">${esc(n.error)}</div>` : ""}<div class="notes-spine-list">${Array.from(groups.values()).map((items) => { const noted = items.filter(({row}) => row.note?.trim()); const general = items[0].row.general?.trim(); return `<button class="note-chip spine-note-button ${noted.length || general ? "noted" : ""}" data-do="open-spine-notes" data-index="${items[0].index}"><strong>${esc(items[0].row.name)}</strong>${noted.length || general ? `<span class="note-popover">${general ? `<span class="note-preview-line"><b>Ghi chú Spine</b><span>${esc(general)}</span></span>` : ""}${noted.map(({row}) => `<span class="note-preview-line"><b>${esc(row.animation)}</b><span>${esc(row.note)}</span></span>`).join("")}</span>` : ""}</button>`; }).join("")}</div></section></main>`;
}

function chooseDriveFolder() {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "drive-folder-dialog";
    let trail = [{id:"shared",name:"Được chia sẻ với tôi"}], folders = [], nextPage = "", busy = false, error = "", search = "";
    dialog.addEventListener("close", () => { dialog.remove(); resolve(dialog.returnValue || ""); }, {once:true});
    dialog.addEventListener("click", (event) => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    function paint() {
      const current = trail[trail.length - 1];
      dialog.innerHTML = `<header><h2 id="drive-picker-title">Chọn folder Drive</h2><button data-close aria-label="Đóng">×</button></header><form class="drive-picker-search"><input aria-label="Tìm tên folder" placeholder="Tìm folder trong ${trail.length === 1 ? "Được chia sẻ với tôi" : "folder hiện tại"}…" value="${esc(search)}"><button class="copy-sheet-action" type="submit" ${busy ? "disabled" : ""}>Tìm</button></form><nav class="drive-picker-breadcrumb" aria-label="Đường dẫn folder">${trail.map((folder,index) => `<button data-crumb="${index}" ${busy ? "disabled" : ""}>${esc(folder.name)}</button>`).join("<span>›</span>")}</nav><div class="drive-picker-list" aria-busy="${busy}">${error ? `<p class="drive-picker-error" role="alert">${esc(error)}</p>` : ""}${folders.map((folder,index) => `<button data-folder="${index}" ${busy ? "disabled" : ""}>${icon("folder")}<span>${esc(folder.name)}</span><span>›</span></button>`).join("")}${busy ? `<p role="status">Đang tải folder…</p>` : !folders.length && !error ? `<p>${search ? "Không tìm thấy folder phù hợp." : "Không có folder con."}</p>` : ""}${nextPage ? `<button data-more ${busy ? "disabled" : ""}>Tải thêm folder</button>` : ""}</div><div class="drive-picker-actions"><span>${current.id === "shared" ? "Mở một folder để chọn." : `Folder đang chọn: ${esc(current.name)}`}</span><div><button class="copy-sheet-action" data-close>Huỷ</button><button class="primary-action" data-select ${busy || error || current.id === "shared" ? "disabled" : ""}>Chọn folder này</button></div></div>`;
    }
    async function load(more = false) {
      busy = true; error = ""; if (!more) { folders = []; nextPage = ""; } paint();
      try {
        const result = await window.spinePreview.browseDriveFolders({folderId:trail[trail.length - 1].id,pageToken:more ? nextPage : "", search});
        if (!result?.ok) throw new Error(result?.error || "Không tải được folder Drive.");
        folders.push(...(result.files || [])); nextPage = result.nextPageToken || "";
      } catch (err) { error = err.message; }
      finally { busy = false; if (dialog.open) paint(); }
    }
    dialog.addEventListener("submit", (event) => {
      event.preventDefault(); if (busy) return;
      search = dialog.querySelector(".drive-picker-search input").value.trim(); load();
    });
    dialog.addEventListener("click", (event) => {
      const button = event.target.closest("button"); if (!button || button.disabled) return;
      if (button.hasAttribute("data-close")) { dialog.close(); return; }
      if (busy) return;
      if (button.hasAttribute("data-select")) dialog.close(`https://drive.google.com/drive/folders/${trail[trail.length - 1].id}`);
      else if (button.dataset.root) { trail = [{id:button.dataset.root,name:button.dataset.root === "root" ? "Drive của tôi" : "Được chia sẻ với tôi"}]; load(); }
      else if (button.dataset.crumb !== undefined) { trail = trail.slice(0,Number(button.dataset.crumb)+1); search = ""; load(); }
      else if (button.dataset.folder !== undefined) { trail.push(folders[Number(button.dataset.folder)]); search = ""; load(); }
      else if (button.hasAttribute("data-more")) load(true);
    });
    dialog.setAttribute("aria-labelledby", "drive-picker-title");
    document.body.append(dialog); paint(); dialog.showModal(); load();
  });
}

function renderOwnership() {
  const o = state.ownership;
  app.innerHTML = `${appNav()}<main class="module-page"><header class="module-header"><div><h1>Chuyển owner</h1><p>Chuyển Sheet hoặc folder asset sang tài khoản quản lý cùng công ty.</p></div></header>${featureLoginNotice()}<section class="workspace-settings ownership-form"><label><span>Email chủ sở hữu mới · dùng chung</span><div class="owner-email-control"><input data-owner-field="email" type="email" required value="${esc(o.email)}" ${!o.editingEmail ? "readonly" : ""} ${o.busy ? "disabled" : ""}><button type="button" class="copy-sheet-action" data-do="${o.editingEmail ? "lock-owner-email" : "edit-owner-email"}" ${o.busy ? "disabled" : ""}>${o.editingEmail ? "Lưu" : "Edit"}</button></div></label></section>${[["sheet","sheetUrl","Google Sheet"],["folder","driveUrl","Folder Drive chứa asset"]].map(([kind,key,title]) => `<section class="workspace-settings ownership-form"><h2>${title}</h2><label><span>Đường dẫn ${title}</span><input data-owner-field="${key}" value="${esc(o[key])}" ${o.busy ? "disabled" : ""}></label><div class="module-actions"><button class="primary-action" data-do="transfer-owner" data-kind="${kind}" ${o.busy || o.editingEmail || !o.email || !o[key] || !state.google.signedIn ? "disabled" : ""}>${o.busy && o.activeKind === kind ? "Đang chuyển…" : `Chuyển owner ${kind === "sheet" ? "sheet" : "folder"}`}</button>${o.busy && o.activeKind === kind ? `<button class="danger-action" data-do="cancel-transfer-owner" ${o.cancelling ? "disabled" : ""}>${o.cancelling ? "Đang dừng…" : "Cancel"}</button>` : ""}</div>${o.activeKind === kind ? `${o.busy ? `<div class="notice">${o.cancelling ? "Đang dừng sau mục hiện tại. Các mục đã chuyển vẫn giữ nguyên." : "Đang chuyển quyền. Có thể Cancel để dừng trước mục tiếp theo."}</div>` : ""}${o.message ? `<div class="notice ok">${esc(o.message)}</div>` : ""}${o.error ? `<div class="notice error">${esc(o.error)}</div>` : ""}${o.results.some((item) => item.ok && item.isFolder) ? `<div class="owner-transferred-folders"><h3>Folder đã chuyển thành công</h3><ul>${o.results.filter((item) => item.ok && item.isFolder).map((item) => `<li>${esc(item.displayPath || item.name)}</li>`).join("")}</ul></div>` : ""}` : ""}</section>`).join("")}<section class="workspace-settings ownership-form owner-move-section"><h2>Di chuyển Sheet vào folder</h2><p>Chọn Sheet và folder đích để di chuyển. Thao tác này không đổi owner.</p><label><span>Đường dẫn Google Sheet</span><input data-owner-field="moveSheetUrl" value="${esc(o.moveSheetUrl)}" ${o.busy ? "disabled" : ""}></label><label><span>Folder Drive đích</span><div class="owner-folder-picker"><input data-owner-field="moveFolderUrl" value="${esc(o.moveFolderUrl)}" ${o.busy ? "disabled" : ""}><button class="copy-sheet-action" data-do="pick-owner-drive-folder" ${o.busy ? "disabled" : ""}>Browse Drive</button></div></label><div class="module-actions"><button class="primary-action" data-do="move-sheet-folder" ${o.busy || !o.moveSheetUrl || !o.moveFolderUrl || !state.google.signedIn ? "disabled" : ""}>${o.busy && o.activeKind === "move" ? "Đang di chuyển…" : "Di chuyển sheet"}</button></div>${o.activeKind === "move" ? `${o.message ? `<div class="notice ok">${esc(o.message)}</div>` : ""}${o.error ? `<div class="notice error">${esc(o.error)}</div>` : ""}` : ""}</section></main>`;
}

function renderNaming() {
  const n = state.naming;
  n.issues = n.issues.filter((issue) => issue.type === "Animation" || !/\.meta$/i.test(String(issue.name || "").trim()));
  app.innerHTML = `${appNav()}<main class="module-page"><header class="module-header"><div><h1>Cảnh sát chính tả</h1><p>Kiểm tra khoảng trắng dư trong tên asset và ký tự đặc biệt ở đầu tên animation.</p></div><button class="primary-action" data-do="scan-naming" ${!n.folder || n.scanning ? "disabled" : ""}>${n.scanning ? "Checking…" : "Run Check"}</button></header><section class="naming-source"><label><span>Local asset folder</span><div><input data-naming-folder value="${esc(n.folder)}" placeholder="Chọn folder asset cần kiểm tra..."><button data-do="pick-naming-folder">Browse</button></div></label></section>${n.error ? `<div class="notice error">${esc(n.error)}</div>` : ""}<section class="naming-results">${n.issues.length ? `<div class="naming-head"><span>Type</span><span>Current name / path</span><span>Issues</span><span>Open</span></div>${n.issues.map((issue) => `<div class="naming-row"><b>${esc(issue.type)}</b><div><strong>${esc(issue.name)}</strong><small>${esc(issue.relativePath)}</small></div><span>${issue.reasons.map(esc).join(" · ")}</span><button class="naming-open" data-do="open-naming-folder" data-folder="${esc(issue.folderPath)}">Open ↗</button></div>`).join("")}` : `<div class="module-empty"><b>${n.folder ? "Chưa phát hiện naming issue" : "Chọn folder để kiểm tra"}</b><span>Tool không tự rename; chỉ report để team sửa an toàn.</span></div>`}</section></main>`;
}

function renderExporter() {
  const count = selected().length,
    total = state.files.reduce((n, f) => n + f.animations.length, 0),
    visible = visibleFiles();
  app.innerHTML = `${appNav()}<main class="exporter-page"><header class="module-header"><div><h1>Tạo GIF</h1><p>Chọn animation, chỉnh timeframe và xuất GIF cho closure.</p></div><div class="stats"><span><strong>${state.files.length}</strong> Spine</span><span><strong>${total}</strong> anim</span><span><strong>${count}</strong> selected</span></div></header>
  <section class="toolbar"><label><span>Source folder</span><div><input data-source value="${esc(state.source)}" placeholder="Folder chứa Spine..."><button data-do="source">${icon("folder")}</button></div></label><button class="scan" data-do="scan" ${state.scanning ? "disabled" : ""}>${state.scanning ? "Scanning…" : "Scan"}</button><i></i><label><span>GIF output</span><div><input data-output value="${esc(state.output)}" placeholder="Folder lưu GIF..."><button data-do="output">${icon("folder")}</button></div></label></section>
  ${state.error ? `<div class="notice error">${esc(state.error)}</div>` : ""}${state.status ? `<div class="notice ok">${esc(state.status)}</div>` : ""}
  <section class="batch-tools"><label><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg><input data-search value="${esc(state.search)}" placeholder="Search Spine hoặc animation..."></label><button class="clear-search ${state.search ? "" : "hidden"}" data-do="clear-search">Clear</button><span></span><button class="check-first" data-do="check-first" ${state.files.length ? "" : "disabled"}>Check All <b>${state.files.filter((file) => file.animations.length).length}</b></button><button class="uncheck-all" data-do="uncheck-all" ${count ? "" : "disabled"}>Uncheck all <b>${count || ""}</b></button></section>
<section class="gif-group-list">${state.gifGroups.map((group,index) => `<div><strong>${esc(group.name)}.gif</strong><span>${group.members.length} anim</span><button class="edit-gif-group" data-do="edit-gif-group" data-index="${index}" ${state.exporting ? "disabled" : ""}>Sửa tên</button><button title="Xoá nhóm, đưa item về Single" aria-label="Xoá nhóm" data-do="remove-gif-group" data-index="${index}" ${state.exporting ? "disabled" : ""}>×</button></div>`).join("")}</section>
  <section class="workspace"><div class="headrow"><span>Spine asset</span><span>Animations · chọn skin và animation để export</span></div><div class="groups">${visible.length ? visible.map(groupView).join("") : emptyView(Boolean(state.search))}</div></section>
  <footer><div class="progress"><div><span>${state.exporting ? esc(state.status) : `${count} animation ready`}</span><strong>${state.exporting ? `${Math.round(state.progress * 100)}%` : (state.exportMode !== "single") ? "GROUP · AUTO OPTIMIZE" : "AUTO CROP · MAX 0.5 MB"}</strong></div><aside><em style="width:${state.exporting ? state.progress * 100 : 0}%"></em></aside></div><label class="export-option"><span>All duration</span><select data-role="global-duration">${GLOBAL_DURATIONS.map((value) => `<option value="${value}" ${state.globalDuration === value ? "selected" : ""}>${value}s</option>`).join("")}</select></label><label class="export-option"><span>Object size</span><select data-role="object-size">${OBJECT_SIZES.map((value) => `<option value="${value}" ${state.objectSize === value ? "selected" : ""}>${value}%</option>`).join("")}</select></label><label class="export-option"><span>Padding</span><select data-role="crop-padding"><option value="4" ${state.cropPadding === 4 ? "selected" : ""}>4 px</option><option value="8" ${state.cropPadding === 8 ? "selected" : ""}>8 px</option><option value="16" ${state.cropPadding === 16 ? "selected" : ""}>16 px</option><option value="24" ${state.cropPadding === 24 ? "selected" : ""}>24 px</option></select></label>${state.gifGroups.length ? `<label class="export-option"><span>Object / row</span><select data-role="group-per-row">${[2, 3, 4, 5, 6].map((value) => `<option value="${value}" ${state.groupPerRow === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>` : ""}<div class="export-option gif-opt-option"><span>Opt</span><label class="checker-export"><input type="checkbox" data-role="optimize-gif" ${state.optimizeGif ? "checked" : ""}><span>Optimize</span></label></div><label class="export-option"><span>Background</span><select data-role="gif-background-mode" ${state.exporting ? "disabled" : ""}>${[["checker","Nền caro"],["transparent","Trong suốt"],["color","Màu nền"]].map(([value,label]) => `<option value="${value}" ${state.backgroundMode === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>${state.backgroundMode === "color" ? `<label class="export-option gif-color-option"><span>Màu nền</span><input type="color" data-role="gif-background-color" value="${state.backgroundColor}" aria-label="Chọn màu nền GIF" ${state.exporting ? "disabled" : ""}></label>` : ""}<button class="export" data-do="export" ${!count || state.exporting ? "disabled" : ""}>${icon("export")} ${state.exporting ? "Exporting…" : `Export GIF`}</button></footer>
  <aside class="preview ${state.active ? "open" : ""}"><div class="preview-title"><div><strong data-preview-name>Preview</strong><span>Loop theo đúng timeframe và skin đã chọn</span></div><div class="preview-actions"><button data-do="toggle-preview" title="Play/Pause">${state.previewPaused ? "▶" : "Ⅱ"}</button><button data-do="close" title="Đóng preview">×</button></div></div><div data-canvas class="canvas"></div>${previewTrimView()}</aside></main>`;
  mountStage();
}
function emptyView(searching = false) {
  return `<div class="empty">${icon("folder")}<h2>${searching ? "Không tìm thấy kết quả" : "Chưa có Spine nào"}</h2><p>${searching ? `Không có Spine hoặc animation khớp với “${esc(state.search)}”.` : "Chọn source folder và scan. Tool sẽ gom asset theo chiều dọc, mỗi Spine là một group animation."}</p></div>`;
}
function groupView(f, i) {
  return `<article class="group"><aside class="file"><small>${String(i + 1).padStart(2, "0")}</small><div><h2>${esc(f.fileName.replace(/\.json$/i, ""))}</h2><strong class="anim-count"><b>${f.animations.length}</b> animations</strong><div class="file-meta"><span>Spine ${esc(f.version)}</span></div></div></aside><section>${f.animations.map((a) => animView(f, a)).join("") || '<p class="none">Không có animation</p>'}</section></article>`;
}
function animView(f, a) {
  const c = configOf(f, a),
    d = durationOf(f, a),
    max = Math.max(d, c.end, 0.01),
    k = keyOf(f, a);
  const skinOptions = f.skins?.length
    ? f.skins
        .map(
          (skin) =>
            `<option value="${esc(skin)}" ${c.skin === skin ? "selected" : ""}>${esc(skin)}</option>`,
        )
        .join("")
    : '<option value="">Default</option>';
  return `<div class="anim ${c.selected ? "selected" : ""} ${state.active === k ? "active" : ""}" data-key="${esc(k)}"><label class="check" title="Chọn animation để export GIF"><input type="checkbox" data-role="select" ${c.selected ? "checked" : ""}><span></span></label><div class="anim-name"><b>◆</b><strong>${esc(a)}</strong></div><label class="skin"><span>Skin</span><select data-role="skin" ${f.skins?.length ? "" : "disabled"}>${skinOptions}</select></label><label class="anim-group-select"><span>Nhóm GIF</span><select data-role="anim-gif-group" ${state.exporting ? "disabled" : ""}><option value="">Single</option>${state.gifGroups.map((group,index) => `<option value="${index}" ${group.members.some((member) => member.key === k) ? "selected" : ""}>${esc(group.name)}</option>`).join("")}<option value="new">+ Tạo nhóm mới</option></select></label><div class="row-progress" data-trim-editor data-key="${esc(k)}"><div><span>${fmt(c.start)}</span><output>${fmt(c.end)}</output></div><section style="--a:${(c.start / max) * 100}%;--b:${(c.end / max) * 100}%"><i></i><b></b><input type="range" data-role="start" min="0" max="${max}" step=".01" value="${c.start}"><input type="range" data-role="end" min="0" max="${max}" step=".01" value="${c.end}"></section></div><button class="preview-row-btn" data-do="preview">Preview</button></div>`;
}

function previewTrimView() {
  const x = findItem(state.active);
  if (!x) return "";
  const c = x.config,
    max = Math.max(durationOf(x.file, x.animation), c.end, 0.01);
  return `<div class="preview-trim" data-trim-editor data-key="${esc(state.active)}"><div class="preview-trim-head"><span>Timeframe</span><output>${fmt(c.start)} — ${fmt(c.end)} <em>${fmt(c.end - c.start)}</em></output></div><div class="trim"><section style="--a:${(c.start / max) * 100}%;--b:${(c.end / max) * 100}%"><i></i><b></b><input type="range" data-role="start" min="0" max="${max}" step=".01" value="${c.start}"><input type="range" data-role="end" min="0" max="${max}" step=".01" value="${c.end}"></section></div><div class="times"><label>From<input data-role="start-number" type="number" min="0" max="${max}" step=".01" value="${c.start.toFixed(2)}"></label><label>To<input data-role="end-number" type="number" min="0" max="${max}" step=".01" value="${c.end.toFixed(2)}"></label></div></div>`;
}
function findItem(key) {
  return items().find((x) => keyOf(x.file, x.animation) === key);
}

async function scan() {
  if (!state.source.trim()) {
    state.error = "Chọn source folder trước.";
    render();
    return;
  }
  state.scanning = true;
  state.error = "";
  state.status = "";
  render();
  const r = await window.spinePreview.scanFolder(state.source.trim());
  state.scanning = false;
  if (r?.error) {
    state.error = r.error;
    state.files = [];
  } else {
    state.files = r.files || [];
    state.status = `Đã tìm thấy ${state.files.length} Spine asset.`;
    if (!state.output) state.output = state.source;
  }
  localStorage.setItem("gif-source", state.source);
  localStorage.setItem("gif-output", state.output);
  render();
}
function destroyStage() {
  cancelAnimationFrame(state.previewFrame);
  state.previewFrame = 0;
  state.stage?.destroy();
  state.stage = null;
  state.spine = null;
}

function startPreviewLoop(item, startTime = item.config.start) {
  cancelAnimationFrame(state.previewFrame);
  state.previewPaused = false;
  state.previewStartedAt =
    performance.now() - (startTime - item.config.start) * 1000;
  const tick = (now) => {
    if (
      !state.stage ||
      !state.spine ||
      state.active !== keyOf(item.file, item.animation)
    )
      return;
    if (!state.previewPaused) {
      const length = Math.max(0.01, item.config.end - item.config.start);
      const time =
        item.config.start + (((now - state.previewStartedAt) / 1000) % length);
      SpineStage.seek(state.spine, time);
      state.stage.renderOnce();
      state.previewPauseTime = time;
    }
    state.previewFrame = requestAnimationFrame(tick);
  };
  state.previewFrame = requestAnimationFrame(tick);
}
function syncPreviewBackground() {
  const box = app.querySelector("[data-canvas]");
  if (!box) return;
  box.style.backgroundImage = state.backgroundMode === "checker" ? "" : "none";
  box.style.backgroundColor = state.backgroundMode === "color" ? state.backgroundColor : state.backgroundMode === "transparent" ? "#111316" : "";
}
function mountStage() {
  syncPreviewBackground();
  if (state.stage && state.active) {
    const box = document.querySelector("[data-canvas]");
    if (box) {
      state.stage.setContainer(box);
      box.appendChild(state.stage.app.view);
      state.stage.syncViewportSize();
      state.stage.renderOnce();
    }
  }
}
function fit(stage, spine) {
  const b = spine.getLocalBounds(),
    v = stage.app.screen,
    s = Math.min(
      (v.width * 0.8) / Math.max(1, b.width),
      (v.height * 0.8) / Math.max(1, b.height),
    );
  spine.scale.set(clamp(s, 0.05, 8));
  stage.centerSpineAt(spine, v.width / 2, v.height / 2);
}
async function preview(key) {
  const x = findItem(key);
  if (!x) return;
  state.active = key;
  destroyStage();
  render();
  try {
    const box = document.querySelector("[data-canvas]"),
      stage = new SpineStage(box, {
        backgroundColor: 0x000000,
        backgroundAlpha: 0,
        resolution: 1,
      });
    stage.app.ticker.stop();
    const spine = await stage.loadSpine(x.file);
    if (x.config.skin) SpineStage.setSkin(spine, x.config.skin);
    SpineStage.playAnimation(spine, x.animation, false);
    SpineStage.seek(spine, x.config.start);
    fit(stage, spine);
    stage.renderOnce();
    state.stage = stage;
    state.spine = spine;
    startPreviewLoop(x);
    document.querySelector("[data-preview-name]").textContent =
      `${x.file.fileName.replace(/\.json$/i, "")} / ${x.animation}`;
  } catch (e) {
    state.error = e.message;
    destroyStage();
    render();
  }
}
function trim(editor, role, raw) {
  const x = findItem(editor.dataset.key);
  if (!x) return;
  const max = Math.max(durationOf(x.file, x.animation), x.config.end, 0.01),
    v = clamp(Number(raw) || 0, 0, max);
  if (role.startsWith("start"))
    x.config.start = Math.min(v, x.config.end - 0.01);
  else x.config.end = Math.max(v, x.config.start + 0.01);
  document.querySelectorAll("[data-trim-editor]").forEach((linkedEditor) => {
    if (linkedEditor.dataset.key !== editor.dataset.key) return;
    linkedEditor.querySelector("[data-role=start]").value = x.config.start;
    linkedEditor.querySelector("[data-role=end]").value = x.config.end;
    const startNumber = linkedEditor.querySelector("[data-role=start-number]");
    const endNumber = linkedEditor.querySelector("[data-role=end-number]");
    if (startNumber) startNumber.value = x.config.start.toFixed(2);
    if (endNumber) endNumber.value = x.config.end.toFixed(2);
    const output = linkedEditor.querySelector("output");
    if (output) {
      output.innerHTML = linkedEditor.classList.contains("row-progress")
        ? fmt(x.config.end)
        : `${fmt(x.config.start)} — ${fmt(x.config.end)} <em>${fmt(x.config.end - x.config.start)}</em>`;
    }
    const startLabel = linkedEditor.querySelector(".row-progress span");
    if (startLabel) startLabel.textContent = fmt(x.config.start);
    const bar = linkedEditor.querySelector(
      ".trim section, .row-progress section",
    );
    bar.style.setProperty("--a", `${(x.config.start / max) * 100}%`);
    bar.style.setProperty("--b", `${(x.config.end / max) * 100}%`);
  });
  if (state.active === editor.dataset.key && state.spine) {
    SpineStage.seek(
      state.spine,
      role.startsWith("start") ? x.config.start : x.config.end,
    );
    state.stage.renderOnce();
    state.previewStartedAt = performance.now();
  }
}

async function encode(x, n, total) {
  const host = document.createElement("div");
  host.className = "offscreen";
  document.body.append(host);
  const stage = new SpineStage(host, {
    backgroundColor: 0x000000,
    backgroundAlpha: 0,
    resolution: 1,
  });
  stage.app.ticker.stop();
  try {
    const spine = await stage.loadSpine(x.file);
    if (x.config.skin) SpineStage.setSkin(spine, x.config.skin);
    SpineStage.playAnimation(spine, x.animation, false);
    const frames = Math.max(
        2,
        Math.round((x.config.end - x.config.start) * FPS),
      ),
      samples = [];
    for (let i = 0; i < frames; i++) {
      const time =
        x.config.start +
        (i / Math.max(1, frames - 1)) * (x.config.end - x.config.start);
      SpineStage.seek(spine, time);
      const b = spine.getLocalBounds();
      samples.push({
        time,
        x: b.x,
        y: b.y,
        r: b.x + b.width,
        b: b.y + b.height,
      });
    }
    const u = samples.reduce(
        (q, b) => ({
          x: Math.min(q.x, b.x),
          y: Math.min(q.y, b.y),
          r: Math.max(q.r, b.r),
          b: Math.max(q.b, b.b),
        }),
        { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity },
      ),
      w = Math.max(1, u.r - u.x),
      h = Math.max(1, u.b - u.y),
      scale = Math.min(
        (SIZE * (renderObjectSize() / 100)) / w,
        (SIZE * (renderObjectSize() / 100)) / h,
      );
    spine.scale.set(clamp(scale, 0.05, 8));
    spine.position.set(
      SIZE / 2 - (u.x + w / 2) * spine.scale.x,
      SIZE / 2 - (u.y + h / 2) * spine.scale.y,
    );
    let pixelBounds = null;
    for (const sample of samples) {
      SpineStage.seek(spine, sample.time);
      stage.renderOnce();
      const bounds = visiblePixelBounds(
        stage.extractCanvasRegion(0, 0, SIZE, SIZE),
      );
      if (!bounds) continue;
      pixelBounds = pixelBounds
        ? {
            left: Math.min(pixelBounds.left, bounds.left),
            top: Math.min(pixelBounds.top, bounds.top),
            right: Math.max(pixelBounds.right, bounds.right),
            bottom: Math.max(pixelBounds.bottom, bounds.bottom),
          }
        : bounds;
    }
    const crop = expandCrop(pixelBounds, state.cropPadding, SIZE, SIZE);
    const bakeChecker = state.backgroundMode === "checker" || x.file.usesAdditiveBlend;
    const duration = Math.max(0.05, x.config.end - x.config.start);
    const encoded = await encodeWithinSize({
      duration,
      width: crop.width,
      height: crop.height,
      bakeChecker,
      backgroundColor: state.backgroundMode === "color" ? state.backgroundColor : null,
      renderFrame: async (elapsed) => {
        SpineStage.seek(spine, x.config.start + elapsed);
        stage.renderOnce();
        return stage.extractCanvasRegion(
          crop.x,
          crop.y,
          crop.width,
          crop.height,
        );
      },
      onProgress: (frame, frameCount, profileIndex) => {
        state.progress = (n + (frame + 1) / frameCount) / total;
        state.status = `${profileIndex ? "Optimizing · " : ""}${x.file.fileName.replace(/\.json$/i, "")} / ${x.animation}`;
        updateProgress();
      },
    });
    return {
      fileName: `${clean(x.file.fileName)}.gif`,
      dataBase64: bytesToBase64(encoded.bytes),
    };
  } finally {
    stage.destroy();
    host.remove();
  }
}

async function encodeCombined(list) {
  const width = 960,
    height = 540;
  const host = document.createElement("div");
  host.className = "offscreen";
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  document.body.append(host);
  const stage = new SpineStage(host, {
    backgroundColor: 0x000000,
    backgroundAlpha: 0,
    resolution: 1,
  });
  stage.app.ticker.stop();
  try {
    const loaded = [];
    const columns = Math.min(state.groupPerRow, list.length);
    const rows = Math.ceil(list.length / columns);
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      const spine = await stage.loadSpine(item.file);
      if (item.config.skin) SpineStage.setSkin(spine, item.config.skin);
      SpineStage.playAnimation(spine, item.animation, false);
      SpineStage.seek(spine, item.config.start);
      const bounds = spine.getLocalBounds();
      const scale = Math.min(
        ((cellWidth - state.cropPadding * 2) * (renderObjectSize() / 100)) /
          Math.max(1, bounds.width),
        ((cellHeight - state.cropPadding * 2) * (renderObjectSize() / 100)) /
          Math.max(1, bounds.height),
      );
      spine.scale.set(clamp(scale, 0.03, 8));
      const column = index % columns;
      const row = Math.floor(index / columns);
      stage.centerSpineAt(
        spine,
        column * cellWidth + cellWidth / 2,
        row * cellHeight + cellHeight / 2,
      );
      loaded.push({ item, spine });
    }
    const duration = Math.max(
      ...list.map((item) =>
        Math.max(0.05, item.config.end - item.config.start),
      ),
    );
    const frameCount = Math.max(2, Math.round(duration * FPS));
    let pixelBounds = null;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const elapsed = frame / FPS;
      loaded.forEach(({ item, spine }) => {
        const length = Math.max(0.01, item.config.end - item.config.start);
        SpineStage.seek(spine, item.config.start + (elapsed % length));
      });
      stage.renderOnce();
      const bounds = visiblePixelBounds(
        stage.extractCanvasRegion(0, 0, width, height),
      );
      if (!bounds) continue;
      pixelBounds = pixelBounds
        ? {
            left: Math.min(pixelBounds.left, bounds.left),
            top: Math.min(pixelBounds.top, bounds.top),
            right: Math.max(pixelBounds.right, bounds.right),
            bottom: Math.max(pixelBounds.bottom, bounds.bottom),
          }
        : bounds;
    }
    const crop = expandCrop(pixelBounds, state.cropPadding, width, height);
    const bakeChecker =
      state.backgroundMode === "checker" || list.some((item) => item.file.usesAdditiveBlend);
    const encoded = await encodeWithinSize({
      duration,
      width: crop.width,
      height: crop.height,
      bakeChecker,
      backgroundColor: state.backgroundMode === "color" ? state.backgroundColor : null,
      renderFrame: async (elapsed) => {
        loaded.forEach(({ item, spine }) => {
          const length = Math.max(0.01, item.config.end - item.config.start);
          SpineStage.seek(spine, item.config.start + (elapsed % length));
        });
        stage.renderOnce();
        return stage.extractCanvasRegion(
          crop.x,
          crop.y,
          crop.width,
          crop.height,
        );
      },
      onProgress: (frame, count, profileIndex) => {
        state.progress = (frame + 1) / count;
        state.status = `${profileIndex ? "Optimizing" : "Rendering group"} · ${frame + 1}/${count}`;
        updateProgress();
      },
    });
    return {
      fileName: "anim_group.gif",
      dataBase64: bytesToBase64(encoded.bytes),
    };
  } finally {
    stage.destroy();
    host.remove();
  }
}
function updateProgress() {
  const fill = document.querySelector("footer aside em"),
    label = document.querySelector(".progress span"),
    pct = document.querySelector(".progress strong");
  if (fill) fill.style.width = `${state.progress * 100}%`;
  if (label) label.textContent = state.status;
  if (pct) pct.textContent = `${Math.round(state.progress * 100)}%`;
}
async function exportAll() {
  const groupedKeys = new Set(state.gifGroups.flatMap((group) => group.members.map((member) => member.key)));
  const list = selected().filter((item) => !groupedKeys.has(keyOf(item.file, item.animation)));
  const activeGroups = state.gifGroups.map((group) => ({ ...group, members: group.members.filter((member) => findItem(member.key)?.config.selected) })).filter((group) => group.members.length);
  if (!list.length && !activeGroups.length) return;
  if (!state.output.trim()) {
    state.error = "Chọn folder output trước.";
    render();
    return;
  }
  state.exporting = true;
  state.error = "";
  state.status = "Đang chuẩn bị…";
  render();
  try {
    const files = [];
    if (list.length) {
      const names = new Map();
      for (let i = 0; i < list.length; i++) {
        const file = await encode(list[i], i, list.length);
        const count = (names.get(file.fileName) || 0) + 1;
        names.set(file.fileName, count);
        if (count > 1) file.fileName = file.fileName.replace(/\.gif$/i, `_${count}.gif`);
        files.push(file);
      }
    }
    for (const savedGroup of activeGroups) {
      const groupItems = savedGroup.members.map((member) => {
        const item = findItem(member.key);
        if (!item) throw new Error(`Nhóm ${savedGroup.name} có asset không còn trong kết quả Scan. Hãy tạo lại nhóm.`);
        return item;
      });
      const group = await encodeCombined(groupItems);
      const base = clean(savedGroup.name.trim().replace(/\.gif$/i, "")) || "anim_group";
      group.fileName = `${base}.gif`;
      let suffix = 2;
      while (files.some((file) => file.fileName.toLowerCase() === group.fileName.toLowerCase())) group.fileName = `${base}_${suffix++}.gif`;
      files.push(group);
    }
    if (state.optimizeGif) {
      for (let index = 0; index < files.length; index += 1) {
        state.status = `Optimizing GIF · ${index + 1}/${files.length}`;
        state.progress = (index + 1) / files.length;
        updateProgress();
        files[index] = await optimizeGifFile(files[index]);
      }
    }
    const r = await window.spinePreview.saveBatchGifs({
      outputDir: state.output.trim(),
      files,
    });
    if (!r?.ok) throw new Error(r?.error || "Không lưu được GIF.");
    state.status = `Đã export ${r.writtenFiles.length} GIF vào ${state.output}.`;
  } catch (e) {
    state.error = e.message || "Export GIF thất bại.";
    state.status = "";
  }
  state.exporting = false;
  state.progress = 0;
  render();
  if (!state.error) showUploadResult(true, state.status, "export");
}

app.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-do]");
  if (!b) {
    const row = e.target.closest(".anim");
    const isControl = e.target.closest(
      "input, select, button, label, [data-trim-editor]",
    );
    if (row && !isControl) {
      const item = findItem(row.dataset.key);
      if (item) {
        item.config.selected = !item.config.selected;
        render();
      }
    }
    return;
  }
  const a = b.dataset.do;
  if (a === "create-gif-group") {
    const chosen = b.dataset.key ? [findItem(b.dataset.key)].filter(Boolean) : [];
    if (!chosen.length || state.exporting) return;
    const dialog = document.createElement("dialog"); dialog.className = "note-dialog";
    dialog.innerHTML = `<form><h2>Tạo nhóm GIF</h2><p>${chosen.length} animation đã chọn</p><label>Tên file GIF<input class="gif-group-name" required value="nhom_${state.gifGroups.length + 1}"></label><div class="module-actions"><button type="button" class="copy-sheet-action" data-cancel>Huỷ</button><button type="submit" class="primary-action">Tạo nhóm</button></div></form>`;
    dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
    dialog.addEventListener("close", () => dialog.remove());
    dialog.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      const name = clean(dialog.querySelector("input").value.trim().replace(/\.gif$/i, ""));
      if (!name) return;
      const key = keyOf(chosen[0].file, chosen[0].animation);
      state.gifGroups.forEach((group) => { group.members = group.members.filter((member) => member.key !== key); });
      let group = state.gifGroups.find((group) => group.name.toLowerCase() === name.toLowerCase());
      if (!group) { group = { name, members: [] }; state.gifGroups.push(group); }
      group.members.push({ key }); chosen[0].config.selected = true;
      dialog.close(); render();
    };
    document.body.append(dialog); dialog.showModal(); dialog.querySelector("input").select();
  } else if (a === "edit-gif-group") {
    const group = state.gifGroups[Number(b.dataset.index)];
    if (!group || state.exporting) return;
    const dialog = document.createElement("dialog"); dialog.className = "note-dialog";
    dialog.innerHTML = `<form><h2>Đổi tên nhóm GIF</h2><label>Tên file GIF<input class="gif-group-name" required value="${esc(group.name)}"></label><p class="note-dialog-error" role="status"></p><div class="module-actions"><button type="button" class="copy-sheet-action" data-cancel>Huỷ</button><button type="submit" class="primary-action">Save</button></div></form>`;
    dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
    dialog.addEventListener("close", () => dialog.remove());
    dialog.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      const name = clean(dialog.querySelector("input").value.trim().replace(/\.gif$/i, ""));
      if (!name || state.gifGroups.some((other) => other !== group && other.name.toLowerCase() === name.toLowerCase())) {
        dialog.querySelector(".note-dialog-error").textContent = "Nhập tên hợp lệ và không trùng nhóm khác."; return;
      }
      group.name = name; dialog.close(); render();
    };
    document.body.append(dialog); dialog.showModal(); dialog.querySelector("input").select();
  } else if (a === "remove-gif-group") {
    if (!state.exporting) { state.gifGroups.splice(Number(b.dataset.index),1); render(); }
  } else if (a === "test-upload-success") {
    showUploadResult(true, "Đã upload xong tab: Symbols · 20 ảnh. Đây là thông báo thử.");
  } else if (a === "test-upload-fail") {
    showUploadResult(false, "Không kết nối được Google Sheets. Đây là thông báo thử, dữ liệu không bị thay đổi.");
  } else if (a === "choose-notes-game") {
    const n = state.notes;
    if (n.busy || n.saving) return;
    n.gameId = b.dataset.game; n.rows = []; n.busy = true; n.error = ""; n.message = ""; render();
    try {
      const result = await window.spinePreview.animationNotes("load", { gameId: n.gameId });
      if (!result?.ok) throw new Error(result?.error || "Không load được game.");
      n.rows = result.rows;
    } catch (error) { n.error = error.message; }
    finally { n.busy = false; render(); }
  } else if (a === "open-spine-notes") {
    const n = state.notes;
    const first = n.rows[Number(b.dataset.index)];
    if (!first) return;
    const dialog = document.createElement("dialog");
    dialog.className = "note-dialog";
    const items = n.rows.map((row, index) => ({ row, index })).filter(({row}) => row.fileId === first.fileId);
    dialog.innerHTML = `<form><h2>${esc(first.name)}</h2><label class="note-form-general">Ghi chú Spine<textarea rows="1" data-general-input>${esc(first.general || "")}</textarea></label><div class="note-form-animations">${items.map(({row,index}) => `<label class="note-form-row"><span>${esc(row.animation)}</span><textarea rows="1" data-anim-input="${index}">${esc(row.note || "")}</textarea></label>`).join("")}</div><div class="note-dialog-error" role="status"></div><div class="module-actions"><button type="button" class="copy-sheet-action" data-close>Cancel</button><button type="submit" class="primary-action">Save</button></div></form>`;
    dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog || n.saving) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    dialog.addEventListener("cancel", (event) => { if (n.saving) event.preventDefault(); });
    dialog.addEventListener("close", () => dialog.remove());
    dialog.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      if (n.saving) return;
      n.saving = true;
      dialog.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      const general = dialog.querySelector("[data-general-input]").value;
      const rows = items.map(({row,index}) => ({ ...row, general, note: dialog.querySelector(`[data-anim-input="${index}"]`).value }));
      try {
        const result = await window.spinePreview.animationNotes("save-spine", { gameId: n.gameId, fileId: first.fileId, rows });
        if (!result?.ok) throw new Error(result?.error === "Notes action không hợp lệ." ? "Phần lưu đang chạy phiên app cũ. Đóng app và chạy lại npm start để cập nhật." : result?.error || "Không lưu được ghi chú.");
        rows.forEach((edited) => { const target = n.rows.find((row) => row.fileId === edited.fileId && row.animation === edited.animation); if (target) Object.assign(target, edited); });
        n.message = ""; dialog.close();
      } catch (error) { dialog.querySelector(".note-dialog-error").textContent = error.message; }
      finally { n.saving = false; dialog.querySelectorAll("button").forEach((button) => { button.disabled = false; }); render(); }
    };
    document.body.append(dialog); dialog.showModal();
  } else if (a === "edit-note") {
    const n = state.notes;
    const row = n.rows[Number(b.dataset.index)];
    if (!row || n.busy || n.saving) return;
    const general = b.dataset.general === "true";
    const dialog = document.createElement("dialog");
    dialog.className = "note-dialog";
    dialog.innerHTML = `<form><h2>${esc(row.name)}</h2><p>${general ? "Ghi chú Spine" : esc(row.animation)}</p><textarea rows="1" aria-label="Ghi chú">${esc(general ? row.general : row.note)}</textarea><div class="note-dialog-error" role="status"></div><div class="module-actions"><button type="button" class="copy-sheet-action" data-close>Cancel</button><button type="submit" class="primary-action">Save</button></div></form>`;
    document.body.append(dialog); dialog.showModal();
    dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.addEventListener("close", () => dialog.remove());
    dialog.querySelector("form").onsubmit = async (event) => {
      event.preventDefault(); n.saving = true;
      const text = dialog.querySelector("textarea").value;
      dialog.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      try {
        const result = await window.spinePreview.animationNotes("save-note", { gameId: n.gameId, fileId: row.fileId, animation: row.animation, general, text });
        if (!result?.ok) throw new Error(result?.error || "Không lưu được ghi chú.");
        if (general) n.rows.filter((item) => item.fileId === row.fileId).forEach((item) => { item.general = text; });
        else row.note = text;
        n.dirty = false; n.message = ""; dialog.close();
      } catch (error) { dialog.querySelector(".note-dialog-error").textContent = error.message; }
      finally { n.saving = false; dialog.querySelectorAll("button").forEach((button) => { button.disabled = false; }); render(); }
    };
  } else if (a?.startsWith("notes-")) {
    const n = state.notes;
    if (n.busy || n.saving) return;
    const action = a.slice(6);
    if (action !== "save" && n.dirty && !window.confirm("Ghi chú chưa lưu. Tiếp tục sẽ bỏ thay đổi hiện tại?")) return;
    n.busy = true; n.error = ""; n.message = ""; render();
    try {
      const result = await window.spinePreview.animationNotes(action, { driveUrl: n.driveUrl, gameId: n.gameId, rows: n.rows });
      if (!result?.ok) throw new Error(result?.error || "Không xử lý được ghi chú.");
      n.rows = result.rows; n.dirty = false;
      if (action === "scan" || action === "save") {
        n.gameId = n.gameId.trim();
        n.games = [...new Set([...n.games, n.gameId])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      }
      n.message = action === "scan" ? `Đã cập nhật ${n.rows.length} anim vào tab ${n.gameId}, giữ nguyên ghi chú cũ.` : `Đã load ${n.rows.length} anim.`;
    } catch (error) { n.error = error.message; }
    finally { n.busy = false; render(); }
  } else if (a === "remove-upload-gif") {
    if (state.workspace.busy) return;
    const row = state.workspace.uploadRows[Number(b.dataset.index)];
    if (row) { row.file = null; row.status = ""; render(); }
  } else if (a === "scan-upload-output") {
    const w = state.workspace;
    w.busy = true; w.error = ""; render();
    try {
      const result = await window.spinePreview.scanUploadGifs(state.output);
      if (!result?.ok) throw new Error(result?.error || "Không đọc được folder GIF output.");
      const normalize = (name) => clean(String(name).replace(/\.(gif|json|skel|png)$/i, "")).toLowerCase();
      const files = new Map(); const duplicate = new Set();
      result.files.forEach((file) => { const key = normalize(file.name); if (files.has(key)) duplicate.add(key); else files.set(key, file); });
      let matched = 0;
      w.uploadRows.forEach((row) => { const key = normalize(row.name); if (!duplicate.has(key) && files.has(key)) { row.file = files.get(key); row.status = "ready"; matched += 1; } });
      w.message = `Tìm thấy ${result.files.length} GIF · đã map ${matched} hàng.${duplicate.size ? ` Bỏ qua ${duplicate.size} tên trùng.` : ""}`;
    } catch (error) { w.error = error.message; }
    finally { w.busy = false; render(); }
  } else if (a === "pick-owner-drive-folder") {
    if (state.ownership.busy) return;
    const folderUrl = await chooseDriveFolder();
    if (folderUrl) { state.ownership.moveFolderUrl = folderUrl; render(); }
  } else if (a === "move-sheet-folder") {
    const o = state.ownership;
    if (o.busy || !state.google.signedIn) return;
    o.busy = true; o.activeKind = "move"; o.message = ""; o.error = ""; render();
    try {
      const result = await window.spinePreview.moveSheetToFolder({ sheetUrl:o.moveSheetUrl, folderUrl:o.moveFolderUrl });
      if (!result?.ok) throw new Error(result?.error || "Không thể di chuyển Sheet. Kiểm tra quyền trên Sheet và folder đích.");
      o.message = `Đã di chuyển ${result.name} vào folder ${result.folderName}.`;
    } catch (error) { o.error = error.message; }
    finally { o.busy = false; render(); }
  } else if (a === "edit-owner-email") {
    if (state.ownership.busy) return;
    state.ownership.editingEmail = true; render();
    app.querySelector('[data-owner-field="email"]')?.focus();
  } else if (a === "lock-owner-email") {
    const input = app.querySelector('[data-owner-field="email"]');
    if (!input?.value.trim() || !input.reportValidity()) return;
    state.ownership.email = input.value.trim();
    localStorage.setItem("ownership-recipient-email", state.ownership.email);
    state.ownership.editingEmail = false; render();
  } else if (a === "cancel-transfer-owner") {
    const o = state.ownership;
    if (!o.busy || o.cancelling) return;
    o.cancelling = true; render();
    try { await window.spinePreview.cancelTransferOwnership(); }
    catch (error) { o.cancelling = false; o.error = error.message; render(); }
  } else if (a === "transfer-owner") {
    const o = state.ownership;
    const kind = b.dataset.kind;
    if (o.busy || !await confirmOwnership(kind, o.email, kind === "sheet" ? o.sheetUrl : o.driveUrl)) return;
    o.activeKind = kind;
    o.cancelling = false;
    o.busy = true; o.error = ""; o.message = ""; o.results = []; render();
    try {
      const result = await window.spinePreview.transferOwnership({ kind, sheetUrl: kind === "sheet" ? o.sheetUrl : "", driveUrl: kind === "folder" ? o.driveUrl : "", email: o.email });
      if (!result?.ok) throw new Error(result?.error || "Không chuyển được owner.");
      o.results = result.results;
      if (kind === "sheet" && !result.done && !result.cancelled) o.error = result.results.find((item) => !item.ok)?.error || "Không chuyển được Sheet.";
      o.message = kind === "folder" ? `Đã chuyển ${result.results.filter((item) => item.ok && item.isFolder).length} folder và ${result.results.filter((item) => item.ok && !item.isFolder).length} file sang ${o.email}. Các mục không có quyền được bỏ qua.` : `Đã chuyển ${result.done}/${result.total} Sheet sang ${o.email}.`;
      if (result.cancelled) o.message = `Đã dừng. ${result.done} mục đã chuyển trước khi dừng; các thay đổi này không được hoàn tác.`;
    } catch (error) { o.error = error.message; }
    finally { o.busy = false; o.cancelling = false; render(); }
  } else if (a === "open-naming-folder") {
    if (!b.dataset.folder || b.dataset.folder === "undefined") {
      state.naming.error = "Danh sách cũ chưa có đường dẫn Open. Chạy lại Run Check để cập nhật.";
      render();
      return;
    }
    const result = await window.spinePreview.openFolder(b.dataset.folder);
    if (!result?.ok) { state.naming.error = result?.error || "Không mở được folder."; render(); }
  } else if (a === "switch-module") {
    state.workspace.message = "";
    state.workspace.error = "";
    if (state.module === "export") destroyStage();
    state.module = b.dataset.module;
    render();
    if (state.module === "export" && state.source && !state.files.length) scan();
  } else if (a === "check-app-update") {
    await showAppUpdates();
  } else if (a === "back-home") {
    state.workspace.message = "";
    state.workspace.error = "";
    if (state.module === "export") destroyStage();
    state.module = "home";
    render();
  } else if (a === "google-sign-in") {
    state.google.busy = true;
    render();
    const result = await window.spinePreview.googleSignIn();
    state.google.busy = false;
    if (result?.ok) { state.google.signedIn = true; state.google.user = result.user; }
    else state.workspace.error = result?.error || "Đăng nhập Google thất bại.";
    render();
  } else if (a === "google-sign-out") {
    await window.spinePreview.googleSignOut();
    state.google.signedIn = false;
    state.google.user = null;
    state.module = "home";
    render();
  } else if (a === "pick-catalog-source") {
    const folder = await window.spinePreview.selectFolder();
    if (folder) {
      const key = b.dataset.source;
      const modeKey = key === "animationPath" ? "animationMode" : "uiMode";
      state.workspace[key + (state.workspace[modeKey] === "drive" ? "Drive" : "Local")] = state.workspace[key];
      state.workspace[modeKey] = "local";
      state.workspace[key + "Local"] = folder;
      state.workspace[key] = folder;
      localStorage.setItem(key === "animationPath" ? "closure-animation-path" : "closure-ui-path", folder);
      state.workspace.catalog = null; state.workspace.message = ""; render();
    }
  } else if (a === "pick-local-root") {
    const folder = await window.spinePreview.selectFolder();
    if (folder) {
      state.workspace.driveUrl = folder;
      state.workspace.catalog = null;
      state.workspace.message = "";
      state.workspace.error = "";
      localStorage.setItem("closure-local-root", folder);
      render();
    }
  } else if (a === "scan-local") {
    const w = state.workspace;
    w.catalog = null;
    const scanStartedAt = Date.now();
    w.busy = true; w.error = ""; w.message = "Đang kiểm tra nguồn Drive và folder local…";
    render();
    const result = await window.spinePreview.scanLocalCatalog("", { separateSources: true, hybrid: true, animationPath: w.animationPath, uiPath: w.uiPath, animationDrive:w.animationDrive, uiDrive:w.uiDrive, useAnimation: w.useAnimation, useUi: w.useUi });
    w.busy = false;
    if (result?.ok) {
      w.catalog = result;
      const seconds = Math.max(1, Math.round((Date.now() - scanStartedAt) / 1000));
      const duration = seconds >= 60 ? `${Math.floor(seconds / 60)} phút ${seconds % 60} giây` : `${seconds} giây`;
      const total = result.tabs.reduce((sum, tab) => sum + tab.items.length, 0);
      w.message = `Scan hoàn tất · ${result.tabs.length} tab · ${total} item · Tổng thời gian: ${duration}.`;
    }
    else w.error = result?.error || "Không scan được folder local.";
    render();
  } else if (a === "copy-sheet") {
    const id = String(state.workspace.sheetUrl || "").match(/\/spreadsheets\/d\/([\w-]+)/)?.[1];
    if (!id) return;
    try {
      await window.spinePreview.openSheetLink(`https://docs.google.com/spreadsheets/d/${id}/copy`);
    } catch (error) {
      state.workspace.error = error.message || "Không mở được trang tạo bản sao.";
      render();
    }
  } else if (a === "clear-catalog") {
    if (!await confirmClearCatalog()) return;
    const w = state.workspace;
    w.busy = true; w.error = ""; w.message = "";
    render();
    const result = await window.spinePreview.clearCatalog();
    w.busy = false;
    if (result?.ok) w.message = "Đã xoá toàn bộ dữ liệu và tab; Sheet hiện còn một tab trắng mặc định.";
    else w.error = result?.error || "Không thể xoá dữ liệu trong Sheet.";
    render();
  } else if (a === "cancel-catalog") {
    const w = state.workspace;
    if (!w.catalogOperation || w.catalogCancelled) return;
    w.catalogCancelled = true; render();
    const cancelled = await window.spinePreview.cancelCatalog(w.catalogOperation);
    if (!cancelled?.ok) { w.catalogCancelled = false; w.error = cancelled?.error || "Không thể huỷ. Hãy thử lại."; render(); }
  } else if (a === "create-catalog" || a === "upload-catalog-tab" || a === "upload-source-tab") {
    const w = state.workspace;
    if (w.busy || !w.catalog || !state.google.signedIn) return;
    const sourceOnly = a === "upload-source-tab";
    if (sourceOnly && (!w.useUi || !w.sourceFolderUrl.trim())) return;
    const tab = a === "upload-catalog-tab" ? w.catalog.tabs[Number(b.dataset.tabIndex)] : null;
    if (a === "upload-catalog-tab" && !tab) return;
    const uploadCatalog = { ...w.catalog, tabs: sourceOnly ? [] : tab ? [tab] : w.catalog.tabs, sourceFolderUrl: w.useUi && (sourceOnly || !tab) ? w.sourceFolderUrl.trim() : "" };
    const uploadStartedAt = Date.now();
    w.catalogOperation = crypto.randomUUID(); w.catalogCancelled = false;
    const uploadTabLabel = [...(uploadCatalog.sourceFolderUrl ? ["SOURCE"] : []), ...uploadCatalog.tabs.map((item) => item.title)].join(", ");
    w.busy = true; w.progress = 0; w.error = ""; w.message = `Đang cập nhật tab: ${uploadTabLabel}…`;
    render();
    const result = await window.spinePreview.createCatalog(w.sheetUrl, uploadCatalog, w.catalogOperation);
    if (!result?.ok) {
      w.error = result?.error || "Không tạo được Sheet catalog.";
    } else {
      const images = uploadCatalog.tabs.flatMap((tab) => [
        ...tab.items.map((item, index) => ({ ...item, tab: tab.title, row: index + 2, column: "C" })).filter((item) => item.kind === "image" || item.pngPaths?.length || item.driveImages?.length),
        ...(tab.views || []).map((item, index) => ({ ...item, tab: tab.title, row: index + 2, column: "I" })),
      ]);
      try {
        if (w.catalogCancelled) throw new Error("Đã huỷ Create / Update Sheet. Dữ liệu đã ghi vẫn được giữ lại.");
        if (images.length) {
          w.message = `Tab: ${uploadTabLabel} · Đang chuẩn bị ${images.length} ảnh…`;
          render();
          const queued = await window.spinePreview.queueImages({
            operationId: w.catalogOperation,
            spreadsheetId: result.spreadsheetId,
            images: images.map((item) => ({
              sheetName: item.tab,
              cell: `${item.column}${item.row}`,
              localPath: item.kind === "spine" ? undefined : item.localPath,
              localPaths: item.kind === "spine" ? item.pngPaths : item.previewPaths,
              driveImages: item.driveImages,
              kind: item.kind,
              fileName: item.name,
            })),
          });
          if (!queued?.ok) throw new Error(queued?.error || "Không tạo được image upload queue.");
          const completed = await waitForUploadQueue(queued.jobId, queued.total, result.spreadsheetId, uploadTabLabel);
          if (completed.error) throw new Error(completed.errors.slice(0, 3).join(" · "));
        }
        w.message = `Đã upload xong tab: ${uploadTabLabel} · ${images.length} ảnh.`;
      } catch (error) {
        w.error = error.message || String(error);
      }
    }
    await window.spinePreview.finishCatalog(w.catalogOperation);
    w.catalogOperation = null;
    w.busy = false; w.progress = 0;
    if (w.catalogCancelled) { w.error = ""; w.message = "Đã huỷ Create / Update Sheet. Dữ liệu đã ghi vẫn được giữ lại."; render(); return; }
    render();
    showUploadResult(!w.error, `${w.error || w.message}\nTổng thời gian xử lý: ${operationDuration(uploadStartedAt)}.`);
  } else if (a === "load-sheet") {
    const w = state.workspace;
    w.busy = true; w.error = ""; w.message = ""; render();
    const result = await window.spinePreview.loadClosureSheet(w.sheetUrl, "All animations");
    w.busy = false;
    if (result?.ok) { w.sheet = result; w.uploadRows = result.rows.map((row) => ({ ...row, file: null, status: "" })); w.message = `Đã load ${result.rows.length} items.`; }
    else w.error = result?.error || "Không load được Closure Sheet.";
    render();
  } else if (a === "pick-upload-file") {
    if (e.target.matches('input[type="file"]')) return;
    b.querySelector("input[type=file]")?.click();
  } else if (a === "upload-all") {
    const w = state.workspace;
    const uploadStartedAt = Date.now();
    const queue = w.uploadRows.filter((row) => row.file);
    if (w.busy || !queue.length) return;
    w.catalogOperation = crypto.randomUUID(); w.catalogCancelled = false; w.uploadingGifs = true;
    w.busy = true; w.error = ""; w.message = ""; w.progress = 0; render();
    try {
      w.message = `Preparing ${queue.length} GIF files…`; render();
      const images = [];
      for (let index = 0; index < queue.length; index += 1) {
        if (w.catalogCancelled) throw new Error("Đã huỷ upload GIF.");
        const row = queue[index];
        row.status = "ready";
        images.push({ sheetName: row.sheetName || w.sheet.selected, cell: row.demoCell || `C${row.rowNumber}`, fileName: row.file.name, mimeType: row.file.type || "image/gif", dataBase64: await fileToBase64(row.file) });
        w.progress = ((index + 1) / queue.length) * 0.1;
        render();
      }
      if (w.catalogCancelled) throw new Error("Đã huỷ upload GIF.");
      const queued = await window.spinePreview.queueImages({ operationId:w.catalogOperation, spreadsheetId: w.sheet.spreadsheetId, images });
      if (!queued?.ok) throw new Error(queued?.error || "Không tạo được GIF upload queue.");
      queue.forEach((row) => { row.status = "uploading"; });
      const completed = await waitForUploadQueue(queued.jobId, queued.total, w.sheet.spreadsheetId);
      queue.forEach((row) => { row.status = completed.error && completed.errors.some((message) => message.startsWith(row.file.name)) ? "failed" : "done"; });
      if (completed.error) w.error = completed.errors.slice(0, 3).join(" · ");
    } catch (error) {
      w.error = error.message || String(error);
    }
    await window.spinePreview.finishCatalog(w.catalogOperation);
    w.catalogOperation = null; w.uploadingGifs = false;
    w.busy = false;
    w.progress = 0;
    if (w.catalogCancelled) {
      queue.forEach((row) => { if (row.status !== "done") row.status = "ready"; });
      w.error = ""; w.message = `Đã huỷ upload GIF. Các GIF đã chèn vẫn được giữ lại. Tổng thời gian: ${operationDuration(uploadStartedAt)}.`;
      render(); return;
    }
    if (!w.error) w.message = `Completed · ${queue.length} GIF uploaded to ${w.sheet.selected}.`;
    render();
    showUploadResult(!w.error, `${w.error || `Đã upload ${queue.length} GIF lên Sheet.`}\nTổng thời gian xử lý: ${operationDuration(uploadStartedAt)}.`, "upload");
  } else if (a === "pick-naming-folder") {
    const folder = await window.spinePreview.selectFolder();
    if (folder) { state.naming.folder = folder; localStorage.setItem("naming-folder", folder); render(); }
  } else if (a === "scan-naming") {
    const n = state.naming;
    n.scanning = true; n.error = ""; render();
    const result = await window.spinePreview.scanNamingIssues(n.folder);
    n.scanning = false; n.issues = (result?.issues || []).filter((issue) => issue.type === "Animation" || !/\.meta$/i.test(String(issue.name || "").trim())); n.error = result?.error || ""; render();
  } else if (a === "source") {
    const v = await window.spinePreview.selectFolder();
    if (v) {
      state.source = v;
      if (!state.output) state.output = v;
      render();
    }
  } else if (a === "output") {
    const v = await window.spinePreview.selectExportFolder();
    if (v) {
      state.output = v;
      localStorage.setItem("gif-output", v);
      render();
    }
  } else if (a === "scan") scan();
  else if (a === "preview") preview(b.closest(".anim").dataset.key);
  else if (a === "toggle-preview") {
    const item = findItem(state.active);
    if (!item || !state.spine) return;
    state.previewPaused = !state.previewPaused;
    if (!state.previewPaused) {
      state.previewStartedAt =
        performance.now() - (state.previewPauseTime - item.config.start) * 1000;
    }
    b.textContent = state.previewPaused ? "▶" : "Ⅱ";
  } else if (a === "close") {
    state.active = "";
    destroyStage();
    render();
  } else if (a === "export") exportAll();
  else if (a === "uncheck-all") {
    items().forEach((item) => {
      item.config.selected = false;
    });
    render();
  } else if (a === "check-first") {
    items().forEach((item) => {
      item.config.selected = false;
    });
    state.files.forEach((file) => {
      const firstAnimation = file.animations.find((name) => name.toLowerCase().includes("idle")) || file.animations[0];
      if (firstAnimation) configOf(file, firstAnimation).selected = true;
    });
    render();
  } else if (a === "clear-search") {
    state.search = "";
    render();
    document.querySelector("[data-search]")?.focus();
  }
});
app.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.role === "gif-background-color") {
    state.backgroundColor = t.value;
    localStorage.setItem("gif-background-color", t.value);
    syncPreviewBackground();
    return;
  }
  if (["moveSheetUrl", "moveFolderUrl"].includes(t.dataset.ownerField)) {
    const o = state.ownership;
    o[t.dataset.ownerField] = t.value.trim();
    if (!o.busy && o.activeKind === "move") {
      o.error = ""; o.message = "";
      app.querySelectorAll(".owner-move-section .notice").forEach((notice) => notice.remove());
    }
    const button = app.querySelector('[data-do="move-sheet-folder"]');
    if (button) button.disabled = o.busy || !state.google.signedIn || !o.moveSheetUrl || !o.moveFolderUrl;
    return;
  }
  if (t.matches("[data-workspace]")) {
    const key = t.dataset.workspace;
    state.workspace[key] = t.value;
    if (["animationPath", "uiPath", "animationDrive", "uiDrive"].includes(key)) {
      const w = state.workspace;
      w.catalog = null; w.message = "";
      const scanButton = app.querySelector('[data-do="scan-local"]');
      if (scanButton) scanButton.disabled = w.busy || !(w.useAnimation || w.useUi) || (w.useAnimation && (!w.animationPath.trim() || !w.animationDrive.trim())) || (w.useUi && (!w.uiPath.trim() || !w.uiDrive.trim()));
    }
    localStorage.setItem(`closure-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`, t.value);
  } else if (t.matches("[data-naming-folder]")) {
    state.naming.folder = t.value;
    localStorage.setItem("naming-folder", t.value);
  } else if (t.matches("[data-source]")) state.source = t.value;
  else if (t.matches("[data-search]")) {
    state.search = t.value;
    const visible = visibleFiles();
    const groups = document.querySelector(".groups");
    if (groups) {
      groups.innerHTML = visible.length
        ? visible.map(groupView).join("")
        : emptyView(Boolean(state.search));
    }
    document
      .querySelector(".clear-search")
      ?.classList.toggle("hidden", !state.search);
  }
  else if (t.matches("[data-output]")) {
    state.output = t.value;
    localStorage.setItem("gif-output", t.value);
  } else if (t.matches("[data-role^=start],[data-role^=end]"))
    trim(t.closest("[data-trim-editor]"), t.dataset.role, t.value);
});
app.addEventListener("change", (e) => {
  if (e.target.dataset.role === "anim-gif-group") {
    const key = e.target.closest(".anim").dataset.key;
    const item = findItem(key);
    if (!item || state.exporting) return;
    if (e.target.value === "new") {
      const trigger = document.createElement("button"); trigger.dataset.do = "create-gif-group"; trigger.dataset.key = key; trigger.hidden = true;
      app.append(trigger); trigger.click(); trigger.remove(); return;
    }
    const group = e.target.value === "" ? null : state.gifGroups[Number(e.target.value)];
    state.gifGroups.forEach((candidate) => { candidate.members = candidate.members.filter((member) => member.key !== key); });
    if (group) { group.members.push({ key }); item.config.selected = true; }
    render(); return;
  }
  if (e.target.dataset.catalogPath) {
    const w = state.workspace, key = e.target.dataset.catalogPath, mode = e.target.dataset.pathMode;
    const modeKey = key === "animationPath" ? "animationMode" : "uiMode";
    w[key + (w[modeKey] === "drive" ? "Drive" : "Local")] = w[key];
    w[key + (mode === "drive" ? "Drive" : "Local")] = e.target.value.trim();
    w[modeKey] = mode; w[key] = e.target.value.trim();
    w.catalog = null; w.message = ""; render(); return;
  }
  if (e.target.dataset.catalogMode) {
    const w = state.workspace, modeKey = e.target.dataset.catalogMode;
    const key = modeKey === "animationMode" ? "animationPath" : "uiPath";
    w[key + (w[modeKey] === "drive" ? "Drive" : "Local")] = w[key];
    w[modeKey] = e.target.value;
    w[key] = w[key + (e.target.value === "drive" ? "Drive" : "Local")] || "";
    w.catalog = null; w.message = ""; render(); return;
  }
  if (["animationMode", "uiMode"].includes(e.target.dataset.workspace)) {
    const key = e.target.dataset.workspace;
    state.workspace[key] = e.target.value;
    state.workspace[key === "animationMode" ? "animationPath" : "uiPath"] = "";
    state.workspace.catalog = null; state.workspace.message = ""; render(); return;
  }
  if (e.target.dataset.catalogToggle) {
    state.workspace[e.target.dataset.catalogToggle] = e.target.checked;
    state.workspace.catalog = null; state.workspace.message = ""; render(); return;
  }
  const t = e.target,
    row = t.closest(".anim");
  if (t.matches("[data-notes-filter]")) { state.notes.onlyNoted = t.checked; render(); return; }
  if (t.matches("[data-notes-game]")) {
    const n = state.notes;
    if (n.busy || n.saving || !t.value) return;
    if (n.dirty) { n.error = "Chờ auto-save hoặc bấm Lưu trước khi đổi game."; render(); return; }
    n.gameId = t.value; n.busy = true; n.error = ""; render();
    window.spinePreview.animationNotes("load", { gameId: n.gameId }).then((result) => {
      if (!result?.ok) throw new Error(result?.error || "Không load được game.");
      n.rows = result.rows; n.message = `Đã load game ${n.gameId}.`;
    }).catch((error) => { n.error = error.message; }).finally(() => { n.busy = false; render(); });
    return;
  }
  if (t.dataset.notesField) {
    if (state.notes.dirty || state.notes.saving) { state.notes.error = "Lưu ghi chú trước khi đổi game hoặc folder."; render(); return; }
    if (t.dataset.notesField === "gameId" && state.notes.gameId !== t.value.trim()) state.notes.rows = [];
    state.notes[t.dataset.notesField] = t.value.trim();
    render(); return;
  }
  if (t.dataset.ownerField) {
    state.ownership[t.dataset.ownerField] = t.value.trim();
    // Keep the clicked action mounted when a changed URL input loses focus.
    if (["moveSheetUrl", "moveFolderUrl"].includes(t.dataset.ownerField)) return;
    if (t.dataset.ownerField === "email" && state.ownership.editingEmail) return;
    if (t.dataset.ownerField === "email" && t.validity.valid && t.value.trim()) localStorage.setItem("ownership-recipient-email", t.value.trim());
    render();
    return;
  }
  if (t.matches("[data-batch-gifs]")) {
    const normalize = (name) => clean(String(name).replace(/\.(gif|json|skel|png)$/i, "")).toLowerCase();
    const selectedFiles = Array.from(t.files || []).filter((file) => /\.gif$/i.test(file.name));
    const files = new Map();
    const duplicates = new Set();
    selectedFiles.forEach((file) => {
      const key = normalize(file.name);
      if (files.has(key)) duplicates.add(key);
      else files.set(key, file);
    });
    let matched = 0;
    state.workspace.uploadRows.forEach((item) => {
      const key = normalize(item.name);
      const file = duplicates.has(key) ? null : files.get(key);
      if (file) { item.file = file; item.status = "ready"; matched += 1; }
    });
    const folder = t.files?.[0]?.webkitRelativePath?.split("/")[0] || "folder";
    state.workspace.message = `${folder} · tìm thấy ${selectedFiles.length} GIF · đã map ${matched} hàng.${duplicates.size ? ` Bỏ qua ${duplicates.size} tên file trùng trong folder.` : ""} Các hàng không khớp giữ nguyên.`;
    render();
    return;
  }
  if (t.dataset.role === "closure-tab") {
    state.workspace.sheet.selected = t.value;
    window.spinePreview.loadClosureSheet(state.workspace.sheetUrl, t.value).then((result) => {
      if (result?.ok) { state.workspace.sheet = result; state.workspace.uploadRows = result.rows.map((item) => ({ ...item, file: null, status: "" })); }
      else state.workspace.error = result?.error || "Không load được tab.";
      render();
    });
    return;
  }
  if (t.matches("[data-upload-file]")) {
    const target = state.workspace.uploadRows[Number(t.dataset.uploadFile)];
    if (target && t.files?.[0]) { target.file = t.files[0]; target.status = "ready"; render(); }
    return;
  }
  if (t.dataset.role === "gif-background-mode") {
    state.backgroundMode = t.value;
    state.bakeChecker = t.value === "checker";
    localStorage.setItem("gif-background-mode", t.value);
    localStorage.setItem("gif-bake-checker", String(state.bakeChecker));
    render(); return;
  }
  if (t.dataset.role === "gif-background-color") {
    state.backgroundColor = t.value;
    localStorage.setItem("gif-background-color", t.value);
    syncPreviewBackground();
    return;
  }
  if (t.dataset.role === "bake-checker") {
    state.bakeChecker = t.checked;
    localStorage.setItem("gif-bake-checker", String(t.checked));
    return;
  }
  if (t.dataset.role === "optimize-gif") {
    state.optimizeGif = t.checked;
    localStorage.setItem("gif-optimize", String(t.checked));
    render();
    return;
  }
  if (t.dataset.role === "export-mode") {
    state.exportMode = t.value;
    state.combineSymbols = t.value !== "single";
    localStorage.setItem("gif-export-mode", t.value);
    render();
    return;
  }
  if (t.dataset.role === "group-file-name") {
    state.groupFileName = t.value;
    localStorage.setItem("gif-group-name", t.value);
    return;
  }
  if (t.dataset.role === "object-size") {
    state.objectSize = Number(t.value) || 80;
    localStorage.setItem("gif-object-size", String(state.objectSize));
    render();
    return;
  }
  if (t.dataset.role === "global-duration") {
    state.globalDuration = Number(t.value) || 1;
    localStorage.setItem("gif-global-duration", String(state.globalDuration));
    items().forEach((item) => {
      item.config.end = item.config.start + state.globalDuration;
    });
    render();
    return;
  }
  if (t.dataset.role === "crop-padding") {
    state.cropPadding = Number(t.value) || 8;
    localStorage.setItem("gif-crop-padding", String(state.cropPadding));
    render();
    return;
  }
  if (t.dataset.role === "group-per-row") {
    state.groupPerRow = clamp(Number(t.value) || 5, 2, 6);
    localStorage.setItem("gif-group-per-row", String(state.groupPerRow));
    render();
    return;
  }
  if (!row) return;
  const x = findItem(row.dataset.key);
  if (t.dataset.role === "select") {
    x.config.selected = t.checked;
    render();
  } else if (t.dataset.role === "skin") {
    x.config.skin = t.value;
    if (state.active === row.dataset.key) preview(row.dataset.key);
  }
});
app.addEventListener("dragover", (event) => {
  const drop = event.target.closest(".file-drop");
  if (!drop) return;
  event.preventDefault();
  drop.classList.add("dragging");
});
app.addEventListener("dragleave", (event) => {
  event.target.closest(".file-drop")?.classList.remove("dragging");
});
app.addEventListener("drop", (event) => {
  const drop = event.target.closest(".file-drop");
  if (!drop) return;
  event.preventDefault();
  drop.classList.remove("dragging");
  const row = drop.closest("[data-upload-index]");
  const file = event.dataTransfer?.files?.[0];
  if (!row || !file || file.type !== "image/gif") return;
  const target = state.workspace.uploadRows[Number(row.dataset.uploadIndex)];
  if (target) { target.file = file; target.status = "ready"; render(); }
});
window.addEventListener("resize", () => {
  if (state.stage) {
    state.stage.syncViewportSize();
    fit(state.stage, state.spine);
    state.stage.renderOnce();
  }
});
// Keep the static splash visible while the workspace session initializes.
let bootFinished = false;
const bootStartedAt = Date.now();
const finishBoot = () => {
  const remaining = 2000 - (Date.now() - bootStartedAt);
  if (remaining > 0) { setTimeout(finishBoot, remaining); return; }
  if (!bootFinished) { bootFinished = true; render(); }
};
const bootTimeout = setTimeout(finishBoot, 6000);
window.spinePreview.appUpdateState?.().then((value) => {
  updateState = value;
  app.querySelectorAll("[data-app-version]").forEach((label) => { label.textContent = value.current ? `v${value.current}` : ""; });
}).catch(() => {});
window.spinePreview.googleStatus().then((result) => {
  state.google.configured = Boolean(result?.configured);
  state.google.signedIn = Boolean(result?.signedIn);
  state.google.user = result?.user || null;
  state.workspace.sheetUrl = result?.workspace?.sheetUrl || "";
  state.notes.sheetUrl = result?.workspace?.notesSheetUrl || "";
  if (bootFinished) render();
}).catch(() => {
  // Offline users can still export GIFs and check local asset names.
}).finally(() => { clearTimeout(bootTimeout); finishBoot(); });
