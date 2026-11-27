# Feature và quy trình hiện tại

Cập nhật 17/11/2026. Mô tả hành vi đang có trong source, không phải roadmap.

## 1. Tạo Sheet

Tick Animation, UI hoặc cả hai. Mỗi section có hai nguồn phải điền:

- **Link Drive · lấy link folder cho sheet**: nhập link hoặc dùng Browse Drive ở cả Animation/UI; popup dùng chung trang Chuyển owner (folder được chia sẻ, search, breadcrumb). Chọn folder sẽ lưu link và xoá kết quả scan cũ để scan lại. Chỉ tìm folder tương ứng để gắn link ở cột Folder.
- **Local · nguồn thông tin và upload ảnh lên sheet**: đọc file, JSON Spine, kích thước ảnh và tạo thumbnail.

Chọn đúng folder Animation/UI của game, ví dụ `9676_Animations` và `9676_UI_EN`. Tên folder category/asset local cần khớp Drive. `_Cocos` được bỏ qua trong luồng catalog. Có kiểm tra giới hạn folder để tránh scan nhầm cây thư mục quá lớn.

Bấm Scan, xem tiến trình folder/file và thời gian hoàn tất. **Create / Update Sheet** chỉ enable sau khi scan có catalog. Có thể upload riêng từng tab, message ghi rõ tên tab đang chạy/đã xong.

### Tab SOURCE (optional)

Section UI có ô Link folder source không bắt buộc. Khi có link và upload UI, app tạo/cập nhật tab `SOURCE` và đưa lên đầu Sheet: No, Description, Status, Note / Link; PSD 7 dòng, SPINE 3 dòng. Dòng có file tự điền Status DONE, dòng không có file để trống; Status có dropdown DONE nền xanh. Description liệt kê từng file source có hyperlink riêng. Note / Link merge toàn bộ các dòng mỗi nhóm, ghi tên và link folder PSD/SPINE tương ứng; không có folder thì để trống. Đọc file trực tiếp trong `*-PSD` / `*-SPINE` của ArtSource hoặc nhập thẳng folder nhóm. Giữ tối thiểu PSD 7 dòng/SPINE 3 dòng, tự tăng nếu nhiều file hơn. Update sẽ dựng lại tab SOURCE; để trống input thì không đụng tab này.

### Định dạng Sheet

| Loại | Thứ tự cột |
| --- | --- |
| Animation | No, Type, Output Images, Folder, File Name, Status, Description/Note, Demo |
| UI | No, Type, Output Images, Folder, File Name, Dimensions, Status, Description/Note, Demo |

- No bắt đầu từ 1; Type là `Spine` hoặc `Static`; Status là `DONE`.
- Header vàng; Type/Status nền xanh lá nhạt. File Name, Type và Dimensions canh giữa.
- Folder là tên folder có hyperlink Drive tới folder chứa asset.
- Animation: một hàng cho một folder chứa Spine; nhiều skeleton cùng folder được gom một hàng. File Name liệt kê file không phải `.meta`. Description ghi từng skeleton, anim và số skin, dạng `File 9676_Symbol_2 có 8 anim:`. UI Description để trống.
- Output Images của Spine lấy PNG trong folder; ảnh có nội dung trùng được loại trùng trước khi ghép thumbnail. Không render animation ở cột này.
- UI bitmap font: PNG có file `.fnt` cùng tên hoặc được khai báo trong page của `.fnt` có Type `Bitmap Font`; File Name liệt kê `.fnt` và PNG tương ứng.
- UI gom các file cùng button theo Normal → Pressed → Hover → Disable/Disabled. Output Images hiển thị các state trong cùng ô; File Name liệt kê các file.
- Ngoại lệ folder `*_BigWin-JPWin-TotalWin`: so khớp `bigwin-jpwin-totalwin` không phân biệt hoa thường, giữ nguyên tên hiển thị; mọi ảnh (kể cả View) là item Static riêng ở Output Images, không đưa sang Demo.
- Ảnh UI có tên `_View_` chuyển sang Demo, không tính như item bình thường. Demo của Animation dùng GIF upload ở feature 3.

### Ghi và huỷ

Sheets API tạo tab, ghi text, format; ảnh đi qua hidden queue và Apps Script. Ghi lại một tab sẽ clear vùng A:I và ghi lại dữ liệu; các tab không thuộc lượt upload được giữ. Tab đầu mặc định `Sheet1`/`Trang tính 1` có thể được đổi tên để tái sử dụng.

