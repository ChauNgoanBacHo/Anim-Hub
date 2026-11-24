# Auto-update Xóm Nhà Lá — Windows và macOS

Cập nhật 24/11/2026. Đây là updater riêng, không dùng Squirrel.Mac. Không cần Apple Developer ID/notarization; release vẫn được xác thực bằng Ed25519 do project quản lý.

## User dùng thế nào

1. Cài thủ công một bản chuyển tiếp đã chứa updater/public key mới.
2. App packaged tự kiểm tra GitHub sau khi mở khoảng 8 giây, hoặc bấm **Cập nhật**.
3. Có bản mới → **Tải cập nhật**: ZIP tải dưới nền, hiện phần trăm, kiểm tra chữ ký và SHA-256.
4. Hoàn tất công việc → **Khởi động lại & cài**.
5. App kiểm tra lại, giải nén staging, helper đợi app thoát, backup bản cũ, thay app và mở lại.

Dữ liệu người dùng/OAuth/settings nằm ở userData được giữ. Không tự đóng app đang export/upload hoặc lưu ghi chú. Có thể đóng dialog khi tải; mở lại xem tiến trình. Không resume tải sau khi đóng hẳn app.

## Phạm vi nền tảng

- Windows x64: release ZIP portable đầy đủ, không tải installer để thay app. Helper PowerShell thay thư mục cài và mở executable. Thư mục phải cho user ghi/rename. Ưu tiên bản portable; không nâng quyền, không đổi execution policy. Máy chặn chạy PowerShell script sẽ báo lỗi trước khi app đóng qua handshake helper.
- macOS arm64: ZIP đúng kiến trúc process; kiểm tra bundle ID/version/executable, kiến trúc Mach-O và package bên trong asar. Cài ở thư mục ghi được, ví dụ `~/Applications`. Chặn `/Volumes` và App Translocation. Không tắt SIP/Gatekeeper hoặc tự xoá quarantine.
- Chính sách máy công ty có thể chặn app/script; updater không vượt qua chính sách đó.
- Helper rollback nếu thay file hoặc yêu cầu launch thất bại ngay. Chưa có health-check tự rollback khi app mới crash sau launch.

## Định danh và file

| Giá trị | Cấu hình |
| --- | --- |
| Repo | ChauNgoanBacHo/Anim-Hub |
| Bundle/app ID | io.enotion.xom-nha-la |
| Tên hiển thị | Xóm Nhà Lá |
| Bundle / executable nội bộ | XomNhaLa.app / XomNhaLa (Windows: XomNhaLa.exe) |
| Windows ZIP | Xom-Nha-La-portable-vX.Y.Z.zip |
| Mac ZIP | Xom-Nha-La-macOS-arm64-vX.Y.Z.zip |
| Signed manifests | update-win32-x64.json, update-darwin-arm64.json |
| Public key | assets/update-public.pem |
| Private key mặc định | ~/.config/xom-nha-la/update-private.pem (ngoài repo, mode 600) |
| Log | userData/update-result.txt |
| Receipt chờ xác nhận | userData/update-pending.json |
| Backup | cạnh thư mục app cũ, hậu tố .backup-version-timestamp |

Không xoá/đổi public key khi đã có user cài. Mất private key mà không có backup sẽ cần phát bản chuyển tiếp cài tay. Không nhúng GitHub token/private key vào binary hoặc release.

## Setup máy release/CI một lần

Cặp key riêng của Xóm Nhà Lá đã được tạo trên máy triển khai. Chỉ public key nằm trong repo. Không chạy keygen lại nếu key đã tồn tại.

Nếu setup project mới hoàn toàn, dùng `npm run update:keygen`; script từ chối ghi đè. `UPDATE_SIGNING_KEY_PATH` cho phép chọn nơi giữ private key khác.

GitHub repo → Settings → Secrets and variables → Actions → New repository secret:

- Tên: `UPDATE_SIGNING_PRIVATE_KEY`.
- Value: toàn bộ nội dung private PEM tại đường dẫn trên. Không paste vào chat/issue/commit.

Có thể dùng GitHub CLI đã đăng nhập để nhập secret trực tiếp từ file, không in key:

```bash
gh secret set UPDATE_SIGNING_PRIVATE_KEY < "$HOME/.config/xom-nha-la/update-private.pem"
```

Giữ các OAuth secrets/Sheet variables như [hướng dẫn build](build-release.md). Backup private key an toàn ngoài repo. Key đã nhúng là trust anchor của tất cả user.

