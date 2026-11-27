# Xóm Nhà Lá

**Chuyện gì cũng có tool.** Ứng dụng desktop cho team Animation/Art và quy trình doc closure. Powered by TiTi.

Tài liệu cập nhật theo source ngày **17/11/2026**. App dùng Electron Forge + Vite, JavaScript thuần, PixiJS/pixi-spine; không dùng React hay TypeScript.

## Chức năng

Landing chia hai nhóm, mỗi page có nút **Về Xóm**:

| Nhóm | Feature | Đăng nhập Google |
| --- | --- | --- |
| Closure | Tạo Sheet | Có |
| Closure | Tạo GIF | Không |
| Closure | Upload GIF | Có |
| Closure | Chuyển owner, di chuyển Sheet | Có |
| Handoff | Cảnh sát chính tả | Không |
| Handoff | Sổ tay animation | Có |
| Handoff | Phòng thử font | Không |

Page cần đăng nhập chỉ hiện lời nhắc đăng nhập khi chưa có session. Giao diện dark, font Baloo 2, mascot và splash tối thiểu khoảng 2 giây.

## Chạy và build

```bash
npm ci
cp .env.example .env.local
npm start
```

Điền cấu hình trong `.env.local`; không commit file env chứa cấu hình thực tế.

```bash
npm run package       # đóng gói app
npm run make:win      # Windows installer (chạy trên Windows)
npm run make:zip      # macOS ZIP (chạy trên macOS)
```

Output ở `out/`. Windows installer: `XomNhaLaSetup.exe`. Env được nhúng lúc build qua `vite.main.config.mjs`; đổi env cần khởi động lại dev hoặc build lại. Sửa main/preload/IPC cũng cần restart Electron nếu cửa sổ vẫn giữ phiên cũ.

## Cấu hình Google

| Biến | Mục đích |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth client loại Desktop app |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Cấu hình client cho luồng OAuth desktop |
| `GOOGLE_WORKSPACE_DOMAIN` | Giới hạn domain đăng nhập |
| `CLOSURE_SHEET_URL` | Sheet gốc dùng tạo closure và upload GIF |
| `ANIMATION_NOTES_SHEET_URL` | Sheet database riêng cho Sổ tay animation |

Ứng dụng dùng Drive API và Sheets API với OAuth của người đăng nhập. Refresh token được lưu ở Electron userData, mã hoá bằng `safeStorage` khi hệ điều hành hỗ trợ. Không đưa token lên Git. Cấu hình OAuth nhúng trong desktop có thể được trích xuất; không coi client secret là bí mật máy chủ.

Chèn ảnh/GIF dùng thêm Apps Script trigger của người cài worker. Tài khoản tạo trigger phải có quyền Editor trên Sheet gốc. Quyền của người đăng nhập app không tự chuyển sang worker. Worker hiện chỉ xử lý `TEMPLATE_SPREADSHEET_ID`, chưa hỗ trợ Sheet bất kỳ. Xem [cài worker](apps-script/README.md).

## Tài liệu chi tiết

- [Các feature và quy trình sử dụng](docs/features.md)
- [Cấu trúc source, IPC và luồng dữ liệu](docs/architecture.md)
- [Apps Script worker và xử lý lỗi](apps-script/README.md)
- [Build và release public](docs/build-release.md)
- [Auto-update Windows/macOS, key và CI setup](docs/auto-update.md)

Asset local không bị sửa khi scan/export. Clear Sheet, ghi đè tab, di chuyển Sheet và chuyển owner là các thao tác có thay đổi dữ liệu trên Google.
