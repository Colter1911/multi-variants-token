# Technical Map: Multi Token Art

## Назначение модуля

`Multi Token Art` (`multi-tokenart`) - модуль Foundry VTT v13 для управления несколькими визуальными состояниями персонажа: токенами на сцене и портретами в интерфейсе. Модуль хранит две библиотеки изображений на акторе, позволяет переключать их вручную, выбирать случайно, связывать токен с портретом, реагировать на HP/статусы, управлять Dynamic Token Ring и генерировать круглые токены из исходных артов.

Если этот документ расходится с исходным кодом, исходный код считается авторитетным. При изменении архитектуры или ключевых потоков обновляйте этот файл вместе с кодом.

## Загрузка Foundry-модуля

- Manifest: `module.json`.
- Module id: `multi-tokenart`.
- Foundry compatibility: minimum/verified `13`.
- Сначала Foundry загружает `scripts/lib/face-api.min.js`, затем ES module `scripts/module.mjs`.
- Стили подключаются из `styles/multi-tokenart.css`.
- Локализация подключается из `lang/en.json` и `lang/ru.json`.
- `socket: true` включает модульный socket для файловых операций игроков через активного GM.
- Константы модуля находятся в `scripts/constants.mjs`.

## Главные точки входа

Основной entrypoint: `scripts/module.mjs`.

Ключевые hooks:

- `init`: регистрирует настройки, кнопки Token HUD, кнопки в заголовках actor sheet, публичный API и preload Handlebars partials.
- `ready`: применяет выбранный системный HP preset, регистрирует socket handlers, повторно выставляет API, для GM принудительно ставит core `dynamicTokenRingScaling` в `grid`, добавляет `globalThis.MultiTokenArtDebug`, для активного GM показывает first-run выбор системы.
- `updateActor` и `updateToken`: отслеживают изменения configured HP paths и запускают debounced auto activation; `updateToken` также ловит немодульные `texture.src` изменения, чтобы временно блокировать автосмену при Foundry-превращениях/маскировке.
- `createActiveEffect`, `updateActiveEffect`, `deleteActiveEffect`: запускают auto activation при изменении статусов/эффектов.
- `createItem`, `updateItem`, `deleteItem`: в PF2e запускают auto activation при изменении embedded condition items.
- `createToken`: выбирает начальные token/portrait images с учетом active/default/random состояния, применяет Dynamic Ring и запускает auto activation.
- `renderActorSheet`: подменяет видимый портрет sheet на token-specific active portrait.

Важные детали выполнения:

- `scheduleAutoActivationForActor()` использует actor-объект из hook, а не `game.actors.get(actorId)`, чтобы unlinked-токены сохраняли synthetic actor delta flags.
- Автоматизацию токена выполняет активный GM. Не-GM запускает ее только в edge-case без активного GM и при наличии прав на update токена.
- Опция `{ mtaManualUpdate: true }` используется как guard, чтобы собственные обновления модуля не запускали повторную автоматизацию.

## Публичный API

`scripts/module.mjs` записывает методы в `game.modules.get("multi-tokenart").api`:

- `runAutoActivation`
- `openManagerForTokenDocument`
- `openManagerForActor`
- `openManagerForActorById`
- aliases: `openManager`, `openForControlledToken`, `openForActor`, `openForActorById`

Для ручного debug также доступен `globalThis.MultiTokenArtDebug` с методами открытия менеджера.

## Модель данных и flags

Основные файлы:

- `scripts/data/ModuleData.mjs`
- `scripts/data/ImageData.mjs`
- `scripts/utils/flag-utils.mjs`
- `scripts/constants.mjs`

Actor flag root: `flags.multi-tokenart`.

Actor-level shape:

- `version`
- `global.autoRotate`
- `global.tokenRandom`
- `global.portraitRandom`
- `global.linkTokenPortrait`
- `tokenImages[]`
- `portraitImages[]`

Image entry shape:

- `id`
- `src`
- `scaleX`
- `scaleY`
- `sort`
- `isDefault`
- `autoEnable.enabled`
- `autoEnable.wounded`
- `autoEnable.woundedPercent`
- `autoEnable.die`
- `autoEnable.status`
- `customScript`
- `dynamicRing.enabled`
- `dynamicRing.scaleCorrection`
- `dynamicRing.ringColor`
- `dynamicRing.backgroundColor`

