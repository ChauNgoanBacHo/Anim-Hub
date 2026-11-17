# Apps Script image/GIF worker

Cập nhật 17/11/2026. Worker này là project standalone, xử lý ảnh/GIF cho closure. Text/tab/format và Sổ tay animation dùng Sheets API trực tiếp.

## Cài đặt

1. Tạo project standalone tại `script.google.com`.
2. Copy toàn bộ `Code.gs` của repo vào project.
3. Bật hiển thị manifest trong Project Settings nếu cần; dùng `appsscript.json` đi kèm để tránh scope cũ không còn cần.
4. Script Properties: đặt `TEMPLATE_SPREADSHEET_ID` bằng ID Sheet gốc, không phải cả URL.
5. Triggers → Add Trigger:
   - Function: `processClosureStudioQueue`.
   - Deployment: Head.
   - Event source: Time-driven.
   - Minutes timer → Every minute.
6. Cấp quyền bằng tài khoản cài trigger. Tài khoản này cần Editor trên Sheet gốc.
7. App desktop cấu hình `CLOSURE_SHEET_URL` cùng Sheet đó trước khi chạy/build.

Không cần Web App deployment, API Executable, Upload Token hay cài trigger qua `ScriptApp.getProjectTriggers`. Không yêu cầu từng user chèn script vào Sheet copy.

## Quyền và phạm vi

Trigger chạy bằng **tài khoản đã tạo trigger**, không phải tài khoản đang đăng nhập desktop. User có Editor chưa đủ nếu tài khoản trigger không truy cập được Sheet. Worker chỉ mở Sheet theo `TEMPLATE_SPREADSHEET_ID`; đổi link trên app không tự cấu hình worker theo Sheet khác.

Tạo bản copy Sheet sau khi closure hoàn tất để bàn giao. Di chuyển Sheet vào folder trong app dùng Drive API của user, không cần worker. Chuyển owner cũng không dùng worker.

## Queue và tiến trình

- App chuẩn bị thumbnail local rồi ghi `_ClosureUploadQueue` ẩn bằng Sheets API; GIF giữ dữ liệu animation.
- Row có jobId, status, sheetName, cell, filename, MIME, error, timestamps và các chunk Base64.
- Trạng thái: queued → processing → done/error; cancelled được bỏ qua.
- Trigger lock tránh hai worker chạy chồng; mỗi lượt xử lý liên tục tối đa khoảng 4 phút, không có giới hạn cứng 30 ảnh/lượt trong thiết kế hiện tại.
- Worker cache context/ảnh theo tab, thay ảnh cùng anchor và dọn payload sau thành công.
- App poll 3 giây/lượt, báo completed/processing/queued, elapsed và stalled. Trigger không đảm bảo khởi chạy tức thì.

## Cancel Create/Update Sheet

App đánh dấu các job queued/processing thành cancelled và dừng phần tiếp theo. Worker đọc lại trạng thái trước từng ảnh để không tiếp tục batch từ snapshot cũ. Một ảnh đã bắt đầu có thể vẫn hoàn tất; dữ liệu cũ không rollback.

**Sau khi sửa worker trong repo phải copy lại Code.gs lên project Apps Script.** Restart Electron chỉ cập nhật app, không cập nhật code trên Google. Trigger dùng Head nên sửa/lưu source là đủ, không redeploy Web App.

## Xử lý lỗi

| Triệu chứng | Kiểm tra |
| --- | --- |
| Text có nhưng ảnh chưa hiện | ID Sheet worker, quyền tài khoản trigger, trigger có chạy, Apps Script Executions |
| Queue đứng hoặc > vài phút không tiến triển | Executions, trigger trùng/lỗi, quota, quyền; không chỉ dựa vào network |
| Blob >2MB hoặc >1 triệu pixel | Thumbnail preparation và payload; không gửi nguyên ảnh khổng lồ |
| NOT_FOUND / không đọc storage | Xác minh quyền/ID, execution log và row lỗi cụ thể; không mặc định do dung lượng |
| Cancel rồi ảnh vẫn tiếp tục nhiều mục | Cập nhật Code.gs có re-read status; ảnh đang thực hiện có thể xong |
| Xin scope script.scriptapp cũ | Kiểm tra manifest/code cũ, cài trigger bằng UI theo bước trên |

Không bật public sharing ảnh để queue hoạt động: worker nhúng blob vào Sheet, không dùng IMAGE(url) từ Drive riêng tư.
