import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export interface HistoryEntry {
  id: string;
  raw_text: string;
  polished_text: string | null;
  created_at: string;
  duration_seconds: number;
  status: string;
}

interface HistoryState {
  entries: HistoryEntry[];
  loading: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  loadHistory: () => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  retryEntry: (id: string) => Promise<void>;
  clearOld: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  loading: false,
  searchQuery: "",

  setSearchQuery: (q: string) => set({ searchQuery: q }),

  loadHistory: async () => {
    set({ loading: true });
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
    try {
      await invoke("delete_history", { id });
      await get().loadHistory();
    } catch (e) {
      console.error("Failed to delete history entry:", e);
    }
  },

  retryEntry: async (id: string) => {
    try {
      await invoke("retry_history", { id });
      await get().loadHistory();
    } catch (e) {
      console.error("Failed to retry history entry:", e);
    }
  },

  clearOld: async () => {
    try {
      await invoke("clear_old_history");
      await get().loadHistory();
    } catch (e) {
      console.error("Failed to clear old history:", e);
    }
  },
}));