**Cancel** hiện khi Create/Update hoặc upload tab chạy. Huỷ dừng phần còn lại và đánh dấu job ảnh đang chờ; dữ liệu đã ghi được giữ. Request/ảnh đang thực hiện có thể hoàn tất. Worker cần bản Code.gs mới để kiểm tra trạng thái huỷ giữa các ảnh.

**Clear all data** có popup Xác nhận/Huỷ, xoá các tab và để lại một tab trắng. **Make a copy** mở trang copy của Google trong browser; Sheet gốc giữ nguyên. Google có thể copy cả bound script cũ nếu Sheet gốc còn gắn script; worker hiện tại là project standalone.

Popup thành công báo tab, ảnh và tổng thời gian, có nút Tạo GIF/Upload GIF.

## 2. Tạo GIF

Scan local Spine, list dọc từng Spine và animation. Click item để toggle chọn; có search, Uncheck all. **Check All** chọn đúng một anim mỗi Spine: anim đầu tiên có chứa `idle` không phân biệt hoa thường, không có thì index 0.

Mỗi animation chọn skin, preview và trim khoảng thời gian. Có global duration 0.5/1/1.5 giây, object size 50/60/70/80/90/100%, padding, Background (nền caro/trong suốt/màu nền với color picker) và Optimize GIF. Màu nền áp dụng cho cả single và nhóm, lưu lại trên máy. Mức hiển thị 100% dùng hệ số thực 96% để chừa mép. Thanh timeline dùng gradient xanh; preview phát theo thao tác người dùng.

- Auto crop để giảm khoảng trống; mục tiêu dung lượng tối đa 512 KiB/GIF, có các bước tối ưu trong exporter.
- GIF là định dạng palette và transparency giới hạn; VFX cần kiểm tra kết quả thực tế.
- Single mặc định xuất tên Spine `.gif`; trùng tên được thêm hậu tố.
- Dropdown **Nhóm GIF** trên từng item: Single, nhóm có sẵn, tạo nhóm mới. Có nhiều nhóm, đổi tên và xoá nhóm. Xoá đưa item về Single.
- Một lượt export có thể gồm single và các nhóm được chọn. Nhóm có tên file riêng, cấu hình số object mỗi hàng.
- Popup thành công có tổng kết và nút Upload GIF.

## 3. Upload GIF

Load Sheet gốc, đọc các tab animation gồm Spine/Symbols. Hỗ trợ layout mới với Demo H/I và layout A:C cũ. Không hiện dropdown chọn tab.

Hàng chọn folder GIF dùng chung **GIF output** của Tạo GIF. Scan GIF và map theo tên tự động; tên trùng bị bỏ qua. Có thể chọn file/drop thủ công từng hàng, bấm × để bỏ file rồi thay file khác. File đã map có trạng thái sáng hơn dropzone trống.

Upload ghi queue qua Sheets API; Apps Script nhúng GIF. UI theo dõi số completed/processing/queued và elapsed. Popup success có thời gian và nút Chuyển owner. Có nút Cancel để dừng upload còn chờ; GIF đã chèn vẫn giữ lại, request đang thực hiện có thể hoàn tất.

## 4. Chuyển owner và di chuyển Sheet

Email nhận mặc định `owner@enotion.io`, lưu email mới sau khi sửa. Ô email khoá; Edit để mở, Lưu để khoá lại.

Hai section chuyển owner độc lập:

- Google Sheet: link Sheet và nút Chuyển owner sheet.
- Folder Drive chứa asset: nhận folder tổng, đi qua folder/file con; chỉ chuyển các mục tài khoản có quyền sở hữu, mục không có quyền được bỏ qua. Kết quả liệt kê folder đã chuyển và tổng file, không liệt kê tất cả mục bỏ qua.

Popup xác nhận màu warning, email nổi bật, thông điệp “Thím nhắc con, bút sa gà chết, nhìn kỹ email trước khi bấm”. Chỉ hỗ trợ chuyển cùng domain theo kiểm tra của app; Google vẫn có thể từ chối theo quyền/chính sách. Cancel dừng trước mục tiếp theo, không hoàn tác mục đã chuyển.

### Di chuyển Sheet vào folder

