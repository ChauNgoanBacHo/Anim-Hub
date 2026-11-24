# Cấu trúc source và luồng dữ liệu

Cập nhật theo source 17/11/2026. Đây là app nhiều feature, không còn là app preview/sound/export Spine package theo thiết kế ban đầu.

## Source map

```text
src/
  main.js              Electron lifecycle, scan local, asset server, filesystem IPC
  preload.js           contextBridge: window.spinePreview
  renderer.js          state, HTML templates, events, dialogs, GIF encoding
  index.css            theme, layout feature, dialog/popover và responsive
  spineStage.js        PixiJS + pixi-spine adapter
  appUpdater.js        signed updater Windows/macOS, download, staging, helper IPC
  googleWorkspace.js   OAuth, Sheets/Drive API, queue, notes, owner, folder picker
  shared/assetUrl.js   helper URL asset local
apps-script/
  Code.gs              time-trigger worker nhúng image/GIF
  appsscript.json      manifest quyền worker
assets/                icon, mascot, font và license
index.html             bootstrap renderer và splash
forge.config.js        Electron packaging/makers/plugins
vite.*.config.mjs      build main/preload/renderer, env defines
.github/workflows/     Windows CI và public release Windows/macOS
render-icon.cjs        helper tạo icon app
```

Kiểm tra tên config thực tế trong repo khi chỉnh build. `renderer.js` hiện là module lớn dùng JavaScript/template strings và event delegation; chưa tách component framework. CSS có nhiều override theo thứ tự, nên scope thay đổi theo feature và kiểm tra cả dialog. Tránh dùng selector `footer` chung cho popup: exporter có footer cố định.

## Các tầng runtime

```text
Renderer (DOM, state, GIFEncoder, SpineStage)
        │ window.spinePreview.*
Preload (contextBridge / ipcRenderer)
        │ IPC
Main ───┼── filesystem scans / save GIF / asset HTTP server
        └── googleWorkspace → OAuth / Drive API / Sheets API
                                             │
                                   _ClosureUploadQueue
                                             │
                              Apps Script minute trigger
                                             │
                                  embedded images in Sheet
```

### Main và local assets

`main.js` tạo cửa sổ, folder dialog và IPC. Local asset loader chính là HTTP server trên localhost với token ngẫu nhiên mỗi phiên; renderer lấy base URL qua `assetBaseUrl()`. `spine-asset://` còn mã tương thích, không phải luồng chính để khắc phục Failed to fetch. `shared/assetUrl.js` và SpineStage dựng URL cho JSON/atlas/texture.

Local scan có preflight async trước xử lý: giới hạn 8.000 entry, 1.500 folder, depth 24, 10 giây kiểm tra, JSON đơn 20 MiB/tổng 100 MiB, GIF tổng 100 MiB. Từ chối các root quá rộng như home/Documents/Desktop. Giới hạn này không biến toàn bộ filesystem processing thành background worker; vẫn còn thao tác sync, nên tránh scan nguồn quá lớn.

### Renderer state

- App: `module`, `google` và trạng thái export/preview.
- GIF: `files`, Map `configs`, `gifGroups`, skin/trim, crop, nền và optimize.
- `workspace`: catalog, nguồn Animation/UI, shared Sheet, uploadRows, progress, cancel operation.
- `ownership`: email, Sheet/folder chuyển owner, link Sheet/folder move riêng, busy/result.
- `notes`: Drive URL, gameId, games, rows, note dialog/save.
- Naming: folder, kết quả, lỗi/scan.

Một số lựa chọn lưu localStorage: folder GIF nguồn/đích, duration/object size, nguồn catalog và email nhận owner. OAuth tokens không lưu renderer/localStorage.

### Google auth và API

`googleWorkspace.js` quản lý OAuth Desktop với PKCE + callback localhost. Dùng system browser; refresh access token khi cần. Store ở Electron userData, `safeStorage` khi có hỗ trợ. API request thông thường timeout 60 giây. OAuth callback chờ tối đa 180 giây.

Scope bao gồm Drive đầy đủ và Sheets; domain có thể giới hạn qua env. API gọi bằng tài khoản đăng nhập. Trigger Apps Script chạy bằng tài khoản cài trigger, là một principal độc lập.

## IPC public bridge

Danh sách chuẩn nằm trong `src/preload.js`; khi thêm IPC phải cập nhật cả bridge và main handler.

