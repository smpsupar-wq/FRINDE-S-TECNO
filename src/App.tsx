import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { Download, FolderOpen, LogOut } from 'lucide-react';
import { AdminLicensePanel, formatRemainingTime } from './components/AdminLicensePanel';
import { DesktopPackageView } from './components/DesktopPackageView';
import { LeftPassPanel } from './components/LeftPassPanel';
import { LicenseGateModal, type LicenseRecord } from './components/LicenseGateModal';
import { NcInspectorPanel } from './components/NcInspectorPanel';
import { PassSummaryTable } from './components/PassSummaryTable';
import { ToolpathViewport } from './components/ToolpathViewport';
import { exportPassesCSV, exportPassSummaryTXT, exportReindexedNC } from './engine/exporter';
import { parseNCFileStreaming } from './engine/ncParser';
import { generatePasses } from './engine/passGenerator';
import {
  ADMIN_BOOTSTRAP_EMAIL,
  auth,
  clearOfflineLicenseSnapshot,
  db,
  handleFirestoreError,
  loadOfflineLicenseSnapshot,
  OperationType,
  saveOfflineLicenseSnapshot,
  updateOfflineClockWatermark,
} from './firebase';
import type {
  DisplayOptions,
  LodMode,
  ParseResult,
  ProgramStats,
  ToolpathPass,
  ViewMode,
} from './types/toolpath';

type ActiveTab = 'viewport' | 'schedule' | 'admin' | 'desktop';

const EMPTY_PARSE_RESULT: ParseResult = {
  segments: [],
  rawLines: [],
  sourceFormat: 'Generic ISO G-Code',
  totalLines: 0,
  warnings: [],
  units: 'mm',
};

