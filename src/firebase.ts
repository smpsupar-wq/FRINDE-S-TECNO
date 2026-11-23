import { deleteApp, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const ADMIN_BOOTSTRAP_EMAIL = 'tecnofrindes@gmail.com';

const app = initializeApp(firebaseConfig);

function createPersistentFirestore(): Firestore {
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createPersistentFirestore();
export const auth = getAuth(app);

export function sanitizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
}

export function usernameToSyntheticEmail(username: string): string {
  const clean = sanitizeUsername(username);
  return `${clean}@paaswiver.local`;
}

export interface CachedLicensePayload {
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

interface StoredLicenseEnvelope {
  license: CachedLicensePayload;
  maxObservedClockMs: number;
  checksum: string;
}

const CACHE_KEY_PREFIX = 'paas_wiver_lic_v2:';

function computeEnvelopeChecksum(
  license: CachedLicensePayload,
  maxObservedClockMs: number
): string {
  const raw = `${license.uid}|${license.username}|${license.status}|${license.expiresAtMs}|${license.updatedAtMs}|${maxObservedClockMs}|pw-v2`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function saveOfflineLicenseSnapshot(
  license: CachedLicensePayload,
  observedClockMs: number = Date.now()
): void {
  try {
    const existing = loadOfflineLicenseSnapshot(license.uid);
    const maxObservedClockMs = Math.max(
      existing?.maxObservedClockMs ?? 0,
      observedClockMs,
      Date.now(),
      license.updatedAtMs || 0,
      license.createdAtMs || 0
    );
    const envelope: StoredLicenseEnvelope = {
      license,
      maxObservedClockMs,
      checksum: computeEnvelopeChecksum(license, maxObservedClockMs),
    };
    window.localStorage.setItem(
      `${CACHE_KEY_PREFIX}${license.uid}`,
      JSON.stringify(envelope)
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function updateOfflineClockWatermark(uid: string, clockMs: number): void {
  try {
    const raw = window.localStorage.getItem(`${CACHE_KEY_PREFIX}${uid}`);
    if (!raw) return;
    const parsed = JSON.parse(raw) as StoredLicenseEnvelope;
    if (!parsed?.license || parsed.license.uid !== uid) return;
    const expected = computeEnvelopeChecksum(parsed.license, parsed.maxObservedClockMs);
    if (parsed.checksum !== expected) return;
    const nextClock = Math.max(parsed.maxObservedClockMs, clockMs);
    if (nextClock <= parsed.maxObservedClockMs) return;
    const updated: StoredLicenseEnvelope = {
      license: parsed.license,
      maxObservedClockMs: nextClock,
      checksum: computeEnvelopeChecksum(parsed.license, nextClock),
    };
    window.localStorage.setItem(`${CACHE_KEY_PREFIX}${uid}`, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}

export function loadOfflineLicenseSnapshot(uid: string): {
  license: CachedLicensePayload;
  maxObservedClockMs: number;
} | null {
  try {
    const raw = window.localStorage.getItem(`${CACHE_KEY_PREFIX}${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredLicenseEnvelope;
    if (!parsed?.license || parsed.license.uid !== uid) return null;
    const expected = computeEnvelopeChecksum(parsed.license, parsed.maxObservedClockMs);
    if (parsed.checksum !== expected) return null;
    return {
      license: parsed.license,
      maxObservedClockMs: parsed.maxObservedClockMs,
    };
  } catch {
    return null;
  }
}

export function clearOfflineLicenseSnapshot(uid: string): void {
  try {
    window.localStorage.removeItem(`${CACHE_KEY_PREFIX}${uid}`);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Provisions a new username/password Firebase Auth account using a temporary
 * secondary app instance so the currently signed-in Admin is NOT signed out.
 */
export async function createProvisionedAuthUser(
  username: string,
  password: string
): Promise<string> {
  const email = usernameToSyntheticEmail(username);
  const secondaryApp = initializeApp(firebaseConfig, `provisioner-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    return cred.user.uid;
  } finally {
    await signOut(secondaryAuth).catch(() => undefined);
    await deleteApp(secondaryApp).catch(() => undefined);
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();
