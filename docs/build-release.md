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

Output `out/`, maker output `out/make/`. App name Xóm Nhà Lá, package xom-nha-la, installer `XomNhaLaSetup.exe`. Icon nằm trong assets; xem `render-icon.cjs` và Forge config trước tạo lại.

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

Trigger tag `v*` hoặc Actions → Run workflow. Chọn main cho manual, nhập tag mới (ví dụ `v1.0.1`); bỏ trống dùng version package.json. Manual tạo tag nếu chưa có, tag đã có sẽ được reuse, không tự trỏ lại commit mới.

- Windows job tạo installer và ZIP portable, upload vào GitHub Release.
- macOS job phụ thuộc Windows, matrix arm64/x64, build ZIP và upload cùng release.
- Artifact phụ giữ 7 ngày; release assets là nơi tải cho user.
- Link: https://github.com/ChauNgoanBacHo/Anim-Hub/releases
- Public download không cần tài khoản chỉ khi repository/release được công khai.

Tên file hiện tại:

```text
Xom-Nha-La-portable-<tag>.zip
XomNhaLaSetup.exe
Xom-Nha-La-macOS-arm64-<tag>.zip
Xom-Nha-La-macOS-x64-<tag>.zip
```

Chạy lại job cũ dùng revision workflow cũ, có thể chưa chứa macOS. Chạy workflow từ main đã có thay đổi để build bản mới. Đợi cả macOS jobs hoàn tất trước kiểm tra asset. macOS hiện không cấu hình Apple signing/notarization.

## Kiểm tra trước phát hành

- `node --check` các JS đã sửa; build/package trên OS mục tiêu.
- Đăng nhập và kiểm tra quyền bằng account thử, không commit token.
- Tạo Sheet/queue cần worker phiên bản tương ứng trên Google.
- Kiểm tra single/group GIF, filename mapping, notes scan/save và dialog folder.
- Thử Cancel trên test Sheet; dữ liệu đã ghi không được undo.
- Chuyển owner/di chuyển file là thao tác thật; chỉ thử trên tài nguyên được phép.

`npm run lint` hiện là placeholder, không phải kiểm tra chất lượng tự động. Workflow đang dùng Node 20 và actions v4 trong source; tài liệu không coi cảnh báo deprecation đã được xử lý.