function parseLicenseSnapshot(
  id: string,
  data: Record<string, unknown>
): LicenseRecord {
  const exp = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
  const cre = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
  const upd = data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : Date.now();
  return {
    uid: String(data.uid || id),
    ownerUid: String(data.ownerUid || id),
    username: String(data.username || 'operator'),
    role: data.role === 'admin' ? 'admin' : 'user',
    status: data.status === 'active' ? 'active' : data.status === 'expired' ? 'expired' : 'trial',
    trialGranted: Boolean(data.trialGranted),
    expiresAtMs: exp,
    createdAtMs: cre,
    updatedAtMs: upd,
  };
}

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clockAnchorRef = useRef<{ wallMs: number; perfMs: number }>({
    wallMs: Date.now(),
    perfMs: typeof performance !== 'undefined' ? performance.now() : 0,
  });

  // Firebase Auth & Licensing State
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [license, setLicense] = useState<LicenseRecord | null>(null);
  const [licenseLoaded, setLicenseLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [activeTab, setActiveTab] = useState<ActiveTab>('viewport');
  const [filename, setFilename] = useState<string>('');
  const [parseResult, setParseResult] = useState<ParseResult>(EMPTY_PARSE_RESULT);

  const [lodMode, setLodMode] = useState<LodMode>('auto');
  const [viewMode, setViewMode] = useState<ViewMode>('3D');
  const [display, setDisplay] = useState<DisplayOptions>({
    showCutting: true,
    showRapids: true,
    showArrows: true,
    showMarkers: true,
    colorByZ: false,
  });

  const [passes, setPasses] = useState<ToolpathPass[]>([]);
  const [stats, setStats] = useState<ProgramStats | null>(null);
  const [zLevels, setZLevels] = useState<number[]>([]);

  const [selectedPassId, setSelectedPassId] = useState<number | null>(null);
  const [selectedLineNum, setSelectedLineNum] = useState<number | null>(null);

  // Playback simulation state
  const [playStep, setPlayStep] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(4);

  // Streaming load state
  const [loadingProgress, setLoadingProgress] = useState<{ pct: number; lines: number } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Live 1-second monotonic background timer (enforces target expiry even offline or if clock is rolled back)
  useEffect(() => {
    if (!authUser) return;
    const cached = loadOfflineLicenseSnapshot(authUser.uid);
    const baseline = Math.max(Date.now(), cached?.maxObservedClockMs ?? 0);
    clockAnchorRef.current = {
      wallMs: baseline,
      perfMs: typeof performance !== 'undefined' ? performance.now() : 0,
    };
    setNowMs(baseline);

    let tickCount = 0;
    const id = window.setInterval(() => {
      const perfDelta =
        typeof performance !== 'undefined'
          ? Math.max(0, Math.floor(performance.now() - clockAnchorRef.current.perfMs))
          : 0;
      const monotonicNow = clockAnchorRef.current.wallMs + perfDelta;
      const effectiveNow = Math.max(Date.now(), monotonicNow);
      setNowMs(effectiveNow);
      tickCount += 1;
      if (tickCount % 5 === 0) {
        updateOfflineClockWatermark(authUser.uid, effectiveNow);
      }
    }, 1000);

    return () => {
      const perfDelta =
        typeof performance !== 'undefined'
          ? Math.max(0, Math.floor(performance.now() - clockAnchorRef.current.perfMs))
          : 0;
      updateOfflineClockWatermark(
        authUser.uid,
        Math.max(Date.now(), clockAnchorRef.current.wallMs + perfDelta)
      );
      window.clearInterval(id);
    };
  }, [authUser]);

  // Verify admin role & attach real-time + offline-cached /licenses/{uid} listener
  useEffect(() => {
    let active = true;
    let unsubLicense: (() => void) | undefined;

    setIsAdminUser(false);
    setLicense(null);
    setLicenseLoaded(false);

    if (!authUser) {
      return;
    }

    // Load last synced offline target immediately so turning off internet cannot bypass or stall lock check
    const cached = loadOfflineLicenseSnapshot(authUser.uid);
    if (cached) {
      setLicense(cached.license);
      setLicenseLoaded(true);
    }

    const initSession = async () => {
      try {
        const isBootstrapAdmin =
          authUser.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL && authUser.emailVerified;

        const adminRef = doc(db, 'admins', authUser.uid);
        let adminDocExists = false;
        try {
          const adminSnap = await getDoc(adminRef);
          adminDocExists = adminSnap.exists();
        } catch {
          adminDocExists = false;
        }

        if (isBootstrapAdmin && !adminDocExists) {
          try {
            await setDoc(adminRef, {
              uid: authUser.uid,
              email: authUser.email,
              createdAt: serverTimestamp(),
            });
            adminDocExists = true;
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, `admins/${authUser.uid}`);
          }
        }

        if (!active) return;

        if (isBootstrapAdmin || adminDocExists) {
          setIsAdminUser(true);
          setLicenseLoaded(true);
          return;
        }

        const licRef = doc(db, 'licenses', authUser.uid);
        unsubLicense = onSnapshot(
          licRef,
          { includeMetadataChanges: true },
          (snap) => {
            if (!active) return;
            if (snap.exists()) {
              const parsed = parseLicenseSnapshot(
                snap.id,
                snap.data() as Record<string, unknown>
              );
              setLicense(parsed);
              saveOfflineLicenseSnapshot(parsed, clockAnchorRef.current.wallMs);
              setLicenseLoaded(true);
            } else if (!snap.metadata.fromCache) {
              // Confirmed from live Firebase server that the user's license was deleted
              clearOfflineLicenseSnapshot(authUser.uid);
              setLicense(null);
              setLicenseLoaded(true);
            } else if (!loadOfflineLicenseSnapshot(authUser.uid)) {
              setLicense(null);
              setLicenseLoaded(true);
            }
          },
          (err) => {
            if (!active) return;
            // If offline with cached license, keep enforcing the cached target expiry gracefully
            if (loadOfflineLicenseSnapshot(authUser.uid)) {
              setLicenseLoaded(true);
              return;
            }
            handleFirestoreError(err, OperationType.GET, `licenses/${authUser.uid}`);
          }
        );
      } catch (err) {
        if (!active) return;
        console.error(err);
      }
    };

    void initSession();

    return () => {
      active = false;
      if (unsubLicense) unsubLicense();
    };
  }, [authUser]);

  // Keep non-admin off the Admin tab
  useEffect(() => {
    if (!isAdminUser && activeTab === 'admin') {
      setActiveTab('viewport');
    }
  }, [isAdminUser, activeTab]);

  const isLicenseExpired = Boolean(
    authUser &&
      !isAdminUser &&
      licenseLoaded &&
      (!license || license.expiresAtMs <= nowMs)
  );

  // Stop playback automatically if license expires mid-session
  useEffect(() => {
    if (isLicenseExpired && isPlaying) {
      setIsPlaying(false);
    }
  }, [isLicenseExpired, isPlaying]);

  const handleSignOut = useCallback(async () => {
    await signOut(auth);
    setActiveTab('viewport');
  }, []);

  const handleRefreshLicense = useCallback(async (): Promise<{
    ok: boolean;
    message?: string;
  }> => {
    if (!authUser || isAdminUser) return { ok: true };
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return {
        ok: false,
        message: 'No internet connection. Connect to the internet to check Admin renewal.',
      };
    }
    try {
      const snap = await getDocFromServer(doc(db, 'licenses', authUser.uid));
      const now = Date.now();
      clockAnchorRef.current = {
        wallMs: Math.max(now, clockAnchorRef.current.wallMs),
        perfMs: typeof performance !== 'undefined' ? performance.now() : 0,
      };
      setNowMs(clockAnchorRef.current.wallMs);

      if (snap.exists()) {
        const parsed = parseLicenseSnapshot(
          snap.id,
          snap.data() as Record<string, unknown>
        );
        setLicense(parsed);
        saveOfflineLicenseSnapshot(parsed, clockAnchorRef.current.wallMs);
        if (parsed.expiresAtMs <= clockAnchorRef.current.wallMs) {
          return {
            ok: false,
            message: 'License is still expired. Ask Admin to extend your date in the .APK.',
          };
        }
        return { ok: true };
      } else {
        clearOfflineLicenseSnapshot(authUser.uid);
        setLicense(null);
        return {
          ok: false,
          message: 'Account license not found or deleted by Admin.',
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('offline') || msg.includes('unavailable')) {
        return {
          ok: false,
          message: 'Offline — connect to internet after Admin updates your expiry date.',
        };
      }
      handleFirestoreError(err, OperationType.GET, `licenses/${authUser.uid}`);
    }
  }, [authUser, isAdminUser]);

  const handleClearSelection = useCallback(() => {
    setSelectedPassId(null);
    setSelectedLineNum(null);
  }, []);

  // Press Escape anywhere to deselect highlighted NC line & pass
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClearSelection]);

  // Regenerate passes whenever parseResult or lodMode changes
  useEffect(() => {
    const generated = generatePasses(parseResult, lodMode);
    setPasses(generated.passes);
    setStats(generated.stats);
    setZLevels(generated.zLevels);
    setSelectedPassId(null);
    setSelectedLineNum(null);
    setPlayStep(null);
    setIsPlaying(false);
  }, [parseResult, lodMode]);

  // Simulation timer loop
  useEffect(() => {
    if (!isPlaying || !stats) return;
    const total = stats.renderedSegments;
    if (total === 0) {
      setIsPlaying(false);
      return;
    }

    const timer = window.setInterval(() => {
      setPlayStep((prev) => {
        const current = prev === null ? 0 : prev;
        const next = Math.min(total, current + playSpeed);
        if (next >= total) {
          setIsPlaying(false);
          return null;
        }
        return next;
      });
    }, 28);

    return () => window.clearInterval(timer);
  }, [isPlaying, playSpeed, stats]);

  const handleFileImport = useCallback(async (file: File) => {
    setIsPlaying(false);
    setFilename(file.name);
    setLoadingProgress({ pct: 0, lines: 0 });
    try {
      const parsed = await parseNCFileStreaming(file, (pct, lines) => {
        setLoadingProgress({ pct, lines });
      });
      setParseResult(parsed);
      setActiveTab('viewport');
    } finally {
      setLoadingProgress(null);
    }
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleFileImport(file);
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    if (!authUser || isLicenseExpired) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFileImport(file);
    }
  };

  const handleTogglePassVisibility = useCallback((passId: number) => {
    setPasses((prev) =>
      prev.map((p) => (p.passId === passId ? { ...p, visible: !p.visible } : p))
    );
  }, []);

  const handleToggleZLevelVisibility = useCallback((zLevel: number) => {
    setPasses((prev) => {
      const group = prev.filter((p) => p.zLevel === zLevel);
      const anyVisible = group.some((p) => p.visible);
      return prev.map((p) => (p.zLevel === zLevel ? { ...p, visible: !anyVisible } : p));
    });
  }, []);

  const handleShowAllPasses = useCallback(() => {
    setPasses((prev) => prev.map((p) => ({ ...p, visible: true })));
  }, []);

  const handleSelectPass = useCallback((pass: ToolpathPass) => {
    setSelectedPassId(pass.passId);
    setSelectedLineNum(pass.startLine);
  }, []);

  const handleSelectLine = useCallback(
    (lineNum: number) => {
      setSelectedLineNum(lineNum);
      const owner = passes.find((p) => lineNum >= p.startLine && lineNum <= p.endLine);
      if (owner) setSelectedPassId(owner.passId);
    },
    [passes]
  );

  const handleTogglePlay = () => {
    if (!stats || stats.renderedSegments === 0) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (playStep === null || playStep >= stats.renderedSegments) {
      setPlayStep(0);
    }
    setIsPlaying(true);
  };

  const handleResetPlay = () => {
    setIsPlaying(false);
    setPlayStep(0);
  };

  const handleStepPass = (delta: number) => {
    setIsPlaying(false);
    if (passes.length === 0) return;
    const boundaries = [0];
    let cum = 0;
    for (const p of passes) {
      cum += p.segments.length;
      boundaries.push(cum);
    }
    const current = playStep === null ? cum : playStep;
    let next = current;
    if (delta > 0) {
      next = boundaries.find((b) => b > current) ?? cum;
    } else {
      const prevs = boundaries.filter((b) => b < current);
      next = prevs.length > 0 ? prevs[prevs.length - 1] : 0;
    }
    setPlayStep(next >= cum ? null : next);
  };

  const selectedPass = useMemo(
    () => passes.find((p) => p.passId === selectedPassId) ?? null,
    [passes, selectedPassId]
  );

  const exportBaseName = filename.replace(/\.[^.]+$/, '') || 'paas_wiver_export';

  const accountSummaryText = useMemo(() => {
    if (!authUser) return '';
    if (isAdminUser) return `Admin (${authUser.email || 'admin'})`;
    if (!license) return 'Checking license...';
    return `${license.username} · ${formatRemainingTime(license.expiresAtMs, nowMs)}`;
  }, [authUser, isAdminUser, license, nowMs]);

  if (!authReady) {
    return (
      <div className="h-screen w-screen bg-[#0B0F17] text-slate-300 flex items-center justify-center text-sm font-mono">
        Initializing PAAS WIVER...
      </div>
    );
  }

  if (!authUser) {
    return (
      <LicenseGateModal
        mode="auth"
        license={null}
        onSignOut={handleSignOut}
        onRefreshLicense={handleRefreshLicense}
      />
    );
  }

  if (!isAdminUser && !licenseLoaded) {
    return (
      <div className="h-screen w-screen bg-[#0B0F17] text-slate-300 flex items-center justify-center text-sm font-mono">
        Verifying license status...
      </div>
    );
  }

  return (
    <div
      className="h-screen w-screen overflow-hidden flex flex-col bg-[#0B0F17] text-slate-100"
      onDragOver={(e) => {
        e.preventDefault();
        if (!isLicenseExpired) setIsDraggingFile(true);
      }}
      onDragLeave={() => setIsDraggingFile(false)}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".nc,.tap,.ptp,.cnc,.mpf,.txt,.cls,.gcode"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Top Bar Contract: Brand Wordmark — Nav Links — 1 Primary Action */}
      <header className="h-13 px-6 bg-[#111827] border-b border-slate-800 flex items-center justify-between gap-8 shrink-0">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('viewport');
          }}
          className="text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          PAAS WIVER
        </a>

        <nav className="flex items-center gap-6 text-sm font-medium overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('viewport')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'viewport'
                ? 'border-cyan-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            Toolpath Viewport
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'schedule'
                ? 'border-cyan-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            Pass Schedule
          </button>
          {isAdminUser && (
            <button
              type="button"
              onClick={() => setActiveTab('admin')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'admin'
                  ? 'border-cyan-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              License Admin
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab('desktop')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'desktop'
                ? 'border-cyan-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            EXE &amp; APK Builds
          </button>
        </nav>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-1.5 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white rounded-md flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>Import NC File</span>
        </button>
      </header>

      {/* Secondary Workspace Toolbar */}
      <div className="px-4 py-2 bg-[#0D131F] border-b border-slate-800 flex items-center justify-between gap-4 flex-wrap shrink-0">
        {activeTab === 'viewport' || activeTab === 'schedule' ? (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap">
              <span>LOD Decimation:</span>
              <select
                value={lodMode}
                onChange={(e) => setLodMode(e.target.value as LodMode)}
                className="bg-[#111827] border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200"
              >
                <option value="auto">Auto (&gt;18k segs)</option>
                <option value="full">Full Detail (100%)</option>
                <option value="fast">Fast Thinning (Low-Spec)</option>
              </select>
            </label>

            {(selectedPassId !== null || selectedLineNum !== null) && (
              <>
                <span className="text-slate-700" aria-hidden="true">|</span>
                <button
                  type="button"
                  onClick={handleClearSelection}
                  className="px-2.5 py-1 text-xs font-mono bg-[#111827] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded transition-colors whitespace-nowrap shrink-0"
                >
                  Clear Selection (Esc)
                </button>
              </>
            )}

            <span className="text-slate-700" aria-hidden="true">|</span>
            <span className="text-xs font-mono text-slate-400 truncate max-w-[200px]" title={filename || 'No file loaded'}>
              {filename || 'No file loaded'}
            </span>
          </div>
        ) : (
          <div className="text-xs font-mono text-slate-400">
            {activeTab === 'admin'
              ? 'Firebase License & User Expiry Console'
              : 'Windows .EXE & Android Admin .APK Builders'}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {(activeTab === 'viewport' || activeTab === 'schedule') && (
            <>
              <button
                type="button"
                disabled={passes.length === 0}
                onClick={() => exportReindexedNC(passes, exportBaseName)}
                className="px-2.5 py-1 text-xs bg-[#111827] border border-slate-700 hover:border-slate-500 disabled:opacity-40 text-slate-200 rounded flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <Download className="w-3 h-3" />
                <span>Export .NC</span>
              </button>
              <button
                type="button"
                disabled={passes.length === 0}
                onClick={() => stats && exportPassSummaryTXT(passes, stats, parseResult.sourceFormat, exportBaseName)}
                className="px-2.5 py-1 text-xs bg-[#111827] border border-slate-700 hover:border-slate-500 disabled:opacity-40 text-slate-200 rounded whitespace-nowrap shrink-0"
              >
                Export .TXT
              </button>
              <button
                type="button"
                disabled={passes.length === 0}
                onClick={() => exportPassesCSV(passes, exportBaseName)}
                className="px-2.5 py-1 text-xs bg-[#111827] border border-slate-700 hover:border-slate-500 disabled:opacity-40 text-slate-200 rounded whitespace-nowrap shrink-0"
              >
                Export .CSV
              </button>
              <span className="text-slate-700" aria-hidden="true">|</span>
            </>
          )}

          <span className="text-xs font-mono tabular-nums text-cyan-300 whitespace-nowrap">
            {accountSummaryText}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            className="px-2.5 py-1 text-xs bg-[#111827] border border-slate-700 hover:border-rose-500/70 text-slate-200 rounded flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3 h-3" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === 'viewport' && (
        <main className="flex-1 flex min-h-0 overflow-hidden">
          <LeftPassPanel
            sourceFormat={parseResult.sourceFormat}
            units={parseResult.units}
            stats={stats}
            passes={passes}
            zLevels={zLevels}
            display={display}
            onDisplayChange={setDisplay}
            selectedPassId={selectedPassId}
            onSelectPass={handleSelectPass}
            onTogglePassVisibility={handleTogglePassVisibility}
            onToggleZLevelVisibility={handleToggleZLevelVisibility}
            onShowAllPasses={handleShowAllPasses}
          />

          <ToolpathViewport
            passes={passes}
            stats={stats}
            units={parseResult.units}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            display={display}
            selectedPassId={selectedPassId}
            selectedLineNum={selectedLineNum}
            onSelectSegment={(pid, lnum) => {
              setSelectedPassId(pid);
              setSelectedLineNum(lnum);
            }}
            onClearSelection={handleClearSelection}
            onImportFile={() => fileInputRef.current?.click()}
            playStep={playStep}
            isPlaying={isPlaying}
            playSpeed={playSpeed}
            onTogglePlay={handleTogglePlay}
            onResetPlay={handleResetPlay}
            onStepPass={handleStepPass}
            onPlayStepChange={(step) => {
              setIsPlaying(false);
              setPlayStep(stats && step >= stats.renderedSegments ? null : step);
            }}
            onPlaySpeedChange={setPlaySpeed}
          />

          <NcInspectorPanel
            rawLines={parseResult.rawLines}
            selectedPass={selectedPass}
            selectedLineNum={selectedLineNum}
            onSelectLine={handleSelectLine}
            onClearSelection={handleClearSelection}
          />
        </main>
      )}

      {activeTab === 'schedule' && (
        <PassSummaryTable
          passes={passes}
          units={parseResult.units}
          selectedPassId={selectedPassId}
          onInspectPassInViewport={(pass) => {
            handleSelectPass(pass);
            setActiveTab('viewport');
          }}
          onTogglePassVisibility={handleTogglePassVisibility}
        />
      )}

      {activeTab === 'admin' && isAdminUser && <AdminLicensePanel />}

      {activeTab === 'desktop' && <DesktopPackageView />}

      {/* Blocking License Expired Popup */}
      {isLicenseExpired && (
        <LicenseGateModal
          mode="expired"
          license={license}
          onSignOut={handleSignOut}
          onRefreshLicense={handleRefreshLicense}
        />
      )}

      {/* Streaming Import Progress Overlay */}
      {loadingProgress && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#111827] border border-slate-700 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between text-sm font-medium text-white">
              <span>Streaming {filename}...</span>
              <span className="font-mono text-cyan-400">{loadingProgress.pct}%</span>
            </div>
            <div className="h-2 bg-slate-800 rounded overflow-hidden">
              <div
                className="h-full bg-cyan-500 transition-all duration-75"
                style={{ width: `${loadingProgress.pct}%` }}
              />
            </div>
            <div className="text-xs font-mono text-slate-400">
              {loadingProgress.lines.toLocaleString()} lines parsed in non-blocking chunks
            </div>
          </div>
        </div>
      )}

      {/* Drag & Drop File Overlay */}
      {isDraggingFile && !isLicenseExpired && (
        <div className="fixed inset-0 z-40 bg-cyan-950/60 border-2 border-dashed border-cyan-400 flex items-center justify-center pointer-events-none">
          <div className="px-6 py-4 bg-[#111827] border border-cyan-500 rounded-lg text-sm font-medium text-white">
            Drop .nc, .tap, .ptp, .cnc, .mpf, or .txt toolpath file to parse
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
