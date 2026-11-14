# Closure Studio Apps Script

1. Open `script.google.com` and create a standalone project.
2. Paste `Code.gs` into the project.
   If the project still requests old Drive or ScriptApp scopes, enable the manifest in Project Settings and replace `appsscript.json` with the supplied file.
3. In Project Settings → Script Properties, add `TEMPLATE_SPREADSHEET_ID` with the ID from the original closure Sheet URL.
4. Open **Triggers** (clock icon) → **Add Trigger**.
5. Configure the trigger:
   - Function: `processClosureStudioQueue`
   - Deployment: `Head`
   - Event source: `Time-driven`
   - Time based trigger: `Minutes timer`
   - Minute interval: `Every minute`
6. Save the trigger and approve spreadsheet permission if requested. This manual setup avoids the admin-blocked `script.scriptapp` scope.
7. Configure the desktop build environment:

```env
CLOSURE_SHEET_URL=https://docs.google.com/spreadsheets/d/your-sheet-id/edit
```

No Web App or API Executable deployment is required. The desktop app scans assets locally, resizes static previews, then writes static-image and GIF jobs into a hidden `_ClosureUploadQueue` tab using Google Sheets API. Each trigger execution processes continuously for up to four minutes. The app polls queue status every three seconds and displays completed, processing, queued, elapsed time, failures, and stalled-trigger warnings.

The trigger only processes `TEMPLATE_SPREADSHEET_ID`. Each inserted image is embedded into the Sheet. After the closure is complete, use **File → Make a copy** before sending it to another department.
