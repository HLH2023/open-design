import { describe, expect, it, vi } from 'vitest';
import {
  NO_CLOUD_MODE,
  fetchAmrModels,
  fetchAmrWalletSnapshot,
  fetchVelaLoginStatus,
  startVelaLogin,
} from '../src/providers/daemon';
import { isAmrLoggedIn } from '../src/message-center-client';

describe('telemetry-free no Cloud mode', () => {
  it('keeps Cloud/AMR compatibility calls local and network-free', async () => {
    expect(NO_CLOUD_MODE).toBe(true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchVelaLoginStatus()).resolves.toBeNull();
    await expect(fetchAmrWalletSnapshot()).resolves.toBeNull();
    await expect(fetchAmrModels()).resolves.toBeNull();
    await expect(startVelaLogin()).resolves.toEqual({ ok: false, status: 404 });
    await expect(isAmrLoggedIn()).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
