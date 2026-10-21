// Библиотека шаблонов направлений. Это стартовый набор, а не список чьих-то навыков:
// пользователь включает любое число треков, редактирует ключевые слова и добавляет свои.

import type { SearchRules, Track } from "../shared/types";

export interface RoleTemplate {
  id: string;
  group: string;
  name: string;
  nameEn: string;
  groupEn: string;
  titleKeywords: string[];
  bodyKeywords: string[];
  excludeKeywords: string[];
  noCalls?: boolean;
}

const SENIOR_EX = ["senior", "lead", "head of", "director", "principal", "руководитель", "ведущий"];

export const ROLE_TEMPLATES: RoleTemplate[] = [
  // AI и нейросети
  { id: "ai-eval", group: "AI", groupEn: "AI", nameEn: "AI evaluation / rating", name: "AI evaluation / rating", titleKeywords: ["ai evaluator", "ai rater", "search quality rater", "llm evaluator", "ai evaluation", "response evaluator", "ai quality", "rater", "оценщик ии", "асессор", "оценка ответов нейросет"], bodyKeywords: ["llm", "rating", "evaluation", "rubric", "model responses", "rlhf", "оценка", "нейросет"], excludeKeywords: SENIOR_EX },
  { id: "ai-annotation", group: "AI", groupEn: "AI", nameEn: "Data annotation", name: "Разметка данных / annotation", titleKeywords: ["data annotator", "annotation", "data labeler", "data labeling", "labeling", "labelling", "labeling specialist", "annotator", "разметчик", "разметка данных", "аннотатор"], bodyKeywords: ["annotation", "labeling", "labelling", "labeled", "dataset", "datasets", "bounding box", "transcription", "guidelines", "разметка", "датасет"], excludeKeywords: SENIOR_EX },
  { id: "ai-trainer", group: "AI", groupEn: "AI", nameEn: "AI trainer", name: "AI trainer", titleKeywords: ["ai trainer", "ai tutor", "ai writing trainer", "ai data trainer", "тренер нейросет", "ai-тренер", "ai тренер"], bodyKeywords: ["train ai", "ai models", "prompts", "responses", "rlhf", "обучение моделей"], excludeKeywords: SENIOR_EX },
  { id: "ai-content-qa", group: "AI", groupEn: "AI", nameEn: "AI content review", name: "Проверка AI-контента", titleKeywords: ["ai content reviewer", "content quality", "ai qa", "ai content", "fact checker", "проверка контента", "редактор ии-текстов", "ai-редактор"], bodyKeywords: ["ai-generated", "quality", "fact-check", "review", "генерац", "нейросет"], excludeKeywords: SENIOR_EX },
  { id: "ai-prompt-data", group: "AI", groupEn: "AI", nameEn: "Prompts & datasets", name: "Промпты и датасеты", titleKeywords: ["prompt engineer", "prompt writer", "prompt specialist", "dataset", "data curator", "промпт", "prompt-инженер", "промпт-инженер"], bodyKeywords: ["prompt", "dataset", "llm", "chatgpt", "claude", "промпт"], excludeKeywords: SENIOR_EX },
  { id: "ai-support", group: "AI", groupEn: "AI", nameEn: "AI support / AI implementation", name: "AI-support / внедрение AI", titleKeywords: ["ai support", "ai operations", "ai implementation", "ai assistant", "automation assistant", "ai specialist", "ai-специалист", "специалист по ии", "специалист по нейросетям", "ai-ассистент"], bodyKeywords: ["ai tools", "automation", "chatbot", "llm", "no-code", "нейросет", "чат-бот"], excludeKeywords: SENIOR_EX },
  { id: "ai-startup", group: "AI", groupEn: "AI", nameEn: "Entry roles in AI startups / AI project assistant", name: "Начальные роли в AI-стартапах / помощник AI-проектов", titleKeywords: ["ai project assistant", "ai operations associate", "ai intern", "ai internship", "junior ai", "ai product assistant", "помощник ai-проекта", "стажер ai", "стажёр ai"], bodyKeywords: ["startup", "ai", "llm", "machine learning", "стартап", "нейросет"], excludeKeywords: SENIOR_EX },
  // Письменная поддержка и доступная работа
  { id: "written-support", group: "Письменная работа", groupEn: "Written work", nameEn: "Chat & email support", name: "Поддержка в чате и email", titleKeywords: ["chat support", "email support", "customer support", "support specialist", "support agent", "customer service", "help desk", "оператор чата", "специалист поддержки", "специалист технической поддержки", "оператор поддержки", "менеджер поддержки"], bodyKeywords: ["chat", "email", "tickets", "zendesk", "intercom", "freshdesk", "чат", "тикет", "переписк"], excludeKeywords: [...SENIOR_EX, "cold calling", "холодные звонки", "outbound sales"], noCalls: true },
  { id: "back-office", group: "Письменная работа", groupEn: "Written work", nameEn: "Request/order processing, back office", name: "Обработка заявок, заказов, back office", titleKeywords: ["back office", "order processing", "operations assistant", "order management", "administrative assistant", "virtual assistant", "обработка заявок", "обработка заказов", "менеджер по обработке", "администратор заказов", "ассистент"], bodyKeywords: ["orders", "requests", "documents", "crm", "excel", "заявки", "заказы", "документооборот"], excludeKeywords: [...SENIOR_EX, "холодные звонки"], noCalls: true },
  { id: "data-entry", group: "Письменная работа", groupEn: "Written work", nameEn: "CRM / data entry / Excel", name: "CRM / ввод данных / Excel", titleKeywords: ["data entry", "crm specialist", "crm assistant", "data operator", "data clerk", "оператор ввода данных", "оператор пк", "специалист crm", "ввод данных"], bodyKeywords: ["excel", "google sheets", "crm", "data entry", "таблиц", "ввод данных"], excludeKeywords: SENIOR_EX, noCalls: true },
  { id: "content-moderation", group: "Письменная работа", groupEn: "Written work", nameEn: "Content, product listings, moderation", name: "Контент, карточки товаров, модерация", titleKeywords: ["content moderator", "content manager", "content specialist", "catalog specialist", "product listing", "модератор", "контент-менеджер", "менеджер карточек", "специалист по карточкам"], bodyKeywords: ["moderation", "content", "listings", "marketplace", "модерац", "карточки товаров", "маркетплейс"], excludeKeywords: SENIOR_EX, noCalls: true },
  { id: "docs-office", group: "Письменная работа", groupEn: "Written work", nameEn: "Documents, Word/Excel, office support", name: "Документы, Word/Excel, офисная поддержка", titleKeywords: ["document specialist", "documentation assistant", "office assistant", "documents", "делопроизводитель", "специалист по документам", "помощник офиса"], bodyKeywords: ["word", "excel", "documents", "документ"], excludeKeywords: SENIOR_EX, noCalls: true },
  // Аналитика
  { id: "ba", group: "Аналитика", groupEn: "Analytics", nameEn: "Business analyst (intern/junior)", name: "Бизнес-аналитик (стажёр/junior)", titleKeywords: ["business analyst", "ba intern", "junior business analyst", "бизнес-аналитик", "бизнес аналитик", "аналитик бизнес-процессов"], bodyKeywords: ["requirements", "bpmn", "stakeholders", "processes", "требования", "бизнес-процесс"], excludeKeywords: SENIOR_EX },
  { id: "sa", group: "Аналитика", groupEn: "Analytics", nameEn: "Systems analyst (intern/junior)", name: "Системный аналитик (стажёр/junior)", titleKeywords: ["system analyst", "systems analyst", "системный аналитик"], bodyKeywords: ["uml", "api", "sql", "requirements", "требования", "интеграц"], excludeKeywords: SENIOR_EX },
  { id: "1c", group: "Аналитика", groupEn: "Analytics", nameEn: "1C: analyst / consultant / implementation", name: "1С: аналитик / консультант / внедрение", titleKeywords: ["1с", "1c", "консультант 1с", "аналитик 1с", "специалист по внедрению"], bodyKeywords: ["1с", "1c", "внедрение", "конфигурац"], excludeKeywords: SENIOR_EX },
  { id: "qa-testing", group: "Аналитика", groupEn: "Analytics", nameEn: "Entry-level QA testing", name: "Тестирование (QA) начальный уровень", titleKeywords: ["qa tester", "manual qa", "junior qa", "software tester", "тестировщик", "qa engineer"], bodyKeywords: ["test cases", "bug", "jira", "тест-кейс", "баг"], excludeKeywords: SENIOR_EX },
  { id: "implementation", group: "Аналитика", groupEn: "Analytics", nameEn: "Implementation & processes", name: "Внедрение и процессы", titleKeywords: ["implementation specialist", "implementation analyst", "process analyst", "solutions analyst", "специалист по внедрению", "аналитик процессов"], bodyKeywords: ["implementation", "onboarding", "processes", "внедрение", "процесс"], excludeKeywords: SENIOR_EX },
  // Инженерия
  { id: "electrical-design", group: "Инженерия", groupEn: "Engineering", nameEn: "Electrical design (entry level)", name: "Электропроектирование (начальный уровень)", titleKeywords: ["electrical designer", "electrical drafter", "junior electrical engineer", "инженер-проектировщик", "проектировщик эом", "инженер-электрик", "электропроектирование", "инженер эом", "проектировщик электрики"], bodyKeywords: ["autocad", "компас", "dialux", "эом", "электроснабжен", "освещен", "схемы"], excludeKeywords: SENIOR_EX },
  { id: "cad-drafting", group: "Инженерия", groupEn: "Engineering", nameEn: "Drafting / CAD / technician", name: "Черчение / САПР / техник", titleKeywords: ["cad drafter", "cad technician", "draftsman", "autocad", "чертежник", "техник-проектировщик", "оператор сапр", "техник-конструктор"], bodyKeywords: ["autocad", "компас", "чертеж", "сапр", "cad"], excludeKeywords: SENIOR_EX },
  { id: "tech-docs", group: "Инженерия", groupEn: "Engineering", nameEn: "Technical documentation / support with training", name: "Техническая документация / поддержка с обучением", titleKeywords: ["technical writer", "documentation specialist", "technical support", "технический писатель", "специалист по технической документации", "инженер технической поддержки"], bodyKeywords: ["documentation", "manuals", "документац", "инструкц"], excludeKeywords: SENIOR_EX },
  { id: "logistics-orders", group: "Инженерия", groupEn: "Engineering", nameEn: "Logistics & orders (adjacent)", name: "Логистика и заказы (смежное)", titleKeywords: ["logistics coordinator", "logistics assistant", "procurement assistant", "supply chain assistant", "логист", "менеджер по закупкам", "специалист по логистике", "менеджер по заказам"], bodyKeywords: ["logistics", "shipments", "orders", "suppliers", "логистик", "поставк", "заказ"], excludeKeywords: SENIOR_EX },
  // Прочее
  { id: "marketing-assistant", group: "Другое", groupEn: "Other", nameEn: "Marketing assistant", name: "Ассистент маркетолога", titleKeywords: ["marketing assistant", "marketing coordinator", "smm assistant", "ассистент маркетолога", "младший маркетолог"], bodyKeywords: ["social media", "campaigns", "content", "smm", "маркетинг"], excludeKeywords: SENIOR_EX },
  { id: "project-coordinator", group: "Другое", groupEn: "Other", nameEn: "Project coordinator", name: "Координатор проектов", titleKeywords: ["project coordinator", "project assistant", "координатор проектов", "ассистент проекта"], bodyKeywords: ["project", "timeline", "stakeholders", "проект"], excludeKeywords: SENIOR_EX },
  { id: "hr-assistant", group: "Другое", groupEn: "Other", nameEn: "HR assistant / online recruiting", name: "Ассистент HR / онлайн-подбор", titleKeywords: ["hr assistant", "recruiting coordinator", "sourcer", "ассистент hr", "помощник рекрутера", "специалист по подбору"], bodyKeywords: ["recruiting", "candidates", "ats", "подбор", "кандидат"], excludeKeywords: SENIOR_EX },
  { id: "ecommerce", group: "Другое", groupEn: "Other", nameEn: "Marketplaces & e-commerce", name: "Маркетплейсы и e-commerce", titleKeywords: ["marketplace manager", "e-commerce assistant", "ecommerce specialist", "менеджер маркетплейсов", "менеджер по работе с маркетплейсами"], bodyKeywords: ["marketplace", "amazon", "ozon", "wildberries", "маркетплейс"], excludeKeywords: SENIOR_EX },
  { id: "junior-data", group: "Другое", groupEn: "Other", nameEn: "Junior data analyst", name: "Junior аналитик данных", titleKeywords: ["junior data analyst", "data analyst intern", "аналитик данных", "младший аналитик"], bodyKeywords: ["sql", "excel", "dashboards", "power bi", "дашборд"], excludeKeywords: SENIOR_EX },
];