Открытые Active Effect атрибуты из `MTA_EFFECT_ATTRIBUTES`:

- `mta.settoken`: 1-based номер token image в текущем отсортированном визуальном порядке.
- `mta.setportrait`: 1-based номер portrait image в текущем отсортированном визуальном порядке.
- Значения читаются из active effect `changes[].value`; mode Foundry не важен, для пользователя подходит `custom`.

Token flag keys из `TOKEN_FLAG_KEYS`:

- `activeTokenImageId`
- `activePortraitImageId`
- `originalRing`
- `originalRotation`
- `lastUpdate`
- `managedTokenImageSrc`
- `externalTokenImageSrc`
- `preExternalTokenImageId`

Дополнительные token flags, используемые напрямую:

- `preConditionImageId`
- `preConditionPortraitId`

Нормализация данных:

- `getActorModuleData()` читает raw flags, прогоняет их через sanitizer и `ModuleData`.
- `setActorModuleData()` перед записью снова нормализует данные.
- Sanitizer удаляет пустые `src`, восстанавливает id, устраняет дубли id, сортирует по `sort`, гарантирует один default image, ограничивает `woundedPercent` диапазоном `1..99`, проверяет hex colors.

## Пользовательский интерфейс

Основные файлы:

- `scripts/apps/MultiTokenArtManager.mjs`
- `scripts/apps/SettingsPanel.mjs`
- `scripts/ui/TokenHUD.mjs`
- `scripts/ui/DragDrop.mjs`
- `templates/manager.hbs`
- `templates/settings-panel.hbs`
- `templates/partials/image-card.hbs`
- `templates/partials/confirm-dialog.hbs`
- `styles/multi-tokenart.css`

`MultiTokenArtManager` - главный ApplicationV2/Handlebars UI. Он отвечает за две библиотеки изображений, активный выбор, settings panel, random buttons, link mode, auto rotate, upload/paste/drop, внутреннюю сортировку карточек, копирование между token/portrait зонами, автоматическую и ручную генерацию токенов, batch generation.

`TokenHUD.mjs` добавляет открытие менеджера из Token HUD и actor sheet. В нем есть Foundry v13 hooks (`renderApplicationV2`) и legacy fallback (`renderTokenHUD`). `openManagerForActor()` проверяет owner-доступ и открывает `MultiTokenArtManager` с actor и optional token context.

`SettingsPanel.mjs` остается отдельным UI-классом, при этом текущий менеджер также использует `templates/settings-panel.hbs` внутри основного окна.

`DragDrop.mjs` - вспомогательный слой для drop/upload поведения; основная внутренняя сортировка карточек реализована в `MultiTokenArtManager.mjs`.

## Основные сценарии работы

Ручной выбор изображения:

- Пользователь кликает image card.
- `MultiTokenArtManager.#onSelectImage()` вызывает `applyTokenImageById()` или `applyPortraitById()`.
- Token image меняет texture source/scale и активный token flag.
- Portrait image меняет `actor.img` и token-specific active portrait flag при token context.

Добавление изображений:

- Поддержаны placeholder add, drag/drop файлов, Foundry data drop, paste image из clipboard и paste URL/path.
- Файлы загружаются через `uploadFileToActorFolder()` в actor-specific folder.
- Лимит библиотеки: `IMAGE_LIMIT = 100`.

Сортировка и перенос:

- Карточки имеют внутренний drag payload `mta-image-card-drag`.
- Drop внутри той же зоны меняет порядок.
- Drop между token/portrait зонами копирует image entry с новым id.
- После reorder/copy пересчитывается `sort`.

Default image:

- В каждой библиотеке должен быть один default.
- При сохранении default image модуль сразу применяет его к actor/prototype token и, если есть token context, к текущему token.

## Автоматизация по HP и статусам

Основные файлы:

- `scripts/logic/AutoActivation.mjs`
- `scripts/system-support.mjs`
- `scripts/utils/hp-resolver.mjs`
- `scripts/settings.mjs`

Priority order в `findBestImageForHp()`:

0. Active Effect override: `mta.settoken` / `mta.setportrait` выбирают конкретный image по 1-based номеру.
1. Dead image: `HP <= 0` и `autoEnable.die`.
2. Status image: `autoEnable.status` совпадает с активным статусом/эффектом.
3. Wounded image: HP percent ниже configured threshold; более строгий threshold побеждает.
4. Manual persistence: текущий активный image сохраняется, если он не special image.
5. Restore pre-condition: после выхода из special state восстанавливается `preConditionImageId` или `preConditionPortraitId`.
6. Default fallback.

