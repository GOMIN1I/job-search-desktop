<p align="center"><img src="build/icon.svg" width="96" height="96" alt=""></p>

<h1 align="center">Job Search Desktop</h1>

<p align="center"><b>Ищет работу за вас и отмечает главное: что подходит, что уточнить, что нет.</b><br>
Бесплатное приложение для macOS и Windows. Интерфейс на русском и английском.</p>

<p align="center">
  <a href="https://github.com/GOMIN1I/job-search-desktop/releases/latest/download/Job-Search-Desktop-mac-arm64.dmg"><b>Скачать для macOS</b></a> (Apple Silicon)
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="https://github.com/GOMIN1I/job-search-desktop/releases/latest/download/Job-Search-Desktop-windows-x64-setup.exe"><b>Скачать для Windows</b></a> (10 и 11, 64-бит)
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="https://gomin1i.github.io/job-search-desktop/">Сайт и ролик</a>
</p>

<p align="center"><a href="https://gomin1i.github.io/job-search-desktop/#film"><img src="site/media/poster.jpg" width="720" alt="Ролик о приложении (58 секунд), открывается на сайте"></a></p>

> English version is [below](#english).

## Зачем это

Искать работу — значит каждый день открывать десятки сайтов, читать одинаковые объявления и выяснять, подходят ли они вам: страна найма, язык, оплата, формат, звонки. Job Search Desktop делает эту рутину сам — утром, ночью, пока вы спите или заняты. Вы один раз настраиваете поиск под себя, а приложение по расписанию обходит сайты с вакансиями, убирает дубли, проверяет каждое объявление по вашим условиям и показывает готовый результат. Каждый вывод подтверждён цитатой из объявления; если чего-то в тексте нет, это помечено «уточнить», а не угадано. Откликаетесь вы сами.

Подходит людям в любой стране, которые ищут удалённую, гибридную или офисную работу и хотят тратить время только на подходящие вакансии.

## Как это выглядит

| Настройка за пару минут | Поиск по сайтам | Разбор вакансии и отклик |
|---|---|---|
| ![Настройка профиля](docs/media/demo-setup.gif) | ![Поиск по источникам](docs/media/demo-search.gif) | ![Карточка вакансии с цитатами](docs/media/demo-results.gif) |

<table>
<tr>
<td><img src="docs/screenshots/ru-10-today-demo.png" alt="Экран «Сегодня»"></td>
<td><img src="docs/screenshots/ru-11-vacancy-detail.png" alt="Карточка вакансии"></td>
</tr>
<tr>
<td><img src="docs/screenshots/ru-05b-onboarding-assistant-in-use.png" alt="Установка локальной модели"></td>
<td><img src="docs/screenshots/ru-13-applications-board.png" alt="Доска откликов"></td>
</tr>
</table>

## Что умеет

- **Настраивается под вас.** Страна, город и часовой пояс, языки письменно и устно, направления (26 готовых шаблонов и свои), формат работы, минимальная оплата в нужных валютах, звонки, опыт. Каждое условие можно сделать обязательным, желательным или не задавать.
- **Дополнительные инструкции для ИИ.** Отдельное поле, где вы своими словами пишете, что учитывать: «Не используй hh.ru и связанные сервисы», «Рассматривай вакансии из Германии и Польши», «Только удалённо, без продаж». Приложение сразу показывает, как поняло инструкции, и применяет их при каждом поиске: исключённые площадки не опрашиваются, требования участвуют в оценке. Если инструкция противоречит настройкам профиля, приложение спросит, что главнее.
- **Ищет широко.** Поиск по вашим направлениям с постраничной выдачей, а не только свежие объявления: Himalayas, The Muse, Arbeitnow, Jobicy, Remotive, Remote OK, Working Nomads, We Work Remotely, Хабр Карьера, открытые страницы компаний на Greenhouse, Lever и Ashby. По вашему доступу подключаются hh.ru и Adzuna (19 стран). Дубли между сайтами объединяются. Какие источники использовать, решаете вы.
- **Ищет сам, по расписанию.** Каждый день или неделю в вашем часовом поясе. Когда приложение закрыто, поиск запускает система и присылает уведомление; если компьютер спал, поиск выполнится после пробуждения. С сервером поиска — и когда компьютер выключен: результаты ждут вас при возвращении.
- **Объясняет каждый вывод.** «Подходит», «Уточнить», «Не подходит» — у каждого условия цитата из объявления. «Worldwide» не считается наймом из вашей страны, «до $1000» не выполняет минимум, часы пересчитываются в ваш часовой пояс.
- **Помогает с откликами.** Этапы, чек-лист перед отправкой, напоминания, черновики писем и резюме только из подтверждённых фактов. Документы можно импортировать из PDF и DOCX (текст извлекается) и экспортировать в DOCX, PDF, HTML, Markdown и TXT.
- **Нейросеть на вашем компьютере.** Ollama и модели Gemma ставятся прямо из приложения, бесплатно. Облачная модель — по желанию. Без нейросети работает всё, кроме разбора с ИИ.
- **Данные у вас.** Всё хранится на вашем компьютере; ключи и токены — в системном хранилище (Keychain / DPAPI). Экспорт, резервная копия и импорт встроены.

## Установка

### macOS

1. Скачайте [Job-Search-Desktop-mac-arm64.dmg](https://github.com/GOMIN1I/job-search-desktop/releases/latest/download/Job-Search-Desktop-mac-arm64.dmg) и откройте его.
2. Перетащите приложение в «Программы».
3. Приложение пока не подписано сертификатом Apple, поэтому при первом запуске macOS его не откроет. Попробуйте открыть один раз, затем зайдите в «Системные настройки», раздел «Конфиденциальность и безопасность», и нажмите «Всё равно открыть».

Нужен Mac на Apple Silicon (M1 и новее) с macOS 13 или новее.

### Windows

1. Скачайте [Job-Search-Desktop-windows-x64-setup.exe](https://github.com/GOMIN1I/job-search-desktop/releases/latest/download/Job-Search-Desktop-windows-x64-setup.exe) и запустите.
2. Установщик пока не подписан, поэтому SmartScreen предупредит: нажмите «Подробнее», затем «Выполнить в любом случае».
3. Выберите папку установки; ярлык появится в меню «Пуск».

Нужен Windows 10 или 11, 64-бит.

## Первый запуск

Шесть шагов простыми словами: что делает приложение, о вас, что ищете (здесь же — дополнительные инструкции для ИИ), где искать, помощник-нейросеть и первый поиск. Шаги можно пропускать и возвращаться; подсказки по экрану открываются снова из «Как это работает».

## Что нужно знать

- **hh.ru** с апреля 2026 года отдаёт поиск вакансий только с OAuth-токеном. Чтобы искать там, в «Настройках», раздел «Источники», введите данные приложения, зарегистрированного на [dev.hh.ru](https://dev.hh.ru), и войдите через свой аккаунт hh.ru. Источник включается после успешного проверочного поиска.
- **Adzuna** требует бесплатный ключ разработчика ([developer.adzuna.com](https://developer.adzuna.com)).
- **Поиск при выключенном компьютере** работает через сервер поиска. Подключите его в «Настройках», раздел «Поиск и расписание». Свой сервер разворачивается по [инструкции](server/README.md). На сервер уходят ваши профили поиска, выбранные источники и расписание; доступы к hh.ru и Adzuna — только если вы это разрешите.
- **Нейросеть локально.** На выбор E2B, E4B, обычная 12B и 12B MLX для Apple Silicon. Модели скачиваются отдельно; размер виден перед загрузкой.

## Нейросеть: локально и бесплатно

Все четыре варианта доступны в «Настройках → AI» и при первом запуске. Выберите модель и нажмите «Установить»: веса скачиваются отдельно, в установщик приложения они не входят. Уже установленная модель доступна без повторной загрузки.

| Модель / точный тег Ollama | Система | Примерная загрузка |
|---|---|---|
| **Gemma 4 E2B** · `gemma4:e2b` | Windows, macOS · от 8 ГБ памяти | 4,6–7,5 ГБ |
| **Gemma 4 E4B** · `gemma4:e4b` | Windows, macOS · от 16 ГБ памяти | 6,6–9,5 ГБ |
| **Gemma 4 12B** · `gemma4:12b` | Windows, macOS · обычная версия Ollama | ≈ 8 ГБ |
| **Gemma 4 12B MLX** · `gemma4:12b-mlx` | Только Mac с Apple Silicon | ≈ 7,7 ГБ |

Для 12B ориентируйтесь на 16 ГБ оперативной/объединённой памяти или видеопамяти и больше; скорость зависит от компьютера и настроек. MLX нельзя установить на Windows или Intel Mac. Размеры могут меняться: приложение читает актуальный размер из [реестра Ollama](https://ollama.com/library/gemma4/tags) перед загрузкой.

Приложение рекомендует модель под ваш компьютер и ничего большого не скачивает без подтверждения. Загрузку можно остановить и продолжить; после загрузки модель проверяется и включается, удаляется одной кнопкой. С локальной моделью текст вакансий и ваш профиль обрабатываются только на вашем компьютере. Облачная модель (Anthropic или любой OpenAI-совместимый сервис) подключается отдельно, по вашему ключу.

## Приватность

Для установки движка и моделей приложение обращается к GitHub/Ollama. При дальнейшей работе оно ходит в сеть к выбранным сайтам с вакансиями, к выбранной модели (если она облачная), к странице вакансии, когда вы нажимаете «Перепроверить», и к серверу поиска, если вы его подключили. Оно не отправляет отклики, письма и формы, не регистрирует аккаунты и не проходит тесты за вас.

## Разработка

Нужен Node.js 22 или новее.

```bash
npm ci
npm test
npm start
```

| Команда | Что делает |
|---|---|
| `npm run dev` | Vite и Electron с горячей перезагрузкой интерфейса |
| `npm run e2e` | настоящее окно Electron на синтетических данных |
| `npm run dist:mac` / `npm run dist:win` | установщики для macOS и Windows |
| `node server/dist/server.js` | сервер поиска (после `npm run build`), см. [server/README.md](server/README.md) |
| `node dist/cli.js run --data <папка>` | поиск из командной строки |

Структура: `src/core` (правила, инструкции, расписание), `src/sources` (сайты с вакансиями), `src/pipeline` (поиск), `src/ai` (модели), `src/docs` (документы), `src/main` (Electron, доступы, фоновые задачи, сервер поиска), `src/renderer` (интерфейс), `server` (сервер поиска), `site` (сайт), `film` (ролик).

Документация: [дизайн](docs/DESIGN.md), [сборка и подпись](docs/BUILD.md), [источники](docs/SOURCES.md), [архитектура](docs/DECISIONS.md).

## Лицензия

Код: MIT, см. [LICENSE](LICENSE). Шрифт Golos Text: SIL OFL 1.1. Модели Gemma 4 — [Apache 2.0](https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12b/); Ollama: MIT.

---

## English

**Searches for jobs for you and marks what matters: fits, clarify, doesn't fit.** A free desktop app for macOS and Windows with a Russian and English interface.

Downloads: [macOS (Apple Silicon)](https://github.com/GOMIN1I/job-search-desktop/releases/latest/download/Job-Search-Desktop-mac-arm64.dmg), [Windows 10/11 x64](https://github.com/GOMIN1I/job-search-desktop/releases/latest/download/Job-Search-Desktop-windows-x64-setup.exe), [website and film](https://gomin1i.github.io/job-search-desktop/).

Job hunting means opening dozens of sites every day and checking whether each posting really fits: country of hiring, language, pay, format, calls. Job Search Desktop does that routine for you — in the morning, at night, while you sleep. Set up your search once; the app checks job sites on a schedule, removes duplicates, checks every posting against your conditions and shows the results. Every verdict is backed by a quote; anything the posting doesn't say is marked "clarify" instead of guessed. You always apply yourself.

- **Your own instructions for AI:** write in your own words which sites to skip, which countries and languages to consider and what to avoid. You see how the app understood them; they apply on every search, and conflicts with your settings are yours to resolve.
- **Wide search:** search by your job areas with pagination across Himalayas, The Muse, Arbeitnow, Jobicy, Remotive, Remote OK, Working Nomads, We Work Remotely, Habr Career and Greenhouse/Lever/Ashby company boards; hh.ru and Adzuna (19 countries) connect with your own access. You choose the sources.
- **Searches on its own:** daily or weekly in your time zone. When the app is closed, the system runs the search and notifies you; after sleep it runs on wake-up. With a search server it also runs while the computer is off.
- **Documents:** import PDF and DOCX (text is extracted; scans are flagged for OCR), export to DOCX, PDF, HTML, Markdown and TXT.
- **Local AI, free:** choose and install Ollama + Gemma 4 from Settings → AI or during onboarding. Model weights download separately; they are not bundled with the app.

| Available model | Ollama tag | Platform | Approx. download |
|---|---|---|---|
| Gemma 4 E2B | `gemma4:e2b` | Windows, macOS · 8 GB+ RAM | 4.6–7.5 GB |
| Gemma 4 E4B | `gemma4:e4b` | Windows, macOS · 16 GB+ RAM | 6.6–9.5 GB |
| Gemma 4 12B | `gemma4:12b` | Windows, macOS · standard Ollama | ~8 GB |
| Gemma 4 12B MLX | `gemma4:12b-mlx` | Apple Silicon Macs only | ~7.7 GB |

For 12B, plan for at least 16 GB of RAM/unified memory or VRAM; speed depends on hardware and settings. Installed Gemma variants are detected automatically. The app shows current download sizes from Ollama and checks the model before enabling it.

- **Install on macOS:** open the `.dmg` and drag the app to Applications. It is not signed yet: open it once, then go to System Settings, Privacy & Security, and click Open Anyway. Requires Apple Silicon and macOS 13+.
- **Install on Windows:** run the installer; SmartScreen will warn because it is not signed yet: click More info, then Run anyway. Requires Windows 10 or 11, 64-bit.
- **Good to know:** hh.ru requires an OAuth token since April 2026 (an app registered at dev.hh.ru plus your hh.ru sign-in); Adzuna needs a free developer key; searching while the computer is off needs a search server ([guide](server/README.md)).

Development: `npm ci && npm test && npm start`. License: MIT.
