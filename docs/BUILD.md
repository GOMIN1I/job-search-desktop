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

Без подписи Gatekeeper предупреждает при первом запуске: правый клик → «Открыть».

## Windows x64

```bash
npm ci
npm run dist:win        # NSIS, установка в профиль пользователя, выбор папки
```

Подпись: сертификат Authenticode (OV/EV) владельца, `CSC_LINK`/`CSC_KEY_PASSWORD` или `WIN_CSC_LINK`. Без подписи SmartScreen покажет предупреждение.

## CI (`.github/workflows/ci.yml`)

Матрица `macos-14` (arm64) и `windows-latest`: `npm ci` → typecheck → тесты → build → e2e (macOS из исходников, Windows — упакованное приложение) → electron-builder → артефакты (dmg/exe, отчёты e2e, скриншоты). Публикации релизов нет (`--publish never`).

## Что проверено на 2026-10-21

| Шаг | macOS arm64 | Windows x64 |
|---|---|---|
| Бинарник создан | да (`.app`, dmg 138 МБ, `hdiutil verify` VALID) | нет (нужен запуск CI на Windows) |
| Запущен | да: упакованный `.app` — E2E 17/17; из исходников — E2E 17/17 (ru) и 17/17 (en) | нет |
| Установщик проверен на целевой ОС | частично: dmg смонтирован, содержимое проверено; копирование в /Applications не выполнялось (нет места на диске) | нет |

## Локальная особенность этого Mac

`~/Documents` синхронизируется с iCloud при почти полном диске: файлы выгружаются («dataless»), инструменты сборки падали с `ETIMEDOUT`. Рабочая сборка велась в `dev.nosync/` (не синхронизируется). На другом компьютере это не требуется.
