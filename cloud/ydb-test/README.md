# Изолированный тестовый прокси YDB

Эта функция подключается только к тестовой Serverless YDB и сохраняет текущий HTTP-контракт приложения. В коде нет подключения к Tabrica, T1 или T2.

## Параметры функции

- Runtime: Node.js 22; entry point: `index.handler`.
- Пакет: папка `cloud/ydb-test` целиком, включая `package.json`.
- Service account: отдельный аккаунт функции с ролью `ydb.editor` только на `assistant-test-ydb`.
- Переменные окружения: `YDB_ENDPOINT`, `YDB_DATABASE`, `AUTH_SECRET` (случайные 32+ символа), `AUTH_USER_1` (`lapin:<пароль тестового приложения>`), `ALLOWED_ORIGINS=https://lapin143.github.io`.
- Для первоначального импорта временно добавляется `SEED_SECRET`; после импорта его нужно удалить и пересобрать функцию.
- Для проверки из браузера функция должна быть публичной; чтение и изменения защищены входом приложения.

Таблицу `records` нужно создать заранее в консоли YDB: `record_id Uint64`, `kind Utf8`, `record_key Utf8`, `title Utf8`, `date Utf8`, `amount Double`, `category Utf8`, `data Utf8`, `deleted Uint64`, `updated Uint64`; все поля `NOT NULL`, первичный ключ — `record_id`. Функция не выполняет DDL при запуске.

Маршрут `?action=seed` принимает до 500 строк и загружает только в пустую таблицу. Повторная загрузка запрещена. После сверки выгрузки переменную `SEED_SECRET` нужно удалить из версии функции; в штатной опубликованной версии этого ключа нет.

## Импорт выгрузки

Не класть JSON с семейными данными в репозиторий и не размещать его в Pages. Отправлять локальный файл напрямую к адресу тестовой функции:

```powershell
$seed = Get-Content -Raw -LiteralPath '<путь к свежей выгрузке Т1>' | ConvertFrom-Json
$payload = @{ records = @($seed) } | ConvertTo-Json -Depth 100 -Compress
Invoke-RestMethod -Method Post -Uri '<URL функции>?action=seed' -Headers @{ 'X-Seed-Key' = $env:ASSISTANT_TEST_SEED_SECRET } -ContentType 'application/json' -Body $payload
```

Ответ импорта содержит только итоговые количества. Проверьте `doc`, `list`, `menu`, `settings`, `tx`, а также активные и удалённые строки. Данные семейной выгрузки в репозиторий не добавлять.

## Опубликованная тестовая версия

Статический интерфейс публикуется отдельно от корневого приложения по адресу `https://lapin143.github.io/personal-assistant/ydb-test/`; он использует отдельную YDB `assistant-test-ydb` и изолированный `localStorage` с префиксом `assistant-ydb-test:`. Изменения в этой версии не синхронизируются с T1.

Проверки: `node --test cloud/ydb-test/test.mjs`.