Status matching учитывает:

- effect `name`
- effect `label`
- effect `statusId`
- effect `slug`
- effect/item `system.slug`
- effect/item `flags.core.statusId`
- `statuses` как Set/Array/nested field
- token effects
- `tokenDoc.statuses`
- `tokenDoc.hasStatusEffect(id)`, если доступен
- PF2e condition items из `actor.itemTypes.condition`, `actor.items` и `actor.conditions`

Status matching нормализует значения перед сравнением: case-insensitive, пробелы/underscore/hyphen приводятся к slug-like форме. Это позволяет PF2e slug values вроде `off-guard` совпадать с сохраненными label-like значениями.

`applyTokenImageById()`:

- обновляет `texture.src`, `texture.scaleX`, `texture.scaleY`;
- пишет `activeTokenImageId`, `managedTokenImageSrc`, `preConditionImageId`, `lastUpdate` и очищает внешние override-флаги;
- добавляет Dynamic Ring payload или disable-ring payload;
- refresh-ит token object;
- для linked token синхронизирует actor `prototypeToken` и actor-level active token flag;
- при включенном `linkTokenPortrait` применяет связанный portrait.

Внешние изменения token image:

- Немодульный `updateToken` с изменением `texture.src` вызывает `handleExternalTokenImageChange()`.
- Если новый `texture.src` не совпадает с `managedTokenImageSrc` и не найден в `tokenImages`, на токене пишется `externalTokenImageSrc`; пока текущий `texture.src` совпадает с этим флагом, `runAutoActivation()` пропускает автосмену token image.
- При сбросе Foundry-превращения/маскировки к `managedTokenImageSrc` или любому известному `tokenImages[].src` внешние override-флаги очищаются, после чего force activation с игнорированием manual persistence заново применяет подходящий HP/status/default token image со scale, Dynamic Ring и связанными параметрами.
- При включенном `linkTokenPortrait` связанный portrait не двигается от token image, если token image заблокирован внешним override.

Active Effect override behavior:

- Активные эффекты на actor с `changes[].key = "mta.settoken"` или `"mta.setportrait"` имеют приоритет над HP/status/manual persistence.
- Если несколько активных эффектов задают один атрибут, побеждает последний найденный change при обходе `actor.effects`.
- При создании/обновлении/удалении эффекта с MTA-атрибутами используется force activation с игнорированием manual persistence, чтобы при отключении эффекта токен/портрет вернулись к текущему HP/status/default расчету.

`applyPortraitById()`:

- обновляет `actor.img`;
- при token context пишет `activePortraitImageId` и `preConditionPortraitId` на token;
- без token context пишет actor-level active portrait flag.

## Random mode

Файл: `scripts/logic/RandomMode.mjs`.

- `pickRandomImage()` исключает из random pool изображения с `autoEnable.enabled`.
- Если все изображения auto-enabled, используется default image.
- `sortImagesByOrder()` сортирует список по `sort`.
- `tokenRandom` и `portraitRandom` влияют на `createToken` и ручную команду refresh random.

## Связка токена и портрета

Link mode хранится в `global.linkTokenPortrait`.

- При включении portrait следует за token image по визуальному индексу в отсортированных списках.
- `getLinkedPortraitByTokenImage()` берет индекс token image в `tokenImages`, затем выбирает portrait с тем же индексом в `portraitImages`.
- Если пары нет, текущий portrait не меняется.
- При включении link mode из UI сразу запускается `runAutoActivation()`.

## Dynamic Ring

Файл: `scripts/logic/DynamicRing.mjs`.

- `getDynamicRingUpdate()` строит update payload для включения Dynamic Ring, сохраняет original ring state в `originalRing`, применяет ring/background colors и subject scale.
- `getDisableRingUpdate()` сохраняет original ring state при необходимости и явно ставит `ring.enabled = false`.
- `getRestoreRingUpdate()` восстанавливает original ring, очищает stale `subject.texture`, удаляет `originalRing` flag.
- Эти функции в основном возвращают payload, а фактический `tokenDocument.update()` делает вызывающий код.
- В `ready` hook GM выставляет core `dynamicTokenRingScaling = "grid"`, что нужно для корректной отрисовки колец.