| Nhóm | Bridge methods |
| --- | --- |
| Local | selectFolder, selectExportFolder, scanFolder, scanLocalCatalog, scanNamingIssues, scanUploadGifs, saveBatchGifs |
| Asset/OS | assetBaseUrl, openFolder, openSheetLink |
| Google | googleStatus, googleSignIn, googleSignOut |
| Catalog | createCatalog, cancelCatalog, finishCatalog, clearCatalog |
| Sheet/images | loadClosureSheet, queueImages, queueStatus |
| Owner/move | transferOwnership, cancelTransferOwnership, moveSheetToFolder, browseDriveFolders |
| Notes | animationNotes |
| Progress subscriptions | onCatalogScanProgress, onAnimationNotesProgress |

Workspace handlers thường trả `{ok:true,...data}` hoặc `{ok:false,error}`. Renderer kiểm tra `ok` trước update UI. Subscription trả hàm bỏ listener. Main/preload thay đổi cần restart Electron để không gặp No handler registered.

## Luồng catalog và queue

1. `scanLocalCatalog`: đọc nguồn local đã tick; nhóm Spine theo folder, UI theo button states, tách View.
2. Hybrid `attachDriveFolderLinks`: chỉ list category/group folder Drive để ghép link, không tải asset Drive.
3. `createCatalog`: tạo/reuse tab, clear A:I, write RAW text và batch format.
4. `queueImages`: chuẩn bị thumbnail local bằng Electron nativeImage; static preview tối đa khoảng 300×220, composite trong khung 276×220. Loại PNG có hash nội dung trùng trước ghép. Dùng temp folder và cleanup.
5. Base64 chia chunk khoảng giới hạn cell và append hidden queue. Giới hạn số chunk mỗi ảnh trong source.
6. Worker nhúng ảnh, thay ảnh cũ cùng anchor, cập nhật done/error và dọn payload.
7. `waitForUploadQueue` poll mỗi 3 giây; hiển thị tiến trình/elapsed, cảnh báo stalled, timeout hữu hạn theo số ảnh.

`catalogOperations` Map theo operation UUID quản lý Cancel: create kiểm tra giữa các tab, queue kiểm tra lúc chuẩn bị/append, cancel đánh dấu row queued/processing thành cancelled. Worker đọc lại status trước từng ảnh. `finishCatalog` dọn control khi renderer hoàn tất. Đây là huỷ hợp tác, không transaction/rollback.

## Luồng GIF

SpineStage load skeleton/atlas, chọn skin và pose theo thời điểm. Renderer lấy frame, tính crop/padding/scale, bake caro nếu bật, quantize và encode bằng gifenc. gifsicle WASM phục vụ optimize. Main ghi file qua saveBatchGifs; source không bị sửa. Group lưu references tới item key; export lấy config hiện tại và checkbox selection. Single và nhiều nhóm có thể chạy cùng lượt.

## Luồng notes

`animationNotes(action,payload)` xử lý games/load/scan/save/save-spine/save-note trực tiếp Sheets API. Drive scan đệ quy đọc skeleton JSON, merge bằng `(fileId, animation)`. Sheet note dùng A:H, dữ liệu gồm fileId, name, animation, note, general, status, folder. Scan gọi save trước khi trả rows. UI thêm Game ID ngay sau scan/save thành công, không cần mở lại page.

## Luồng owner/move

Owner transfer có control theo sender để Cancel, đi qua cây Drive và chuyển mục thuộc user. Kết quả không undo. Move Sheet là Drive PATCH `addParents`/`removeParents`, khác với transfer permissions. Browser folder là Drive files.list, chỉ folder, sharedWithMe ở root, children ở folder con, name contains cho search và pageToken cho phân trang.

## Giới hạn và kiểm tra khi sửa

- Không có test runner/lint thực: npm lint hiện chỉ echo. `node --check` xác nhận cú pháp, không xác nhận OAuth/Drive/Sheets hoặc layout.
- Luồng Google cần kiểm tra bằng account/test Sheet có quyền phù hợp. Không ghi thật/chuyển owner chỉ để kiểm tra build.
- Shared Drive/ownership phụ thuộc quyền và chính sách Google; supportAllDrives ở API không bảo đảm mọi thao tác được phép.
- Worker hiện một Sheet cố định. Không coi database notes và queue worker là cùng một luồng.
- Còn một số state/helper cũ tương thích; đọc callsite trước xoá. Tài liệu này không khẳng định mã đã được module hoá hay có unit test đầy đủ.

## Auto-update

Updater riêng ở `src/appUpdater.js`, dùng Ed25519 + SHA-256, ZIP đầy đủ, helper ngoài app để backup/swap/relaunch. Public key/helpers được packager copy vào Resources; private key ngoài repo. Chi tiết, setup CI và giới hạn test: [auto-update.md](auto-update.md). Không dùng Squirrel.Mac; không cần Apple certificate.