Section riêng có **link Sheet riêng**, folder đích và nút Di chuyển sheet. Không dùng ô Sheet của phần chuyển owner, không đổi owner và không dùng Apps Script.

**Browse Drive** mở popup:

- Bắt đầu ở Được chia sẻ với tôi; chỉ list folder.
- Vào folder con, breadcrumb quay lại; phân trang 100 folder/lượt, Tải thêm.
- Search theo tên ở danh sách hiện tại: ngoài cùng tìm các folder được chia sẻ, bên trong tìm folder con trực tiếp, không tìm đệ quy.
- Folder cuối vẫn chọn được dù không có con. Huỷ/Chọn folder này ở trong popup.
- Chọn chỉ điền link; user bấm Di chuyển sheet riêng để thực hiện.

API dùng quyền tài khoản đăng nhập: đọc metadata Sheet/folder và PATCH parents. Cần quyền di chuyển phù hợp trên nguồn/đích; không suy ra quyền move chỉ từ việc nhìn thấy folder. `File not found` có thể là ID sai, file không tồn tại hoặc tài khoản không truy cập được. Chưa có bằng chứng rằng Sheet chưa đặt tên là nguyên nhân bắt buộc gây lỗi move.

## 5. Cảnh sát chính tả

Chỉ cảnh báo, không tự rename hay sửa nội dung vì có thể làm hỏng đường dẫn tham chiếu.

- Folder/file: khoảng trắng và chữ in hoa là lỗi (`HOME`, `Home`, `hOme`). Ký tự `+`, `-` trong tên folder/file được phép.
- Animation: khoảng trắng hoặc ký tự đặc biệt ở đầu tên là lỗi, ví dụ `-a-b`, `+1`, `@1`, `#1`; `a-b` được phép. Chữ in hoa trong anim không bị đánh lỗi.
- Bỏ qua `.meta`; Open mở folder chứa mục lỗi.

## 6. Sổ tay animation

Database là Sheet riêng từ env; mỗi Game ID số là một tab. Tải danh sách game khi mở feature, user chọn game để đọc; không tự chọn game bất kỳ.

Section tạo/cập nhật game: Drive folder + Game ID → Scan. Quét JSON Spine trên Drive, merge theo fileId + animation, giữ note cũ và đánh dấu missing cho anim không còn trong lần scan. Scan tự ghi database bằng Sheets API, không Apps Script. Sau thành công, Game ID mới được thêm/sắp xếp ngay trên UI.

Mỗi Spine là một button. Có note thì sáng; hover preview ghi chú chung và anim có note, một anim một dòng, ellipsis nếu dài. Popover được canh trong viewport. Click mở ngay form chung với các anim; tất cả field optional, Save riêng Spine, Cancel/Escape/click ngoài để đóng khi không lưu. Không autosave hay nút save tổng.

Hướng dẫn hiện trên page: “Bạn có thể ghi chú các Spine đặc thù của game xuất hiện ở giao diện nào và khi nào. Các animation thông dụng có thể để trống.”

## 7. Phòng thử font

Feature offline trong nhóm Handoff, không cần Google login. Chọn riêng file FNT hoặc chọn cả folder BitmapFonts: app list FNT trực tiếp trong folder, tự load font đầu tiên và cho đổi font qua dropdown. Hỗ trợ FNT text/XML/JSON; app đọc các texture được khai báo trong cùng folder (hỗ trợ tối đa 16 page). Không hỗ trợ FNT binary hoặc packed-channel. Giữ texture gốc, không tint/đổi file source.

Nhập nội dung bất kỳ hoặc chọn mẫu tiền tệ USD/VND/EUR/BRL/PHP/THB. Chỉnh cỡ chữ, spacing, chiều rộng khung và màu nền. Preview áp dụng offset, advance, kerning và glyph Unicode; đánh dấu ký tự thiếu bằng ô đỏ/mã Unicode, báo tràn ngang bằng px. Không tự co chữ để giấu lỗi tràn.

Source: `src/fontLab.js` (UI/canvas), `src/shared/bitmap-font.mjs` (parser/layout), IPC `load-bitmap-font` trong main/preload. Metadata tối đa 4 MB, texture 20 MB/file và 64 MB/font, không đọc texture ngoài thư mục font. Test parser/layout: `node --test tests/bitmap-font.test.mjs`.
