// Общие доменные типы. Используются ядром, базой, main-процессом и интерфейсом.
// Имена стадий и статусов однозначны: каждое измерение имеет свой собственный набор значений.

export type ConstraintMode = "hard" | "soft" | "unset";

/** Сообщение, сгенерированное приложением, сразу на двух языках интерфейса. */
export interface Msg {
  ru: string;
  en: string;
}
export type UiLang = "ru" | "en";
export const msg = (ru: string, en: string): Msg => ({ ru, en });

export type Cefr = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export const CEFR_ORDER: Cefr[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** Направление поиска (трек). Список произвольной длины, порядок = приоритет. */
export interface Track {
  id: string;
  name: string;
  enabled: boolean;
  /** Ключевые фразы, которые должны встретиться в названии вакансии. */
  titleKeywords: string[];
  /** Сигналы задач в тексте (усиливают совпадение). */
  bodyKeywords: string[];
  /** Фразы, при которых вакансия к треку не относится. */
  excludeKeywords: string[];
  /** Для трека запрещены обязательные звонки/голосовая работа. */
  noCalls: boolean;
  templateId?: string | null;
}

export interface LanguageSkill {
  lang: string; // ISO 639-1: en, ru, de ...
  written: Cefr | null;
  spoken: Cefr | null;
  /** Источник уровня: самооценка или подтверждение (сертификат/тест). */
  basis: "self_reported" | "certified" | "unset";
}

export interface MoneyFloor {
  currency: string; // ISO 4217
  amountMonthly: number;
}

export interface SearchRules {
  tracks: Track[];
  location: {
    country: string | null; // код страны ISO alpha-2, например "RU"
    city: string | null;
    timezone: string; // IANA
  };
  countryEligibility: { mode: ConstraintMode };
  workFormat: {
    mode: ConstraintMode;
    remote: boolean;
    hybrid: boolean;
    office: boolean;
    hybridCities: string[];
  };
  pay: {
    mode: ConstraintMode;
    minimums: MoneyFloor[];
  };
  hours: {
    mode: ConstraintMode;
    earliestLocal: string; // "HH:MM"
    latestLocal: string; // "HH:MM"
    maxWeeklyHours: number | null;
  };
  languages: {
    mode: ConstraintMode;
    items: LanguageSkill[];
  };
  voice: {
    mode: ConstraintMode;
    noPhoneWork: boolean;
    noVoiceScreening: boolean;
  };
  experience: {
    mode: ConstraintMode;
    maxYearsRequired: number;
    allowSenior: boolean;
  };
  excludedKeywords: string[];
  freshnessDays: number;
}

export interface Candidate {
  id: string;
  name: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  activeProfileVersion: number;
  notes: string;
}

export type SkillEvidenceKind = "proven" | "self_reported" | "needs_example";

export interface SkillEvidence {
  id: string;
  candidateId: string;
  skill: string;
  kind: SkillEvidenceKind;
  evidence: string;
  url: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SearchProfileVersion {
  id: string;
  candidateId: string;
  version: number;
  createdAt: string;
  note: string;
  rules: SearchRules;
}

// ---------- Источники ----------

export type SourceKind =
  | "jobicy"
  | "remotive"
  | "remoteok"
  | "himalayas"
  | "workingnomads"
  | "weworkremotely"
  | "habrcareer"
  | "ats"
  | "import"
  | "demo";

export interface SourceInfo {
  id: string;
  kind: SourceKind;
  label: string;
  enabled: boolean;
  homepage: string;
  minIntervalMinutes: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextAllowedAt: string | null;
  lastStatus: SourceAttemptStatus | null;
  lastError: string | null;
  coverageNote: Msg;
  termsNote: Msg;
  attribution: string;
  maxPages: number;
}

export type SourceAttemptStatus =
  | "success"
  | "partial"
  | "failed"
  | "not_due"
  | "blocked"
  | "not_configured"
  | "disabled"
  | "cancelled";

export interface Coverage {
  pagesRequested: number;
  pagesFetched: number;
  perPageLimit: number | null;
  itemsReturned: number;
  exhausted: boolean; // пагинация исчерпана
  window: Msg; // словесное описание окна давности
}

// ---------- Вакансии и факты ----------

export type PostingKind = "job_posting" | "navigation" | "talent_pool" | "paid_training" | "aggregator_signal";

/** Жизненный цикл объявления — отдельное измерение, не связано с пригодностью. */
export type Lifecycle = "open" | "closed" | "unconfirmed" | "unchecked";

export type LifecycleEvidenceType =
  | "employer_ats_listed"
  | "primary_page_ok"
  | "employer_closed_text"
  | "deadline_passed"
  | "ats_removed"
  | "aggregator_closed"
  | "redirect_to_listing"
  | "http_404"
  | "http_blocked" // 403/429/CAPTCHA
  | "http_error" // 5xx
  | "network_error"
  | "js_shell"
  | "policy_blocked"
  | "feed_only";

export interface LifecycleEvidence {
  type: LifecycleEvidenceType;
  at: string;
  url: string | null;
  httpStatus: number | null;
  detail: Msg;
}

export type SalaryKind = "fixed" | "range" | "from" | "up_to" | "platform_estimate" | "hourly" | "unknown";
export type PayPeriod = "hour" | "day" | "week" | "month" | "year" | "task" | null;

export interface SalaryFact {
  kind: SalaryKind;
  min: number | null;
  max: number | null;
  currency: string | null;
  period: PayPeriod;
  guaranteedHoursPerWeek: number | null;
  origin: "structured" | "text" | "none";
  quote: string | null;
}

export type FactStatus = "structured" | "stated" | "ai_stated" | "unknown";

export interface Fact<T> {
  value: T;
  status: FactStatus;
  quote: string | null;
}

export interface VacancyFacts {
  extractorVersion: string;
  salary: SalaryFact;
  format: Fact<"remote" | "hybrid" | "office" | "unknown">;
  hybridCity: Fact<string | null>;
  geography: Fact<{
    scope: "worldwide" | "region" | "countries" | "unknown";
    allowed: string[]; // коды стран/регионов
    excluded: string[];
    labels: string[];
  }>;
  languages: Fact<Array<{ lang: string; level: Cefr | null; required: boolean; spoken: boolean; approx?: boolean }>>;
  voice: Fact<{ phoneWork: "yes" | "no" | "unknown"; coldCalls: boolean; writtenOnly: boolean }>;
  experience: Fact<{ yearsMin: number | null; seniority: "intern" | "junior" | "mid" | "senior" | "lead" | null; entrySignal: boolean }>;
  skills: Fact<{ required: string[]; preferred: string[]; mentioned: string[] }>;
  schedule: Fact<{ start: string | null; end: string | null; zone: string | null; weeklyMin: number | null; weeklyMax: number | null; flexible: boolean }>;
  aiPolicy: Fact<{ prohibitsAi: boolean }>;
  deadline: Fact<string | null>;
  contract: Fact<"employment" | "contractor" | "freelance" | "unknown">;
  safety: Fact<{ upfrontFee: boolean; unpaid: boolean; unsafeContact: boolean }>;
  closureText: Fact<boolean>;
}

export interface Vacancy {
  id: string;
  title: string;
  company: string;
  companyId: string | null;
  canonicalUrl: string;
  sourceUrl: string;
  applyUrl: string | null;
  sourceId: string;
  sourceJobId: string | null;
  requisitionId: string | null;
  location: string;
  employmentType: string | null;
  levelText: string | null;
  description: string;
  publishedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastCheckedAt: string | null;
  lifecycle: Lifecycle;
  lifecycleEvidence: LifecycleEvidence[];
  postingKind: PostingKind;
  postingKindReason: Msg;
  contentHash: string;
  facts: VacancyFacts;
  mergedIntoId: string | null;
  isDemo: boolean;
  tags: string[];
  provenance: string;
}

// ---------- Оценка ----------

export type DimensionStatus = "pass" | "fail" | "unknown" | "na";
export type Fit = "suitable" | "unsuitable" | "needs_check";

export type DimensionKey =
  | "role"
  | "format"
  | "country"
  | "pay"
  | "experience"
  | "language"
  | "voice"
  | "hours"
  | "safety"
  | "exclusions"
  | "skills"
  | "freshness";

export interface Dimension {
  key: DimensionKey;
  label: Msg;
  status: DimensionStatus;
  constraint: ConstraintMode;
  reason: Msg;
  /** Как выяснить неизвестное. */
  howToResolve?: Msg;
  evidence?: { quote: string | null; source: string; status: FactStatus } | null;
}

export interface Assessment {
  id: string;
  candidateId: string;
  vacancyId: string;
  profileVersion: number;
  rulesVersion: string;
  createdAt: string;
  fit: Fit;
  trackId: string | null;
  trackName: string | null;
  relevance: number; // 0–100, лексическое совпадение с профилем, не вероятность
  dimensions: Dimension[];
  unknowns: Msg[];
  gaps: Msg[];
  nextStep: Msg;
  inputHash: string;
  supersededAt: string | null;
}

// ---------- Отклики ----------

export type ApplicationStage =
  | "found"
  | "saved"
  | "preparing"
  | "submitted"
  | "response"
  | "interview"
  | "offer"
  | "rejected"
  | "archived";

export const APPLICATION_STAGES: ApplicationStage[] = [
  "saved",
  "preparing",
  "submitted",
  "response",
  "interview",
  "offer",
  "rejected",
  "archived",
];

export interface StageEvent {
  stage: ApplicationStage;
  at: string;
  note: string;
}

export interface Application {
  id: string;
  candidateId: string;
  vacancyId: string;
  stage: ApplicationStage;
  history: StageEvent[];
  dismissReason: string | null;
  submittedAt: string | null;
  followUpAt: string | null;
  notes: string;
  checklist: Record<string, boolean>;
  materialVersionIds: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Материалы ----------

export type MaterialKind = "cv" | "letter" | "portfolio" | "other";
export type MaterialStatus = "draft" | "human_reviewed" | "stale";

export interface MaterialVersion {
  id: string;
  materialId: string;
  candidateId: string;
  vacancyId: string | null;
  kind: MaterialKind;
  title: string;
  version: number;
  status: MaterialStatus;
  origin: "imported" | "manual" | "template" | "ai";
  content: string;
  filePath: string | null;
  fileHash: string | null;
  fileAvailable: boolean | null;
  aiModel: string | null;
  promptVersion: string | null;
  profileVersion: number | null;
  vacancyHash: string | null;
  usedFacts: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Запуски ----------

export type RunStatus = "running" | "succeeded" | "partial" | "failed" | "cancelled";
export type RunTrigger = "manual" | "scheduled" | "catchup" | "demo";

export interface SearchRun {
  id: string;
  trigger: RunTrigger;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  stats: RunStats;
  rulesVersion: string;
}

export interface RunStats {
  sourcesTotal: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  sourcesNotDue: number;
  sourcesBlocked: number;
  sourcesNotConfigured: number;
  sourcesDisabled: number;
  rawItems: number;
  policyBlocked: number;
  nonPostings: number;
  newVacancies: number;
  changedVacancies: number;
  unchangedVacancies: number;
  mergedFallback: number;
  assessed: number;
  suitable: number;
  needsCheck: number;
  unsuitable: number;
  notifications: number;
}

export interface SourceAttempt {
  id: string;
  runId: string;
  sourceId: string;
  status: SourceAttemptStatus;
  startedAt: string;
  finishedAt: string | null;
  httpStatus: number | null;
  error: string | null;
  items: number;
  coverage: Coverage | null;
}

export interface NotificationEvent {
  id: string;
  candidateId: string | null;
  kind: "new_match" | "changed_match" | "follow_up" | "run_failed" | "schedule_missed";
  dedupeKey: string;
  title: Msg;
  body: Msg;
  vacancyId: string | null;
  createdAt: string;
  readAt: string | null;
}

// ---------- Расписание ----------

export interface ScheduleSettings {
  enabled: boolean;
  paused: boolean;
  cadence: "daily" | "weekly";
  time: string; // HH:MM в локальном часовом поясе машины
  weekday: number; // 1 = понедельник … 7 = воскресенье
  runInBackground: boolean;
}

export interface ScheduleState {
  lastHandledSlot: string | null;
  lastRunId: string | null;
}

// ---------- AI ----------

export type AiProviderKind = "none" | "anthropic" | "openai_compatible";

export interface AiSettings {
  provider: AiProviderKind;
  model: string;
  baseUrl: string; // для openai_compatible
  monthlyBudgetUsd: number;
  keySet: boolean;
  lastTest: { at: string; ok: boolean; message: Msg } | null;
  pricing: Record<string, { inputPerMTok: number; outputPerMTok: number }>;
}
