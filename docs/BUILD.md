# Сборка, подпись, CI

## macOS (Apple Silicon)

```bash
npm ci
npm run dist:mac        # electron-builder → release/*.dmg
```

Если на диске мало места, можно собрать только `.app` и упаковать dmg системными средствами:

```bash
npx electron-builder --mac --arm64 --dir
hdiutil create -volname "Job Search Desktop" -srcfolder "<staging с .app и ссылкой на /Applications>" -format UDZO "release/Job Search Desktop-0.1.0-arm64.dmg"
```

### Подпись и нотаризация (не настроены)

Нужны Apple Developer ID Application certificate и учётная запись разработчика владельца. Затем:

- `CSC_LINK` (p12, base64) и `CSC_KEY_PASSWORD` — сертификат;
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — нотаризация через `notarytool`;
- в `package.json → build.mac`: убрать `"identity": null`, включить `"hardenedRuntime": true`, добавить `"notarize": true` и entitlements (для Electron: `com.apple.security.cs.allow-jit`).

Без подписи Gatekeeper не даёт открыть приложение с первого раза (сборка подписана только ad-hoc). Откройте его один раз, затем «Системные настройки» → «Конфиденциальность и безопасность» → «Всё равно открыть». В новых версиях macOS правый клик → «Открыть» больше не обходит проверку.

## Windows x64

```bash
npm ci
npm run dist:win        # NSIS, установка в профиль пользователя, выбор папки
```

Подпись: сертификат Authenticode (OV/EV) владельца, `CSC_LINK`/`CSC_KEY_PASSWORD` или `WIN_CSC_LINK`. Без подписи SmartScreen покажет предупреждение.

## CI (`.github/workflows/ci.yml`)

Матрица `macos-14` (arm64) и `windows-latest`: `npm ci` → typecheck → тесты → build → e2e (macOS из исходников, Windows — упакованное приложение) → electron-builder → артефакты (dmg/exe, отчёты e2e, скриншоты). Публикации релизов нет (`--publish never`).

## Релизы

Тег `vX.Y.Z` запускает `.github/workflows/release.yml`: сборка на macOS 14 и Windows и загрузка `Job-Search-Desktop-mac-arm64.dmg` и `Job-Search-Desktop-windows-x64-setup.exe` в GitHub Release с тем же тегом. Релиз нужно создать до окончания сборки (`gh release create vX.Y.Z --verify-tag`). Ссылки `releases/latest/download/<файл>` в README и на сайте всегда ведут на последний релиз.

## Что проверено (0.2.1, 2026-10-21)

| Шаг | macOS arm64 | Windows x64 |
|---|---|---|
| Бинарник создан | да, в CI и локально | да, в CI (`windows-latest`) |
| Запущен | да: dmg скачан из релиза, E2E 24/24 RU и EN против приложения из него | да, в CI: E2E 23/23 против распакованного приложения |
| Установщик проверен на целевой ОС | dmg смонтирован и проверен (`hdiutil verify`); перенос в «Программы» — стандартный | нет: установщик NSIS на физическом ПК не запускался |

## Локальная особенность этого Mac

`~/Documents` синхронизируется с iCloud при почти полном диске: файлы выгружаются («dataless»), инструменты сборки падали с `ETIMEDOUT`. Рабочая сборка велась в `dev.nosync/` (не синхронизируется). На другом компьютере это не требуется.
