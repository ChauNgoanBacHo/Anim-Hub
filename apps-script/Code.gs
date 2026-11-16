/**
 * Closure Studio queue worker.
 * Script Property required:
 *   TEMPLATE_SPREADSHEET_ID=<the original closure sheet id>
 * Add a one-minute time-driven trigger for processClosureStudioQueue in the Apps Script UI.
 */
function processClosureStudioQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
  const startedAt = Date.now();
  const properties = PropertiesService.getScriptProperties();
  const templateId = properties.getProperty('TEMPLATE_SPREADSHEET_ID');
  if (!templateId) throw new Error('Missing TEMPLATE_SPREADSHEET_ID.');
  const spreadsheet = SpreadsheetApp.openById(templateId);
  const queue = spreadsheet.getSheetByName('_ClosureUploadQueue');
  if (!queue || queue.getLastRow() < 2) return;
  const lastColumn = Math.max(40, queue.getLastColumn());
  const rows = queue.getRange(2, 1, queue.getLastRow() - 1, 9).getValues();
  const contexts = {};
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index][1] === 'processing') {
      const updatedAt = new Date(rows[index][8]).getTime();
      if (!updatedAt || Date.now() - updatedAt > 5 * 60 * 1000) {
        rows[index][1] = 'queued';
        queue.getRange(index + 2, 2).setValue('queued');
      }
    }
    if (rows[index][1] !== 'queued') continue;
    // Re-read cancellation state: this batch may have been cancelled after loading rows.
    if (queue.getRange(index + 2, 2).getValue() !== 'queued') continue;
    if (Date.now() - startedAt > 240000) break;
    const sheetRow = index + 2;
    queue.getRange(sheetRow, 2).setValue('processing');
    queue.getRange(sheetRow, 9).setValue(new Date().toISOString());
    try {
      const name = rows[index][2];
      if (!contexts[name]) {
        const sheet = spreadsheet.getSheetByName(name);
        if (!sheet) throw new Error('Sheet tab not found: ' + name);
        const images = {};
        sheet.getImages().forEach(function(image) {
          const anchor = image.getAnchorCell();
          const key = anchor.getRow() + ':' + anchor.getColumn();
          if (!images[key]) images[key] = [];
          images[key].push(image);
        });
        contexts[name] = { sheet: sheet, images: images, formattedColumns: {} };
      }
      const base64 = queue.getRange(sheetRow, 10, 1, lastColumn - 9).getValues()[0].filter(String).join('');
      const bytes = Utilities.base64Decode(base64);
      const blob = Utilities.newBlob(bytes, rows[index][5] || 'image/png', rows[index][4] || 'preview.png');
      if (blob.getBytes().length > 2 * 1024 * 1024) throw new Error('Image exceeds Apps Script 2 MB limit.');
      replaceImageAtCell(contexts[name], rows[index][3], blob, rows[index][4]);
      queue.getRange(sheetRow, 2).setValue('done');
      queue.getRange(sheetRow, 7).clearContent();
      queue.getRange(sheetRow, 10, 1, lastColumn - 9).clearContent();
    } catch (error) {
      queue.getRange(sheetRow, 2).setValue('error');
      queue.getRange(sheetRow, 7).setValue(error.message || String(error));
    }
    queue.getRange(sheetRow, 9).setValue(new Date().toISOString());
    SpreadsheetApp.flush();
  }
  } finally {
    lock.releaseLock();
  }
}

function replaceImageAtCell(context, a1, blob, title) {
  const sheet = context.sheet;
  const range = sheet.getRange(a1);
  const row = range.getRow();
  const column = range.getColumn();
  const key = row + ':' + column;
  (context.images[key] || []).forEach(function(image) { image.remove(); });
  context.images[key] = [];
  const image = sheet.insertImage(blob, column, row);
  context.images[key] = [image];
  image.setAltTextTitle(title || 'Closure preview');
  const cellWidth = 300;
  const cellHeight = Math.max(260, sheet.getRowHeight(row));
  const maxWidth = cellWidth - 24;
  const maxHeight = 220;
  const originalWidth = image.getWidth();
  const originalHeight = image.getHeight();
  const scale = Math.min(1, maxWidth / originalWidth, maxHeight / originalHeight);
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  if (scale < 1) image.setWidth(width).setHeight(height);
  if (!context.formattedColumns[column]) {
    sheet.setColumnWidth(column, cellWidth);
    context.formattedColumns[column] = true;
  }
  sheet.setRowHeight(row, cellHeight);
  image.setAnchorCellXOffset(Math.max(0, Math.round((cellWidth - width) / 2)));
  image.setAnchorCellYOffset(Math.max(0, Math.round((cellHeight - height) / 2)));
}
