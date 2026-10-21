# Решения (Architecture Decision Log)

Дата: 2026-10-21. Решения принимались автономно по поручению владельца; каждое обратимо.

## Стек

**Electron 45 + React 19 + TypeScript + SQLite (встроенный `node:sqlite`) + Vite 8 + esbuild + electron-builder.**

- Существующее ядро поиска было на Node.js — адаптеры, нормализация и gate-логика переработаны, а не переписаны на другом языке.
- `node:sqlite` проверен внутри Electron 45 (Node 24.22): работает без нативных модулей, один и тот же код базы в тестах (Node 25) и в приложении. Нет пересборки better-sqlite3 под ABI Electron, проще сборка для Windows.
- Tauri не выбран: потребовался бы Node-sidecar для существующей логики или перенос на Rust; выигрыш в размере не оправдывает стоимость на этом этапе.
- Конечному пользователю не нужны Node/Python: всё упаковано в приложение.

## Процессы и безопасность

- `renderer` (React) — `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, строгая CSP, запрет навигации и новых окон, запрет всех разрешений.
- `preload` открывает только `jsd.call(method, args)` и подписку на 5 событий. В main — allowlist методов и валидация каждого входа (zod), вызовы принимаются только от собственного окна.
- Сбор выполняется в `worker_threads` (отдельное соединение SQLite в WAL-режиме): сеть и обработка не блокируют main-процесс и интерфейс.
- HTML вакансий никогда не исполняется и не вставляется как HTML: на входе превращается в текст.
- Внешние ссылки открываются только в браузере ОС через проверку схемы (`https/http/mailto`) и политики исключённых источников.
- API-ключ шифруется `safeStorage` (Keychain на macOS, DPAPI на Windows), хранится как шифротекст; не возвращается в renderer, не пишется в журнал и экспорт.

## Модель данных

`candidates`, `search_profiles` (неизменяемые версии правил), `skill_evidence` (подтверждено / со слов / нужен пример), `sources`, `excluded_hosts`, `companies`, `vacancies` (+ `facts_json`, `lifecycle`, `posting_kind`, `merged_into_id`), `vacancy_links`, `observations`, `fact_evidence`, `vacancy_merges`, `assessments` (история: `superseded_at`), `applications`, `materials` + `material_versions`, `search_runs`, `source_attempts`, `notification_events`, `schedule_events`, `ai_calls`, `import_batches`, `app_log`.

Соответствие требуемым сущностям: Candidate, SkillEvidence, SearchProfile, Source, Company, Vacancy, Observation, FactEvidence, CandidateAssessment, Application, MaterialVersion, SearchRun, SourceAttempt, NotificationEvent — все есть.

## Правила решения (одна функция `core/assess.ts`)

- Измерения: направление, формат, страна найма, оплата, опыт, язык, звонки, часы, безопасность/тип объявления, исключённые темы (жёсткие по настройке) + навыки и свежесть (мягкие).
- `unsuitable` — любой жёсткий fail; `needs_check` — жёсткий unknown; `suitable` — всё жёсткое pass. Совпадение 0–100 подписано как «не вероятность оффера».
- Отсутствие признаков риска = «работодатель не проверен» (soft unknown), а не pass.
- Названия стадий однозначны и разведены по измерениям: lifecycle / fit / stage / material status.
- Все тексты, которые генерирует ядро, хранятся сразу на двух языках (`Msg {ru, en}`) — смена языка не требует пересчёта.
- Версии: `RULES_VERSION` (решение), `EXTRACTOR_VERSION` (факты). При смене версии извлечения факты сохранённых вакансий пересчитываются из их текста, оценки — новыми записями.

## Найденные на живых данных ошибки и решения

- «translate into your native language» ошибочно давало требование native English → «native» учитывается только рядом с названием языка.
- «Fluent/excellent/proficient» — расплывчато; приравнивается к ≈C1, но при разнице в один уровень с профилем это «уточнить», а не отказ.
- «US, UK + 35 other countries» — неполный перечень → «неизвестно», а не «найм только в US/UK».

## Расписание

Локальный таймер в main-процессе (раз в минуту + событие `resume` после сна). Чистая функция `planSchedule` даёт максимум один запуск: вовремя или один догоняющий; пропущенные слоты пишутся в журнал. Single-flight: один воркер + проверка `running`-записи в базе; повторная команда не опрашивает источники до `next_allowed_at`.

## Окружение разработки (этот Mac)

Папка `Documents` синхронизируется с iCloud при почти полном диске, и macOS выгружает файлы в облако («dataless»): Node/rsync получали `ETIMEDOUT`, а часть `node_modules` повредилась. Поэтому сборка и тесты выполнялись в `dev.nosync/` (суффикс `.nosync` iCloud не синхронизирует), а исходники синхронизировались в корень репозитория. В git эта папка не попадает.
