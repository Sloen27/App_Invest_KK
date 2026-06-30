# T-Invest Companion

Локальное и Vercel-ready веб-приложение для просмотра портфеля T-Invest: счета, позиции, стоимость, доходность, последние цены, свечи и ближайшие выплаты.

Информация в приложении не является индивидуальной инвестиционной рекомендацией.

## Локальный запуск

1. Создай read-only токен в T-Invest Open API.
2. Скопируй `.env.example` в `.env`.
3. Вставь токен в `T_INVEST_TOKEN`.
4. Если приложение будет доступно не только на твоем компьютере, задай `APP_PASSWORD`.
5. Запусти:

```powershell
npm.cmd start
```

Обычный `npm start` в PowerShell может падать с ошибкой `npm.ps1`, если в Windows отключено выполнение сценариев. `npm.cmd start` обходит это без изменения системных политик.

Открой `http://localhost:5177`.

## Безопасность

- Реальный токен хранится только в `.env` локально или в Environment Variables на Vercel.
- `.env` добавлен в `.gitignore`, его нельзя коммитить.
- Используй только read-only токен T-Invest.
- Для публичного деплоя обязательно задай `APP_PASSWORD`.
- Сессия хранится в `HttpOnly` cookie, JavaScript в браузере не может прочитать cookie.
- На Vercel cookie помечается `Secure`.
- Не публикуй `T_INVEST_TOKEN`, `.env`, скриншоты токена и production environment variables.

## GitHub

Перед публикацией проверь, что `.env` не попал в git:

```powershell
git status --short
```

Затем можно создать репозиторий и запушить:

```powershell
git add .
git commit -m "Initial T-Invest companion app"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

## Vercel

Проект уже содержит serverless API в `api/[...path].js` и статический frontend в `public/`.

В Vercel добавь Environment Variables:

```text
T_INVEST_TOKEN=read-only токен T-Invest
APP_PASSWORD=длинный пароль для входа в приложение
APP_SESSION_SECRET=длинная случайная строка
T_INVEST_API_BASE=https://invest-public-api.tinkoff.ru/rest
```

После деплоя открой URL Vercel, введи `APP_PASSWORD`, и приложение начнет дергать T-Invest API с backend-стороны.

## Что уже умеет

- Показывает список счетов.
- Загружает портфель и позиции.
- Считает стоимость, ожидаемую доходность и распределение по типам инструментов.
- Подтягивает последние цены.
- Строит дневной график по выбранной позиции.
- Собирает календарь дивидендов и купонов на год вперед.
- Формирует текстовый контекст портфеля, который можно отправить Codex для разбора.