export function trackFromTemplate(t: RoleTemplate, lang: "ru" | "en" = "ru"): Track {
  return {
    id: `trk-${t.id}`,
    name: lang === "en" ? t.nameEn : t.name,
    enabled: true,
    titleKeywords: [...t.titleKeywords],
    bodyKeywords: [...t.bodyKeywords],
    excludeKeywords: [...t.excludeKeywords],
    noCalls: !!t.noCalls,
    templateId: t.id,
  };
}

/** Чистый профиль для нового пользователя: ничего не предполагается. */
export function emptyRules(): SearchRules {
  return {
    tracks: [],
    location: { country: null, city: null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" },
    countryEligibility: { mode: "unset" },
    workFormat: { mode: "unset", remote: true, hybrid: true, office: true, hybridCities: [] },
    pay: { mode: "unset", minimums: [] },
    hours: { mode: "unset", earliestLocal: "08:00", latestLocal: "22:00", maxWeeklyHours: null },
    languages: { mode: "unset", items: [] },
    voice: { mode: "unset", noPhoneWork: false, noVoiceScreening: false },
    experience: { mode: "unset", maxYearsRequired: 1, allowSenior: false },
    excludedKeywords: [],
    freshnessDays: 30,
  };
}

export const DEFAULT_EXCLUDED_TOPICS = ["adult", "onlyfans", "dating", "gambling", "casino", "betting", "казино", "ставки на спорт", "знакомства"];
