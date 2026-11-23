# PAAS WIVER — Windows Low-Spec CNC / NX / Delcam Pass Inspector

Lightweight desktop application engineered specifically for **low-end Windows PCs** (low RAM, integrated Intel/AMD graphics, older dual-core CPUs).

## Why It Runs Smoothly on Low-End Hardware
- **Zero Heavy Frameworks**: Uses Python's native `tkinter.Canvas` (Windows GDI vector drawing) — no Electron, no Chromium, no OpenGL/WebGL shader crashes, ~25 MB RAM footprint.
- **Chunked Streaming Parser (`parser.py`)**: Reads `.nc`, `.tap`, `.ptp`, `.cnc`, `.mpf`, `.txt`, and CL-data files line-by-line in a background thread so multi-megabyte PowerMill/NX files never freeze the UI.
- **Automatic LOD Point Decimation (`pass_generator.py`)**: Collinear thinning (`Auto`, `Full`, `Fast`) reduces vertex counts on dense 3D finishing paths while preserving corners and pass endpoints.

## Project Structure
- `parser.py` — Streaming NX / Delcam G-code & CL-data (`GOTO/`) parser + arc linearizer
- `pass_generator.py` — Groups moves into Cutting/Rapid passes, Z-levels, Operations, stats & LOD
- `viewer.py` — Fast 2D (XY, XZ, YZ) & 3D Wireframe Canvas with pan, zoom, and segment picking
- `exporter.py` — Exports re-indexed `.nc`, pass summary `.txt`, and coordinate `.csv`
- `samples.py` — Built-in Siemens NX cavity, Delcam PowerMill raster, and CL-Data samples
- `main.py` — Desktop GUI application entry point

## Step-by-Step Setup on Windows
1. Install **Python 3.10+** from `python.org` (check **"Add Python to PATH"** during install; Tkinter is included by default on Windows).
2. Open **Command Prompt** or **PowerShell** inside this folder:
   ```bat
   python --version
   python main.py
   ```
   *(No `pip install` packages are required!)*

3. **(Optional) Build a standalone Windows `.exe`:**
   ```bat
   pip install pyinstaller
   pyinstaller --onefile --windowed --name NXPassViewer main.py
   ```
   The standalone executable will appear in `dist\NXPassViewer.exe`.
