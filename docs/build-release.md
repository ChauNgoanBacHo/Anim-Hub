# Build và release

Cập nhật 17/11/2026. Source branch chính: `main`. Repo: `ChauNgoanBacHo/Anim-Hub`.

## Local

```bash
npm ci
npm start
npm run package
npm run make:win
npm run make:zip
```

Chạy maker Windows trên Windows, maker macOS trên macOS. macOS có thể chỉ định kiến trúc:

```bash
npm run make:zip -- --arch=arm64
npm run make:zip -- --arch=x64
```

Output `out/`, maker output `out/make/`. Tên hiển thị Xóm Nhà Lá, bundle/executable nội bộ XomNhaLa.app/XomNhaLa (Windows XomNhaLa.exe), package xom-nha-la, installer `XomNhaLaSetup.exe`. Icon nằm trong assets; xem `render-icon.cjs` và Forge config trước tạo lại.

## Environment trong GitHub

Repository Settings → Secrets and variables → Actions:

| Loại | Tên |
| --- | --- |
| Secret | GOOGLE_OAUTH_CLIENT_ID |
| Secret | GOOGLE_OAUTH_CLIENT_SECRET |
| Variable | GOOGLE_WORKSPACE_DOMAIN |
| Variable | CLOSURE_SHEET_URL |
| Variable | ANIMATION_NOTES_SHEET_URL |

Vite main nhúng các giá trị này khi build. Không upload `.env.local` hay OAuth user token làm release asset. Binary desktop vẫn chứa client configuration; không dùng nó để giữ bí mật server.

## Hai workflow khác nhau

### Build Windows — build-windows.yml

Hiện source vẫn trigger **push main** và manual workflow_dispatch. Build installer rồi upload Actions artifact giữ 5 ngày. Đây không phải trang tải release public. Nếu muốn chỉ build manual, cần bỏ cấu hình push trong workflow; hiện chưa bỏ.

### Release Public Download — release-public.yml

Trigger tag v* hoặc manual từ main. Tag phải khớp package.json và chưa có release public; tag có sẵn phải trỏ đúng commit build. Cần secret `UPDATE_SIGNING_PRIVATE_KEY` khớp public key trong repo.

Workflow prepare kiểm tra version/key → matrix Windows x64 + macOS arm64 → ký từng manifest → upload artifact tạm → publish job verify đủ 2 ZIP và manifest → tạo/reuse draft → upload đủ rồi mới public. Không ghi đè release đã công bố.

Release có Windows installer, ZIP portable, ZIP macOS arm64 và hai signed manifest. Artifact phụ giữ 7 ngày. Link tải: https://github.com/ChauNgoanBacHo/Anim-Hub/releases (repo/release phải public).

macOS không cấu hình Apple signing/notarization; updater riêng dùng chữ ký Ed25519. Chi tiết cấu hình key, helper và luồng cập nhật tại [Auto-update](auto-update.md).

## Kiểm tra trước phát hành

- `node --check` các JS đã sửa; build/package trên OS mục tiêu.
- Đăng nhập và kiểm tra quyền bằng account thử, không commit token.
- Tạo Sheet/queue cần worker phiên bản tương ứng trên Google.
- Kiểm tra single/group GIF, filename mapping, notes scan/save và dialog folder.
- Thử Cancel trên test Sheet; dữ liệu đã ghi không được undo.
- Chuyển owner/di chuyển file là thao tác thật; chỉ thử trên tài nguyên được phép.

`npm run lint` hiện là placeholder, không phải kiểm tra chất lượng tự động. Workflow đang dùng Node 20 và actions v4 trong source; tài liệu không coi cảnh báo deprecation đã được xử lý.

## Cập nhật trong app

Nút Cập nhật nay kiểm tra signed release, tải nền có progress và **Khởi động lại & cài** bằng helper Windows/macOS. Không còn chỉ mở link browser. App cũ cần cài thủ công bản chuyển tiếp một lần. Xem [Auto-update](auto-update.md) để setup CI secret và release đúng version.
