import React, { useState } from 'react';
import { Check, Copy, Download, Smartphone, Terminal } from 'lucide-react';
import { DESKTOP_SOURCE_FILES, downloadPythonDesktopZip } from '../engine/exporter';

export const DesktopPackageView: React.FC = () => {
  const [activeFile, setActiveFile] = useState(DESKTOP_SOURCE_FILES[0].name);
  const [copied, setCopied] = useState(false);

  const selected = DESKTOP_SOURCE_FILES.find((f) => f.name === activeFile) ?? DESKTOP_SOURCE_FILES[0];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selected.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#080C13] p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Windows EXE & Android Admin APK Builders */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-[#111827] border border-slate-800 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-white">
                Windows Desktop .EXE (Firebase Licensed)
              </h2>
              <span className="text-xs font-mono text-cyan-400">BUILD_EXE_ON_WINDOWS.bat</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Double-click <code className="text-white">BUILD_EXE_ON_WINDOWS.bat</code> in the project root.
              It builds the Electron desktop executable with Firebase Username/Password Login, 10-minute free trial,
              and automatic license-expiration lock screen. Output goes to <code className="text-white">release\</code>.
            </p>
            <pre className="p-2.5 bg-[#080C13] border border-slate-800 rounded text-xs font-mono text-slate-200 overflow-x-auto">
              BUILD_EXE_ON_WINDOWS.bat
            </pre>
          </div>

          <div className="bg-[#111827] border border-slate-800 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-cyan-400" />
                <h2 className="text-base font-semibold text-white">
                  Android Admin Manager .APK
                </h2>
              </div>
              <span className="text-xs font-mono text-cyan-400">BUILD_APK_ON_WINDOWS.bat</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Native Kotlin Android app in <code className="text-white">android_admin_app\</code>.
              Shows all users, live remaining time, creates new username/password accounts with custom expiry,
              extends license dates (+10m/+1d/+7d/custom calendar), and deletes users. Run the batch file or open{' '}
              <code className="text-white">android_admin_app\</code> in Android Studio:
            </p>
            <pre className="p-2.5 bg-[#080C13] border border-slate-800 rounded text-xs font-mono text-slate-200 overflow-x-auto">
              {`BUILD_APK_ON_WINDOWS.bat\n# Output: release\\PAAS-WIVER-Admin.apk`}
            </pre>
          </div>
        </div>

        {/* Top Action Card */}
        <div className="bg-[#111827] border border-slate-800 rounded-lg p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <h1 className="text-xl font-semibold text-white">
              Windows Low-Spec Desktop Edition (Python + Tkinter)
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Ready-to-run native Windows desktop source package built specifically for older dual-core CPUs,
              integrated Intel graphics, and low-RAM shop-floor PCs (~25 MB RAM footprint, zero external pip
              dependencies, pure Windows GDI Canvas rendering).
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-400 pt-1">
              <span>Python 3.8+ Standard Library</span>
              <span aria-hidden="true">·</span>
              <span>Streaming Chunked File Reader</span>
              <span aria-hidden="true">·</span>
              <span>Auto LOD Decimation</span>
              <span aria-hidden="true">·</span>
              <span>Optional PyInstaller .EXE</span>
            </div>
          </div>

          <button
            type="button"
            onClick={downloadPythonDesktopZip}
            className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold rounded-md flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 self-start lg:self-center"
          >
            <Download className="w-4 h-4" />
            <span>Download Windows Python Bundle (.zip)</span>
          </button>
        </div>

        {/* Step-by-step Windows Setup */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-[#111827] border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="text-xs font-mono text-cyan-400">01. Extract &amp; Verify Python</div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Unzip <code className="text-slate-100">paas_wiver_desktop_windows.zip</code> and install Python 3.10+ from
              python.org (check &ldquo;Add Python to PATH&rdquo;). Tkinter comes built-in on Windows.
            </p>
            <pre className="p-2.5 bg-[#080C13] border border-slate-800 rounded text-xs font-mono text-slate-200 overflow-x-auto">
              python --version
            </pre>
          </div>

          <div className="bg-[#111827] border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="text-xs font-mono text-cyan-400">02. Launch Immediately</div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Zero <code className="text-slate-100">pip install</code> required for runtime. Run directly inside the
              extracted <code className="text-slate-100">paas_wiver</code> folder:
            </p>
            <pre className="p-2.5 bg-[#080C13] border border-slate-800 rounded text-xs font-mono text-slate-200 overflow-x-auto">
              python main.py
            </pre>
          </div>

          <div className="bg-[#111827] border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="text-xs font-mono text-cyan-400">03. Optional Standalone .EXE</div>
            <p className="text-xs text-slate-300 leading-relaxed">
              To distribute a single-click <code className="text-slate-100">.exe</code> to CNC workstations without
              Python installed:
            </p>
            <pre className="p-2.5 bg-[#080C13] border border-slate-800 rounded text-xs font-mono text-slate-200 overflow-x-auto">
              {`pip install pyinstaller\npyinstaller --onefile --windowed main.py`}
            </pre>
          </div>
        </div>

        {/* Modular Source Browser */}
        <div className="bg-[#111827] border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-1 overflow-x-auto">
              {DESKTOP_SOURCE_FILES.map((file) => (
                <button
                  key={file.name}
                  type="button"
                  onClick={() => setActiveFile(file.name)}
                  className={`px-3 py-1.5 text-xs font-mono rounded transition-colors whitespace-nowrap shrink-0 ${
                    activeFile === file.name
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {file.name}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-1.5 text-xs font-medium bg-[#080C13] border border-slate-700 hover:border-slate-500 text-slate-200 rounded flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy File'}</span>
            </button>
          </div>

          <div className="px-4 py-2 bg-[#0D131F] border-b border-slate-800 text-xs text-slate-400 flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>{selected.description}</span>
          </div>

          <pre className="p-4 text-xs font-mono text-slate-200 bg-[#080C13] overflow-x-auto max-h-[460px] leading-relaxed">
            {selected.content}
          </pre>
        </div>
      </div>
    </div>
  );
};
