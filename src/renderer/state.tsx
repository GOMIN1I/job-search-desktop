import { createContext, useContext } from "react";
import type { Candidate } from "../shared/types";

export type Page = "today" | "vacancies" | "applications" | "profile" | "settings" | "onboarding";

export interface AppInfo {
  version: string;
  platform: string;
  dataDir: string;
  schemaVersion: number;
  lang: "ru" | "en";
  activeCandidate: string | null;
  counts: { candidates: number; vacancies: number; applications: number; materials: number; runs: number };
  onboarded: boolean;
}

export interface RunState {
  running: boolean;
  runId: string | null;
  progress: { phase?: string; sourceId?: string; stats?: Record<string, number> } | null;
}

export interface AppCtx {
  info: AppInfo;
  candidates: Candidate[];
  candidate: Candidate | null;
  setCandidate: (id: string) => void;
  page: Page;
  go: (p: Page, opts?: { vacancyId?: string | null; applicationVacancyId?: string | null }) => void;
  focusVacancy: string | null;
  focusApplication: string | null;
  version: number; // увеличивается при изменении данных → страницы перезагружают данные
  run: RunState;
  startRun: () => Promise<void>;
  cancelRun: () => Promise<void>;
  reload: () => Promise<void>;
}

export const AppContext = createContext<AppCtx>(null as any);
export const useApp = () => useContext(AppContext);
