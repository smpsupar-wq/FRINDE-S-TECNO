import React, { useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { Clock, Plus, Trash2, UserPlus } from 'lucide-react';
import {
  createProvisionedAuthUser,
  db,
  handleFirestoreError,
  OperationType,
  sanitizeUsername,
} from '../firebase';
import type { LicenseRecord } from './LicenseGateModal';

export function formatRemainingTime(expiresAtMs: number, nowMs: number): string {
  const diff = expiresAtMs - nowMs;
  if (diff <= 0) {
    const agoMin = Math.floor(Math.abs(diff) / 60000);
    if (agoMin < 60) return `Expired ${agoMin}m ago`;
    const agoHr = Math.floor(agoMin / 60);
    if (agoHr < 24) return `Expired ${agoHr}h ago`;
    return `Expired ${Math.floor(agoHr / 24)}d ago`;
  }
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m left`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s left`;
  return `${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s left`;
}

export const AdminLicensePanel: React.FC = () => {
  const [users, setUsers] = useState<LicenseRecord[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [durationPreset, setDurationPreset] = useState<string>('10m');
  const [customDateTime, setCustomDateTime] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editDateValue, setEditDateValue] = useState<string>('');
  const [sectionFilter, setSectionFilter] = useState<'trial' | 'active' | 'expired' | 'all'>('trial');

  // Live 1-second tick for countdown timers
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Live Firestore listener for all /licenses
  useEffect(() => {
    const q = query(collection(db, 'licenses'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: LicenseRecord[] = snap.docs.map((d) => {
          const data = d.data();
          const exp = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : Date.now();
          const cre = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
          const upd = data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : Date.now();
          return {
            uid: String(data.uid || d.id),
            ownerUid: String(data.ownerUid || d.id),
            username: String(data.username || 'user'),
            role: data.role === 'admin' ? 'admin' : 'user',
            status: data.status === 'active' ? 'active' : data.status === 'expired' ? 'expired' : 'trial',
            trialGranted: Boolean(data.trialGranted),
            expiresAtMs: exp,
            createdAtMs: cre,
            updatedAtMs: upd,
          };
        });
        setUsers(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'licenses');
      }
    );
    return () => unsub();
  }, []);

  const computeTargetExpiryMs = (): number => {
    const now = Date.now();
    if (durationPreset === 'custom' && customDateTime) {
      const parsed = new Date(customDateTime).getTime();
      if (!Number.isNaN(parsed)) return parsed;
    }
    const map: Record<string, number> = {
      '10m': 10 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '365d': 365 * 24 * 60 * 60 * 1000,
    };
    return now + (map[durationPreset] ?? 10 * 60 * 1000);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = sanitizeUsername(newUsername);
    if (clean.length < 2 || clean.length > 40) {
      setErrorMsg('Username must be 2–40 valid characters (letters, numbers, _, ., -).');
      return;
    }
    if (newPassword.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const uid = await createProvisionedAuthUser(clean, newPassword);
      const targetMs = computeTargetExpiryMs();
      const isTrial = durationPreset === '10m';
      try {
        await setDoc(doc(db, 'licenses', uid), {
          uid,
          ownerUid: uid,
          username: clean,
          role: 'user',
          status: isTrial ? 'trial' : 'active',
          trialGranted: true,
          expiresAt: Timestamp.fromMillis(targetMs),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (fsErr) {
        handleFirestoreError(fsErr, OperationType.CREATE, `licenses/${uid}`);
      }
      setNewUsername('');
      setNewPassword('');
      setStatusMsg(`User "${clean}" created with license until ${new Date(targetMs).toLocaleString()}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(
        msg.includes('auth/operation-not-allowed')
          ? 'Enable Email/Password in Firebase Console -> Authentication -> Sign-in method first.'
          : msg
      );
    } finally {
      setBusy(false);
    }
  };

  const handleExtendBy = async (user: LicenseRecord, addMs: number) => {
    setErrorMsg(null);
    const baseMs = Math.max(Date.now(), user.expiresAtMs);
    const nextMs = baseMs + addMs;
    try {
      await updateDoc(doc(db, 'licenses', user.uid), {
        expiresAt: Timestamp.fromMillis(nextMs),
        status: 'active',
        updatedAt: serverTimestamp(),
      });
      setStatusMsg(`Extended "${user.username}" to ${new Date(nextMs).toLocaleString()}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `licenses/${user.uid}`);
    }
  };

  const handleSaveCustomExpiry = async (user: LicenseRecord) => {
    if (!editDateValue) return;
    const targetMs = new Date(editDateValue).getTime();
    if (Number.isNaN(targetMs)) return;
    try {
      await updateDoc(doc(db, 'licenses', user.uid), {
        expiresAt: Timestamp.fromMillis(targetMs),
        status: targetMs > Date.now() ? 'active' : 'expired',
        updatedAt: serverTimestamp(),
      });
      setEditingUid(null);
      setStatusMsg(`Updated "${user.username}" expiry to ${new Date(targetMs).toLocaleString()}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `licenses/${user.uid}`);
    }
  };

  const handleDeleteUser = async (user: LicenseRecord) => {
    if (!window.confirm(`Delete user "${user.username}"? They will immediately lose access to PAAS WIVER.`)) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'licenses', user.uid));
      setStatusMsg(`Deleted user "${user.username}".`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `licenses/${user.uid}`);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#080C13] p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Create User Form */}
        <form
          onSubmit={handleCreateUser}
          className="bg-[#111827] border border-slate-800 rounded-lg p-5 space-y-4"
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">Create User &amp; Set License Expiry</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Assign username, password, and custom expiry time. Changes sync immediately to Desktop .EXE and Android .APK.
              </p>
            </div>
            <span className="text-xs font-mono text-cyan-400">{users.length} Users</span>
          </div>

          {errorMsg && (
            <div className="p-3 bg-rose-950/50 border border-rose-500/40 rounded text-xs text-rose-200">
              {errorMsg}
            </div>
          )}
          {statusMsg && (
            <div className="p-3 bg-emerald-950/50 border border-emerald-500/40 rounded text-xs text-emerald-200">
              {statusMsg}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Username</label>
              <input
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="operator_01"
                className="w-full bg-[#080C13] border border-slate-700 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Password</label>
              <input
                type="text"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 6 chars"
                className="w-full bg-[#080C13] border border-slate-700 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">License Duration</label>
              <select
                value={durationPreset}
                onChange={(e) => setDurationPreset(e.target.value)}
                className="w-full bg-[#080C13] border border-slate-700 rounded px-3 py-2 text-xs font-mono text-white"
              >
                <option value="10m">10 Minutes (Trial)</option>
                <option value="1h">1 Hour</option>
                <option value="1d">1 Day</option>
                <option value="7d">7 Days</option>
                <option value="30d">30 Days</option>
                <option value="365d">1 Year</option>
                <option value="custom">Custom Date/Time</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2 px-4 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded flex items-center justify-center gap-1.5 transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{busy ? 'Creating...' : 'Create User'}</span>
              </button>
            </div>
          </div>

          {durationPreset === 'custom' && (
            <div className="max-w-xs">
              <label className="block text-xs text-slate-400 mb-1">Custom Expiry Date &amp; Time</label>
              <input
                type="datetime-local"
                value={customDateTime}
                onChange={(e) => setCustomDateTime(e.target.value)}
                className="w-full bg-[#080C13] border border-slate-700 rounded px-3 py-2 text-xs font-mono text-white"
              />
            </div>
          )}
        </form>

        {/* Users Table */}
        <div className="bg-[#111827] border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {(
                [
                  ['trial', 'Trial', users.filter((u) => u.status === 'trial').length],
                  ['active', 'Active', users.filter((u) => u.status !== 'trial' && u.expiresAtMs > nowMs).length],
                  ['expired', 'Expired', users.filter((u) => u.expiresAtMs <= nowMs).length],
                  ['all', 'All', users.length],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSectionFilter(key)}
                  className={`px-3 py-1 text-xs font-mono rounded transition-colors ${
                    sectionFilter === key
                      ? 'bg-cyan-600 text-white'
                      : 'bg-[#080C13] border border-slate-700 text-slate-300 hover:text-white'
                  }`}
                >
                  {label} ({count})
                </button>
              ))}
            </div>
            <span className="text-xs font-mono text-slate-400">Real-time countdown sync</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#0D131F] border-b border-slate-800 text-slate-400 font-medium">
                  <th className="py-2.5 px-4">Username</th>
                  <th className="py-2.5 px-4">State</th>
                  <th className="py-2.5 px-4">Remaining Time</th>
                  <th className="py-2.5 px-4">Expires At</th>
                  <th className="py-2.5 px-4">Extend License</th>
                  <th className="py-2.5 px-4 text-right">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {(() => {
                  const filteredUsers = users.filter((u) => {
                    if (sectionFilter === 'trial') return u.status === 'trial';
                    if (sectionFilter === 'active') return u.status !== 'trial' && u.expiresAtMs > nowMs;
                    if (sectionFilter === 'expired') return u.expiresAtMs <= nowMs;
                    return true;
                  });
                  if (filteredUsers.length === 0) {
                    return (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500">
                          No users in this section yet.
                        </td>
                      </tr>
                    );
                  }
                  return filteredUsers.map((u) => {
                    const isExpired = u.expiresAtMs <= nowMs;
                    const remText = formatRemainingTime(u.expiresAtMs, nowMs);
                    return (
                      <tr key={u.uid} className="hover:bg-slate-800/30">
                        <td className="py-2.5 px-4 font-mono font-semibold text-white">{u.username}</td>
                        <td className="py-2.5 px-4 font-mono">
                          <span
                            className={
                              isExpired
                                ? 'text-rose-400'
                                : u.status === 'trial'
                                ? 'text-amber-300'
                                : 'text-emerald-400'
                            }
                          >
                            {isExpired ? 'Expired' : u.status === 'trial' ? '10m Trial' : 'Active'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-mono">
                          <span className={`inline-flex items-center gap-1.5 ${isExpired ? 'text-rose-300' : 'text-cyan-300'}`}>
                            <Clock className="w-3.5 h-3.5" />
                            <span>{remText}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-300">
                          {editingUid === u.uid ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="datetime-local"
                                value={editDateValue}
                                onChange={(e) => setEditDateValue(e.target.value)}
                                className="bg-[#080C13] border border-slate-700 rounded px-2 py-1 text-xs text-white"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveCustomExpiry(u)}
                                className="px-2 py-1 bg-cyan-600 text-white rounded text-[11px]"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingUid(null)}
                                className="px-2 py-1 bg-slate-800 text-slate-300 rounded text-[11px]"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            new Date(u.expiresAtMs).toLocaleString()
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-1 flex-wrap font-mono">
                            <button
                              type="button"
                              onClick={() => handleExtendBy(u, 10 * 60 * 1000)}
                              className="px-2 py-1 bg-[#080C13] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded text-[11px]"
                            >
                              +10m
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExtendBy(u, 24 * 60 * 60 * 1000)}
                              className="px-2 py-1 bg-[#080C13] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded text-[11px]"
                            >
                              +1d
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExtendBy(u, 7 * 24 * 60 * 60 * 1000)}
                              className="px-2 py-1 bg-[#080C13] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded text-[11px]"
                            >
                              +7d
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExtendBy(u, 30 * 24 * 60 * 60 * 1000)}
                              className="px-2 py-1 bg-[#080C13] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded text-[11px]"
                            >
                              +30d
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const iso = new Date(Math.max(Date.now(), u.expiresAtMs) - new Date().getTimezoneOffset() * 60000)
                                  .toISOString()
                                  .slice(0, 16);
                                setEditDateValue(iso);
                                setEditingUid(u.uid);
                              }}
                              className="px-2 py-1 bg-[#080C13] border border-slate-700 hover:border-cyan-500 text-cyan-300 rounded text-[11px] inline-flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Date</span>
                            </button>
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(u)}
                            title={`Delete ${u.username}`}
                            className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 rounded transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