## Phát hành

1. Chọn version mới chưa public, tăng `package.json` và lockfile cùng version:

```bash
npm version X.Y.Z --no-git-tag-version
npm run test:updater
```

2. Commit/push source và public key lên main. Không commit private key.
3. Chạy **Release Public Download** từ main, tag `vX.Y.Z` khớp package version.
4. Workflow validate key/version, build Windows x64 + macOS arm64, ký manifest chính xác từng ZIP.
5. Publish job kiểm tra lại cả 2 manifest và ZIP, upload vào draft rồi mới public. Không sửa release đã public; tăng version nếu lỗi.

Chỉ app có updater mới nhận update tiếp theo. Release cũ thiếu signed manifest không được cài tự động, app báo bản chưa sẵn sàng. Cần cài tay bản chuyển tiếp một lần.

Build/sign local không publish:

```bash
npm run make:zip -- --arch=arm64
# Copy ZIP thành đúng tên artifact trước khi ký:
node scripts/sign-update.mjs path/to/Xom-Nha-La-macOS-arm64-vX.Y.Z.zip darwin arm64
```

Không thay đổi ZIP sau khi ký. `scripts/verify-release.mjs <dir>` kiểm tra đủ hai platform artifact trước publish. Workflow mới chỉ công bố khi cả 2 build pass, tránh client thấy release thiếu bản phù hợp.

## Source

- `src/appUpdater.js`: state/check/download/install, IPC, staging/bundle validation, helper handshake.
- `src/shared/update-security.mjs`: identity, stable semver, Ed25519, hash/size, ZIP path và symlink validation.
- `src/shared/update-zip.mjs`: giải nén với yauzl, giới hạn entry/expanded bytes, file thường trước và symlink sau, không ghi qua symlink.
- `assets/updater/install-mac.sh`, `install-win.ps1`: đợi PID cũ, backup/swap/relaunch/rollback.
- `scripts/create-update-key.mjs`, `sign-update.mjs`, `verify-release.mjs`: key và release tooling.
- `scripts/update-security.test.mjs`: security và helper regression tests.
- `forge.config.js`: stable bundle ID, extraResource public key và helpers.
- `src/preload.js` / renderer: get state, check/download/install, subscription và dialog.

Manifest envelope chứa payload base64 + signature base64. Payload gồm schema/appId/version/platform/arch/file/size/sha256. Chỉ stable x.y.z cao hơn được nhận. Signature kiểm tra trước khi tin artifact; hash/size xác minh sau download và trước install. Chặn zip-slip, link ra ngoài bundle, file Windows không hợp lệ, duplicate path và archive quá lớn. Không dùng checksum public tải cùng ZIP làm xác thực duy nhất.

## Validation và giới hạn

Đã chạy tests security/hash/ZIP + helper macOS trên thư mục tạm với đường dẫn có khoảng trắng và rollback; build packaged macOS và kiểm tra bridge/dialog thật. Test helper Windows chỉ chạy trên Windows CI, chưa được chạy từ máy macOS này. Chưa kiểm tra end-to-end qua hai release public A → B, vì chưa publish bản mới và chưa cấu hình secret CI từ máy này.

Sau release cần kiểm tra A → B trên Windows thật và macOS thật: đúng version sau restart, userData còn nguyên, log và backup có thể truy cập. Startup chỉ báo installed khi app.getVersion() khớp receipt; không báo thành công chỉ vì helper đã gọi launch.

Backup/cache/helper được giữ để chẩn đoán; chưa có chính sách dọn theo số bản. Không hỗ trợ delta update, resume, prerelease, Linux hoặc chuyển key nhiều bước.

Tên bundle/executable/helper nội bộ dùng ASCII để tránh Archive Utility/Finder chuyển Unicode NFC sang NFD làm Electron crash trước khi vào main. CFBundleDisplayName và giao diện giữ Xóm Nhà Lá. Khi test ZIP cần test cả giải nén theo Finder/NFD, không chỉ ditto hoặc updater extractor.

## Sửa lỗi Invalid package khi chuẩn bị cài (1.0.4)

Bước kiểm tra package của app staged dùng `src/shared/update-package.mjs` và @electron/asar/original-fs thay cho fs đọc đường dẫn bên trong app.asar. Không tắt integrity fuse của app đang cài. Có regression test đọc archive mới và archive bị thay tại cùng đường dẫn. Client cũ có lỗi này cần cài tay bản sửa một lần; sau đó tiếp tục dùng luồng updater.
