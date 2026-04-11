import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { normalizePlatform, type DesktopPlatform } from "../lib/settingsFormatters";
import { isTauriRuntime } from "../lib/tauriRuntime";

interface PlatformPayload {
  os: string;
  display_server?: string;
}

interface AppStoreState {
  platform: DesktopPlatform;
  displayServer: string | null;
  platformLoaded: boolean;
  loadPlatform: () => Promise<void>;
}

export const useAppStore = create<AppStoreState>((set) => ({
  platform: "unknown",
  displayServer: null,
  platformLoaded: false,

  loadPlatform: async () => {
    if (!isTauriRuntime()) {
      set({ platformLoaded: true });
      return;
    }

    try {
      const payload = await invoke<PlatformPayload>("get_platform_context");
      set({
        platform: normalizePlatform(payload.os),
        displayServer: payload.display_server ?? null,
        platformLoaded: true,
      });
    } catch {
      set({ platformLoaded: true });
    }
  },
}));
