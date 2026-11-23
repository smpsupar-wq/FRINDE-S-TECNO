import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { KeyRound, Lock, LogOut, RefreshCw, UserPlus } from 'lucide-react';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  sanitizeUsername,
  saveOfflineLicenseSnapshot,
  usernameToSyntheticEmail,
} from '../firebase';

export interface LicenseRecord {
  uid: string;
  ownerUid: string;
  username: string;
  role: 'user' | 'admin';
  status: 'trial' | 'active' | 'expired';
  trialGranted: boolean;
  expiresAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
}

interface LicenseGateModalProps {
  mode: 'auth' | 'expired';
  license: LicenseRecord | null;
  onSignOut: () => void;
  onRefreshLicense: () => Promise<{ ok: boolean; message?: string }>;
}

export const LicenseGateModal: React.FC<LicenseGateModalProps> = ({
  mode,
  license,
  onSignOut,
  onRefreshLicense,
}) => {
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshInfo, setRefreshInfo] = useState<string | null>(null);

  const mapAuthError = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('auth/operation-not-allowed')) {
      return 'Enable Email/Password sign-in in Firebase Console -> Authentication -> Sign-in method.';
    }
    if (
      msg.includes('auth/invalid-credential') ||
      msg.includes('auth/wrong-password') ||
      msg.includes('auth/user-not-found')
    ) {
      return 'Invalid username or password.';
    }
    if (msg.includes('auth/email-already-in-use')) {
      return 'Username already exists. Please Sign In instead.';
    }
    if (msg.includes('auth/weak-password')) {
      return 'Password must be at least 6 characters.';
    }
    if (msg.includes('auth/network-request-failed')) {
      return 'Internet connection required to sign in or create an account.';
    }
    return msg;
  };

  const handleUserLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sanitizeUsername(username);
    if (clean.length < 2) {
      setErrorMsg('Enter a valid username (letters, numbers, _, ., -).');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      await signInWithEmailAndPassword(auth, usernameToSyntheticEmail(clean), password);
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sanitizeUsername(username);
    if (clean.length < 2 || clean.length > 40) {
      setErrorMsg('Username must be 2–40 characters (letters, numbers, _, ., -).');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        usernameToSyntheticEmail(clean),
        password
      );
      const uid = cred.user.uid;
      const now = Date.now();
      const trialEndMs = now + 10 * 60 * 1000;
      const trialEnd = Timestamp.fromMillis(trialEndMs);

      saveOfflineLicenseSnapshot(
        {
          uid,
          ownerUid: uid,
          username: clean,
          role: 'user',
          status: 'trial',
          trialGranted: true,
          expiresAtMs: trialEndMs,
          createdAtMs: now,
          updatedAtMs: now,
        },
        now
      );

      try {
        await setDoc(doc(db, 'licenses', uid), {
          uid,
          ownerUid: uid,
          username: clean,
          role: 'user',
          status: 'trial',
          trialGranted: true,
          expiresAt: trialEnd,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (fsErr) {
        handleFirestoreError(fsErr, OperationType.CREATE, `licenses/${uid}`);
      }
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCheckRenewalClick = async () => {
    setBusy(true);
    setRefreshInfo(null);
    try {
      const res = await onRefreshLicense();
      if (!res.ok && res.message) {
        setRefreshInfo(res.message);
      } else if (res.ok && res.message) {
        setRefreshInfo(res.message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'expired') {
    return (
      <div className="fixed inset-0 z-50 bg-[#070A10]/95 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#111827] border border-amber-500/40 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">License / Free Trial Expired</h2>
              <p className="text-xs font-mono text-amber-300">
                User: {license?.username || 'Account'}
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            Your access time has expired. PAAS WIVER remains locked—even offline—until the
            administrator updates and extends your expiry date from the{' '}
            <strong className="text-white">PAAS WIVER Admin (.APK)</strong> app.
          </p>

          {license && (
            <div className="p-3 bg-[#080C13] border border-slate-800 rounded text-xs font-mono text-slate-400 space-y-1">
              <div>Target Expiry: {new Date(license.expiresAtMs).toLocaleString()}</div>
              <div>Status: Locked (Waiting for Admin Date Extension)</div>
            </div>
          )}

          {refreshInfo && (
            <div className="p-2.5 bg-[#080C13] border border-slate-700 rounded text-xs text-amber-300">
              {refreshInfo}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={handleCheckRenewalClick}
              className="flex-1 px-4 py-2 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-md flex items-center justify-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              <span>{busy ? 'Checking...' : 'Check Renewal'}</span>
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="px-4 py-2 text-xs font-medium bg-[#080C13] border border-slate-700 hover:border-slate-500 text-slate-200 rounded-md flex items-center gap-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Switch User</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#080C13] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#111827] border border-slate-800 rounded-lg overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">PAAS WIVER</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {authView === 'login'
                ? 'Sign in with your operator username and password'
                : 'Create your operator account to continue'}
            </p>
          </div>
          <KeyRound className="w-5 h-5 text-cyan-400 shrink-0" />
        </div>

        {/* Clean Sign In / Create Account Switch (No Admin or Trial tab) */}
        <div className="px-6 pt-4">
          <div className="flex items-center gap-1 p-1 bg-[#080C13] border border-slate-800 rounded-md text-xs">
            <button
              type="button"
              onClick={() => {
                setAuthView('login');
                setErrorMsg(null);
              }}
              className={`flex-1 py-1.5 font-medium rounded transition-colors ${
                authView === 'login' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthView('register');
                setErrorMsg(null);
              }}
              className={`flex-1 py-1.5 font-medium rounded transition-colors ${
                authView === 'register' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-950/50 border border-rose-500/40 rounded text-xs text-rose-200 leading-relaxed">
              {errorMsg}
            </div>
          )}

          {authView === 'login' ? (
            <form onSubmit={handleUserLogin} className="space-y-3.5">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. operator_01"
                  className="w-full bg-[#080C13] border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full bg-[#080C13] border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-md transition-colors"
              >
                {busy ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleCreateAccount} className="space-y-3.5">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Choose Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="letters, numbers, _ . -"
                  className="w-full bg-[#080C13] border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Choose Password (min 6 chars)</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full bg-[#080C13] border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-md flex items-center justify-center gap-1.5 transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{busy ? 'Creating Account...' : 'Create Account'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
