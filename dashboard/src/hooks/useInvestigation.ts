"use client";
import { create } from "zustand";
import type { BackendRequestRecord } from "../services/api";
import { emptyScope, type Scope } from "../lib/investigation";
// Keep the investigation across client navigation, without persisting captures to storage.
interface State {
  records: BackendRequestRecord[];
  pending: BackendRequestRecord[] | null;
  scope: Scope;
  pendingAt: Date | null;
  selected: string;
  live: boolean;
  lastRefresh: Date | null;
  search: string;
  set: (patch: Partial<Omit<State, "set">>) => void;
}
export const useInvestigation = create<State>()((set) => ({
  records: [],
  pending: null,
  pendingAt: null,
  scope: { ...emptyScope },
  selected: "",
  live: false,
  lastRefresh: null,
  search: "",
  set,
}));