## Auto Rotate

Файл: `scripts/logic/AutoRotate.mjs`.

- `applyAutoRotate()` хранит исходный rotation в `originalRotation`.
- При HP `<= 0` и включенном `global.autoRotate` токен поворачивается на `270`.
- При восстановлении HP или отключении auto rotate модуль возвращает исходный rotation.
- Изменение auto rotate в UI сразу применяет или сбрасывает поворот текущего токена.

## Генерация токенов

Основные файлы:

- `scripts/logic/AutoTokenService.mjs`
- `scripts/apps/MultiTokenArtManager.mjs`
- `models/tiny_face_detector_model-weights_manifest.json`
- `scripts/lib/face-api.min.js`

Automatic generation:

- `AutoTokenService` - singleton через `AutoTokenService.instance()`.
- `init()` один раз загружает TinyFaceDetector из `modules/multi-tokenart/models`.
- `createTokenBlob(imageSource, 2.5)` загружает изображение, пытается найти лицо на raw image, затем на proxy canvas с серым фоном.
- Если лицо не найдено, используется центр изображения и fallback face size.
- Результат рендерится в circular WebP token blob на canvas `512`.

Manual generation:

- Запускается из `MultiTokenArtManager.#onCreateManualToken()`.
- Открывает inline `Dialog` со stage canvas и preview canvas.
- Поддерживает crop lock, zoom/pan, preview zoom, additive/subtractive alpha polygons, custom frame image, frame offset/scale, optional white background removal.
- Preview создается через `createTokenCanvasFromSelection()`.
- Финальный WebP создается через `createTokenBlobFromSelection()`.
- Для custom frame используется larger canvas behavior (`1024`) и overflow-aware metadata.
- Custom-frame outputs отключают Dynamic Ring и сохраняют `textureScale` из render metadata, чтобы итоговый token scale совпадал с preview.

Persistence generated token:

- Имя файла строится из source basename, mode tag (`auto`/`manual`), timestamp и random nonce.
- Upload идет через `uploadFileToActorFolder()`.
- Если source был portrait image, создается новый token image на соответствующей позиции.
- Если source был token image, текущий token image заменяет `src`.
- После сохранения вызывается `applyTokenImageById()`, чтобы применить созданный token immediately.

## Файлы, загрузки и socket

Файл: `scripts/utils/file-utils.mjs`.

- Разрешенные расширения: `webp`, `png`, `jpg`, `jpeg`, `gif`, `svg`, `avif`.
- Root upload folder: `multi-tokenart`.
- Actor folder: slugified actor name, actor id или `unknown-actor`.
- GM создает directories локально через `FilePicker.createDirectory("data", target)`.
- Не-GM при ошибке локального создания запрашивает active GM через socket `module.multi-tokenart`.
- Socket request types: `ensure-directory-request`, `ensure-directory-response`.
- Timeout socket request: `8000` ms.
- Upload использует `FilePicker.upload("data", folder, file, { notify: false }, { notify: false })`, чтобы подавить стандартный success toast Foundry.

## Настройки HP

Основные файлы:

- `scripts/settings.mjs`
- `scripts/system-support.mjs`
- `scripts/utils/hp-resolver.mjs`

World settings:

- `systemMode`
- `systemPrompted`
- `hpCurrentPath`
- `hpMaxPath`

Default paths:

- `system.attributes.hp.value`
- `system.attributes.hp.max`

System presets:

- `dnd5e`: `system.attributes.hp.value` / `system.attributes.hp.max`
- `pf2e`: `system.attributes.hp.value` / `system.attributes.hp.max`
- `wfrp4e`: `system.status.wounds.value` / `system.status.wounds.max`

`systemMode` поддерживает `auto`, `dnd5e`, `pf2e`, `wfrp4e`, `custom`. `auto` использует `game.system.id`, если он есть среди поддержанных presets. `custom` не применяет HP preset и оставляет ручные paths.

`applySystemPresetIfNeeded()` меняет настройки только если обе HP paths все еще равны default values, кроме случаев явной смены `systemMode` или first-run выбора, где preset применяется принудительно.

При первом запуске активный GM видит окно выбора системы. Подтверждение пишет `systemMode`, применяет HP preset и ставит `systemPrompted = true`.

`resolveHpData(actor)` возвращает:

- `current`
- `max`
- `percent`

## Локализация, шаблоны и стили

Files:

