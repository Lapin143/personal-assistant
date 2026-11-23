# Изолированный тестовый прокси YDB

Эта функция подключается только к тестовой Serverless YDB и сохраняет текущий HTTP-контракт приложения. В коде нет подключения к Tabrica, T1 или T2.

## Параметры функции

- Runtime: Node.js 22; entry point: `index.handler`.
- Пакет: папка `cloud/ydb-test` целиком, включая `package.json`.
- Service account: отдельный аккаунт функции с ролью `ydb.editor` только на `assistant-test-ydb`.
- Переменные окружения: `YDB_ENDPOINT`, `YDB_DATABASE`, `AUTH_SECRET` (случайные 32+ символа), `AUTH_USER_1` (`lapin:<пароль тестового приложения>`), `SEED_SECRET` (временный случайный секрет), `ALLOWED_ORIGINS=https://lapin143.github.io`.
- Для проверки из браузера функция должна быть публичной; запись в БД защищена входом приложения. Импорт защищён отдельным временным `SEED_SECRET`.

Первый вызов создаёт таблицу `records`. `?action=seed` принимает до 500 строк и загружает только в пустую таблицу. Повторная загрузка запрещена. После сверки выгрузки переменную `SEED_SECRET` нужно удалить из версии функции.

## Импорт выгрузки

Не класть JSON с семейными данными в репозиторий и не размещать его в Pages. Отправлять локальный файл напрямую к адресу тестовой функции:

```powershell
$seed = Get-Content -Raw -LiteralPath '<путь к свежей выгрузке Т1>' | ConvertFrom-Json
$payload = @{ records = @($seed) } | ConvertTo-Json -Depth 100 -Compress
Invoke-RestMethod -Method Post -Uri '<URL функции>?action=seed' -Headers @{ 'X-Seed-Key' = $env:ASSISTANT_TEST_SEED_SECRET } -ContentType 'application/json' -Body $payload
```

Ответ импорта содержит только итоговые количества. После импорта нужно сверить `doc`, `list`, `menu`, `settings`, `tx`, а также активные и удалённые строки, затем отключить импортный ключ.
