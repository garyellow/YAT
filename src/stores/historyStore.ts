import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { isTauriRuntime } from "../lib/tauriRuntime";

export interface HistoryEntry {
  id: string;
  raw_text: string;
  polished_text: string | null;
  created_at: string;
  duration_seconds: number;
  status: string;
  app_name?: string | null;
  window_title?: string | null;
  audio_path?: string | null;
}

type RetryType = "polish" | "retranscribe" | null;

interface HistoryState {
  entries: HistoryEntry[];
  loading: boolean;
  searchQuery: string;
  retryingId: string | null;
  retryingType: RetryType;
  retryError: string | null;
  setSearchQuery: (q: string) => void;
  loadHistory: () => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  retryEntry: (id: string) => Promise<void>;
  retryFromAudio: (id: string) => Promise<void>;
  clearOld: () => Promise<void>;
  clearAll: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  loading: false,
  searchQuery: "",
  retryingId: null,
  retryingType: null,
  retryError: null,

  setSearchQuery: (q: string) => set({ searchQuery: q }),

  loadHistory: async () => {
    set({ loading: true, retryError: null });

    if (!isTauriRuntime()) {
      set({ entries: [], loading: false });
      return;
    }

    try {
      const q = get().searchQuery || null;
      const entries = await invoke<HistoryEntry[]>("get_history", {
        query: q,
        limit: 200,
      });
      set({ entries, loading: false });
    } catch (e) {
      console.error("Failed to load history:", e);
      set({ loading: false });
    }
  },

  deleteEntry: async (id: string) => {
    set({ retryError: null });

    if (!isTauriRuntime()) {
      return;
    }

    try {
      await invoke("delete_history", { id });
      await get().loadHistory();
    } catch (e) {
      console.error("Failed to delete history entry:", e);
    }
  },

  retryEntry: async (id: string) => {
    set({ retryingId: id, retryingType: "polish", retryError: null });

    if (!isTauriRuntime()) {
      set({ retryingId: null, retryingType: null });
      return;
    }

    try {
      await invoke("retry_history", { id });
      set({ retryingId: null, retryingType: null });
      await get().loadHistory();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("Failed to retry history entry:", message);
      set({ retryingId: null, retryingType: null, retryError: message });
    }
  },

  retryFromAudio: async (id: string) => {
    set({ retryingId: id, retryingType: "retranscribe", retryError: null });

    if (!isTauriRuntime()) {
      set({ retryingId: null, retryingType: null });
      return;
    }

    try {
      await invoke("retry_history_from_audio", { id });
      set({ retryingId: null, retryingType: null });
      await get().loadHistory();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("Failed to retry from audio:", message);
      set({ retryingId: null, retryingType: null, retryError: message });
    }
  },

  clearOld: async () => {
    set({ retryError: null });

    if (!isTauriRuntime()) {
      return;
    }

    try {
      await invoke("clear_old_history");
      await get().loadHistory();
    } catch (e) {
      console.error("Failed to clear old history:", e);
    }
  },

  clearAll: async () => {
    set({ retryError: null });

    if (!isTauriRuntime()) {
      return;
    }

    try {
      await invoke("clear_all_history");
      await get().loadHistory();
    } catch (e) {
      console.error("Failed to clear all history:", e);
    }
  },
}));
