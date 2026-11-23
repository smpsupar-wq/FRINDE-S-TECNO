PAAS WIVER — Custom App Icon Folder
====================================

Replace EITHER of the files in this folder with your own icon before running BUILD_EXE_ON_WINDOWS.bat:

Option A (Recommended):
  Replace "icon.ico" with your own multi-size Windows .ico file (256x256, 48x48, 32x32, 16x16).

Option B (PNG Image):
  Replace "icon.png" with your own square PNG image (e.g. 256x256, 512x512, or 1024x1024).
  When you run BUILD_EXE_ON_WINDOWS.bat, scripts\sync-icon.cjs will automatically resize
  and convert your newer "icon.png" into a valid multi-size "icon.ico" for Windows .EXE
  and taskbar icons!

Important:
  - Keep the filename exactly "icon.ico" or "icon.png" inside this app_icon\ folder.
  - Do NOT just rename a .png/.jpg file to .ico manually (Windows rcedit rejects fake .ico files).
    If you have a PNG image, save it as "icon.png" here and delete or leave "icon.ico" older.
