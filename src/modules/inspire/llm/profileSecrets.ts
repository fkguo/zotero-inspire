import type { AIProfile } from "./profileStore";
import {
  clearAIProviderApiKey,
  getAIProviderApiKey,
  getAIProviderStorageDebugInfo,
  setAIProviderApiKey,
  type AISecretStorageType,
} from "./secretStore";

export function getAIProfileSecretId(profile: Pick<AIProfile, "id" | "provider">): string {
  return `profile:${profile.provider}:${profile.id}`;
}

export function getLegacyAIProfileSecretId(profile: Pick<AIProfile, "id">): string {
  return `profile:${profile.id}`;
}

export async function getAIProfileApiKey(profile: Pick<AIProfile, "id" | "provider">): Promise<{
  apiKey: string | null;
  storage: AISecretStorageType;
  migratedFromLegacy: boolean;
  providerId: string;
}> {
  const providerId = getAIProfileSecretId(profile);
  const primary = await getAIProviderApiKey(providerId);
  if (primary.apiKey) {
    return { ...primary, providerId, migratedFromLegacy: false };
  }

  const legacyId = getLegacyAIProfileSecretId(profile);
  const legacy = await getAIProviderApiKey(legacyId);
  if (!legacy.apiKey) {
    return { ...primary, providerId, migratedFromLegacy: false };
  }

  await setAIProviderApiKey(providerId, legacy.apiKey);
  await clearAIProviderApiKey(legacyId);
  const migrated = await getAIProviderApiKey(providerId);
  return { ...migrated, providerId, migratedFromLegacy: true };
}

export async function setAIProfileApiKey(
  profile: Pick<AIProfile, "id" | "provider">,
  apiKey: string,
): Promise<{ ok: boolean; storage: AISecretStorageType; providerId: string }> {
  const providerId = getAIProfileSecretId(profile);
  const stored = await setAIProviderApiKey(providerId, apiKey);
  await clearAIProviderApiKey(getLegacyAIProfileSecretId(profile));
  return { ...stored, providerId };
}

export async function clearAIProfileApiKey(
  profile: Pick<AIProfile, "id" | "provider">,
): Promise<{ ok: boolean; storage: AISecretStorageType; providerId: string }> {
  const providerId = getAIProfileSecretId(profile);
  const a = await clearAIProviderApiKey(providerId);
  const b = await clearAIProviderApiKey(getLegacyAIProfileSecretId(profile));
  return { ok: a.ok || b.ok, storage: a.storage, providerId };
}

export function getAIProfileStorageDebugInfo(profile: Pick<AIProfile, "id" | "provider">): {
  providerId: string;
  loginHostname: string;
  loginRealm: string;
  loginUsername: string;
  prefsKey: string;
} {
  const providerId = getAIProfileSecretId(profile);
  return { providerId, ...getAIProviderStorageDebugInfo(providerId) };
}

