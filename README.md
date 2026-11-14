# Xóm Nhà Lá

Chuyện gì cũng có tool. Ứng dụng Electron dành cho team animation và doc closure.

## Chức năng

- **Tạo Sheet**: scan folder local Animation/UI_EN, tạo tab và upload ảnh preview. Make a copy mở trang tạo bản sao Google, giữ nguyên Sheet gốc.
- **Tạo GIF**: preview Spine, chọn skin, trim, export riêng hoặc gộp anim; hỗ trợ crop, nền caro và optimize GIF.
- **Upload GIF**: load Sheet, chọn hoặc drag GIF theo từng hàng và theo dõi upload.
- **Naming Check**: kiểm tra tên folder, file và animation, không tự rename.

## Chạy local

```bash
npm ci
npm start
```

Copy `.env.example` thành `.env` để cấu hình OAuth Desktop client và Sheet gốc. Không commit `.env`. Export GIF và Naming Check không cần đăng nhập.

## Upload ảnh/GIF

Sheets API tạo tab, ghi text, format và upload dữ liệu vào `_ClosureUploadQueue`. Apps Script worker nhúng ảnh/GIF và cập nhật tiến trình. Xem [hướng dẫn worker](apps-script/README.md). Worker dùng TEMPLATE_SPREADSHEET_ID và trigger mỗi phút, không cần Web App deployment.

## Build

```bash
npm run package
npm run make
npm run make:win
```

Output trong `out/`, installer Windows là `XomNhaLaSetup.exe`. Env được đọc lúc build; thay env cần restart dev hoặc build lại.

## Cấu trúc

- `src/main.js`: Electron, scan local, naming check, lưu GIF.
- `src/googleWorkspace.js`: OAuth, Sheets API, queue.
- `src/preload.js`: IPC bridge.
- `src/renderer.js`, `src/index.css`: giao diện bốn feature.
- `src/spineStage.js`: preview và render Spine.
- `apps-script/`: worker nhúng ảnh/GIF.

Asset nguồn không bị chỉnh sửa khi scan/export. Chuyển owner chưa được triển khai.
