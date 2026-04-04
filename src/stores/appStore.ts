import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { normalizePlatform, type DesktopPlatform } from "../lib/settingsFormatters";

interface PlatformPayload {
  os: string;
}

interface AppStoreState {
  platform: DesktopPlatform;
  platformLoaded: boolean;
  loadPlatform: () => Promise<void>;
}

export const useAppStore = create<AppStoreState>((set) => ({
  platform: "unknown",
  platformLoaded: false,

  loadPlatform: async () => {
    try {
      const payload = await invoke<PlatformPayload>("get_platform_context");
      set({
        platform: normalizePlatform(payload.os),
        platformLoaded: true,
      });
    } catch {
      set({ platformLoaded: true });
    }
  },
}));
