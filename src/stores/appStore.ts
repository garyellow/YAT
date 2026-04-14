import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { normalizePlatform, type DesktopPlatform } from "../lib/settingsFormatters";
import { isTauriRuntime } from "../lib/tauriRuntime";

interface PlatformPayload {
  os: string;
  display_server?: string;
}

export type PermissionState =
  | "granted"
  | "denied"
  | "not_determined"
  | "not_applicable"
  | "unknown";

export interface PermissionStatus {
  microphone: PermissionState;
  accessibility: PermissionState;
  screen_recording: PermissionState;
  pactl_available: boolean | null;
  playerctl_available: boolean | null;
}

interface AppStoreState {
  platform: DesktopPlatform;
  displayServer: string | null;
  platformLoaded: boolean;
  permissions: PermissionStatus | null;
  permissionsLoaded: boolean;
  loadPlatform: () => Promise<void>;
  loadPermissions: () => Promise<void>;
  requestPermission: (category: string) => Promise<PermissionState>;
}

const DEFAULT_PERMISSIONS: PermissionStatus = {
  microphone: "unknown",
  accessibility: "not_applicable",
  screen_recording: "not_applicable",
  pactl_available: null,
  playerctl_available: null,
};

export const useAppStore = create<AppStoreState>((set, get) => ({
  platform: "unknown",
  displayServer: null,
  platformLoaded: false,
  permissions: null,
  permissionsLoaded: false,

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

  loadPermissions: async () => {
    if (!isTauriRuntime()) {
      set({ permissions: DEFAULT_PERMISSIONS, permissionsLoaded: true });
      return;
    }

    try {
      const status = await invoke<PermissionStatus>("check_permissions");
      set({ permissions: status, permissionsLoaded: true });
    } catch {
      set({ permissions: DEFAULT_PERMISSIONS, permissionsLoaded: true });
    }
  },

  requestPermission: async (category: string): Promise<PermissionState> => {
    if (!isTauriRuntime()) return "unknown";

    try {
      const state = await invoke<PermissionState>("request_permission", { category });
      // Refresh the full permissions snapshot after a request
      await get().loadPermissions();
      return state;
    } catch {
      return "unknown";
    }
  },
}));