- `lang/en.json`
- `lang/ru.json`
- `templates/manager.hbs`
- `templates/settings-panel.hbs`
- `templates/partials/image-card.hbs`
- `templates/partials/confirm-dialog.hbs`
- `styles/multi-tokenart.css`

Правила поддержки UI:

- Новые пользовательские строки добавлять в оба language file.
- Главная структура менеджера находится в `templates/manager.hbs`.
- Карточка изображения централизована в `templates/partials/image-card.hbs`.
- Settings panel markup находится в `templates/settings-panel.hbs`.
- Manual token dialog markup генерируется inline в `MultiTokenArtManager.mjs`, а стили для него находятся в `styles/multi-tokenart.css`.

## Карта файлов

- `module.json`: Foundry manifest.
- `Project-resume.md`: продуктовая документация на русском.
- `scripts/module.mjs`: entrypoint, hooks, public API, automation scheduling.
- `scripts/constants.mjs`: module id, setting keys, image types, status constants, token flag keys.
- `scripts/settings.mjs`: world settings, first-run system dialog и применение HP presets.
- `scripts/system-support.mjs`: system mode presets, HP paths, status option lists, PF2e condition extraction и normalized status matching.
- `scripts/data/ModuleData.mjs`: root actor flag DataModel.
- `scripts/data/ImageData.mjs`: DataModel для одного image entry.
- `scripts/utils/flag-utils.mjs`: чтение, sanitize и запись actor/token flags.
- `scripts/utils/hp-resolver.mjs`: чтение HP по configured paths.
- `scripts/utils/file-utils.mjs`: actor upload folders, image validation, GM socket directory creation, upload.
- `scripts/ui/TokenHUD.mjs`: кнопки открытия менеджера в Token HUD и actor sheet.
- `scripts/ui/DragDrop.mjs`: helper для drop/upload поведения.
- `scripts/apps/MultiTokenArtManager.mjs`: главный UI и orchestration большинства user flows.
- `scripts/apps/SettingsPanel.mjs`: отдельный settings UI class.
- `scripts/logic/AutoActivation.mjs`: HP/status/default/manual selection и применение token/portrait images.
- `scripts/logic/RandomMode.mjs`: random selection и сортировка.
- `scripts/logic/AutoRotate.mjs`: поворот токена при нулевом HP.
- `scripts/logic/DynamicRing.mjs`: Dynamic Ring update payloads и restore/disable behavior.
- `scripts/logic/AutoTokenService.mjs`: automatic/manual token rendering и face detection.
- `scripts/lib/face-api.min.js`: bundled face-api runtime.
- `models/`: TinyFaceDetector model weights/manifest.
- `templates/`: Handlebars templates and partials.
- `lang/`: localization dictionaries.
- `styles/multi-tokenart.css`: all module UI styles.

## Правила поддержки и риски

- Не ломайте distinction actor context vs token context. Actor-only flows должны обновлять prototype token, token context flows должны обновлять конкретный token и token flags.
- Для unlinked tokens не заменяйте synthetic actor из hook на base actor из `game.actors.get()`.
- Любые изменения HP automation проверяйте против priority order в `findBestImageForHp()`.
- При изменении Dynamic Ring учитывайте snapshot/restore flags `originalRing` и очистку `subject.texture`.
- При изменении auto rotate учитывайте `originalRotation` и немедленный reset при отключении.
- Random mode должен исключать auto-enabled images, чтобы автоматические состояния не появлялись случайно.
- Link token/portrait завязан на sorted visual index, а не на id/name matching.
- File upload должен работать для игроков через active GM socket; не предполагайте, что игрок может создавать data directories напрямую.
- Manual token custom frame flow чувствителен к canvas geometry, alpha masks, overflow canvas и persisted `textureScale`.
- Любой новый UI text должен попасть в `lang/en.json` и `lang/ru.json`.

## Быстрый чеклист перед изменениями

- Прочитать релевантные файлы из карты, а не править по памяти.
- Определить, меняется actor-level состояние, token-level состояние или оба.
- Проверить, нужны ли guards против повторных hooks (`mtaManualUpdate`).
- Проверить linked token/prototype behavior.
- Проверить unlinked token behavior.
- Проверить, не нарушена ли auto activation priority.
- Проверить Dynamic Ring и Auto Rotate side effects.
- Если менялась архитектура или основной flow, обновить этот `CONTEXT.md`.
