# План: режим редактирования manual token

## Цель

Добавить режим редактирования для уже созданных ручных token images: пользователь открывает существующий manual-token, видит исходную полную картинку, прежний круг/crop, preview zoom, все add/subtract alpha-полигоны и custom frame state, редактирует их и сохраняет результат в тот же token image вместо создания заново.

## Важное ограничение

Для старых manual-токенов, созданных до внедрения metadata, исходное полное изображение и alpha-полигоны в данных не сохранены. Их нельзя восстановить из итогового WebP без потерь. Для таких токенов возможен только fallback: открыть текущий WebP как новый source без истории alpha, либо не показывать кнопку редактирования. Полноценное редактирование будет доступно для новых/пересохраненных manual-токенов после внедрения metadata.

## Текущие точки кода

- `scripts/apps/MultiTokenArtManager.mjs`
  - `_onRender()` обрабатывает `data-action`, сейчас есть `create-manual-token`.
  - `#resolveActiveImageSource()` берет source из active settings и input `src`.
  - `#onCreateManualToken()` загружает source и вызывает `#openManualTokenDialog()`.
  - `#openManualTokenDialog()` создает manual state с нуля.
  - `#bindManualTokenDialog()` хранит alpha/selection/customFrame только в runtime state.
  - `#persistGeneratedTokenBlob()` загружает итоговый WebP и заменяет/создает token image.
  - `#buildGeneratedTokenImage()` создает новый token image из portrait-source manual generation.
- `scripts/data/ImageData.mjs`
  - Сейчас image entry не имеет поля для generation metadata.
- `scripts/utils/flag-utils.mjs`
  - `sanitizeImageList()` сейчас выбрасывает любые неизвестные поля, значит metadata нужно явно сохранить и санитизировать.
- `templates/settings-panel.hbs`
  - Сейчас есть кнопки auto/manual create, но нет edit action.
- `lang/en.json`, `lang/ru.json`
  - Понадобятся строки для edit button/dialog/errors.

## Модель metadata

Добавить optional поле на token image entry, например `manualToken`:

```js
manualToken: {
  version: 1,
  source: {
    src: "multi-tokenart/.../source.webp",       // durable cached full source path
    originalSrc: "...",                         // исходный путь до копирования, для диагностики
    imageType: "token" | "portrait",
    imageId: "..." | null,
    naturalWidth: 0,
    naturalHeight: 0
  },
  selection: {
    centerX: 0,
    centerY: 0,
    cropSize: 0
  },
  alphaPolygons: [
    {
      operation: "add" | "subtract",
      points: [{ x: 0, y: 0 }]
    }
  ],
  previewZoom: 1,
  stageView: {
    zoom: 1,
    panX: 0,
    panY: 0
  },
  customFrame: {
    enabled: false,
    src: "multi-tokenart/.../frame.webp" | "",
    originalSrc: "..." | "",
    removeWhiteBg: false,
    offsetX: 0,
    offsetY: 0,
    scale: 1
  },
  render: {
    customFrameEnabled: false,
    textureScale: 1,
    canvasSize: null | 1024,
    compositionScale: 1,
    allowOverflowCanvas: true,
    centerOverflowCanvas: true
  }
}
```

Правила:

- Metadata хранится только на token images, потому что редактируется уже созданный token output.
- `source.src` должен указывать на durable cached copy полного исходника в actor folder, а не на итоговый generated WebP.
- `alphaPolygons` хранить в source image coordinates, как сейчас в runtime state.
- Не хранить pending/current stroke, потому что сохранение уже запрещено при pending alpha.
- Для custom frame тоже желательно сохранять durable frame `src`; object URL от drag/drop недолговечен.

## Изменения данных

1. `scripts/data/ImageData.mjs`
   - Добавить optional schema `manualToken`.
   - Поля сделать безопасными с initial/default values там, где это не приводит к появлению пустой metadata у всех изображений.
   - Если Foundry DataModel плохо принимает optional nested schema, использовать допустимый для v13 вариант, но сохранить строгую санитизацию в `flag-utils`.

2. `scripts/utils/flag-utils.mjs`
   - Добавить `sanitizeManualToken(raw)`.
   - Нормализовать:
     - source/customFrame paths как strings;
     - dimensions/selection/zoom/offsets/scales как finite numbers;
     - `operation` только `add` или `subtract`;
     - points только finite `{x,y}`;
     - polygons минимум с 3 points;
     - `version` минимум `1`.
   - В `sanitizeImageList()` включать `manualToken` только если metadata валидна: есть `source.src`, валидная `selection`, валидные source dimensions.
   - Старые images без metadata должны остаться без `manualToken`.

## Сохранение полного source/frame

3. В `MultiTokenArtManager.mjs` добавить helper для durable asset cache:
   - `#cacheManualAssetSource(src, { role, fallbackName })`.
   - Если source уже находится в actor folder и metadata уже указывает на него, можно переиспользовать.
   - Иначе попытаться `fetch(src) -> Blob -> File -> uploadFileToActorFolder()`.
   - Для `blob:`/clipboard/object URL это обязательно, иначе edit после закрытия окна невозможен.
   - Для remote URL или CORS failures: fallback на original `src` допустим только с предупреждением/ошибкой. Для требования "полное изображение внутри" предпочтительно считать failed cache блокирующей ошибкой при сохранении manual metadata.

4. Для custom frame:
   - Если frame enabled и есть frame image/path, cache frame asset аналогично source.
   - Если frame был object URL от drop/paste, перед сохранением обязательно загрузить копию в actor folder.
   - Если frame cache не удался, не сохранять непригодный `blob:` URL в metadata; либо блокировать save с error, либо сохранить token без editable frame metadata. Предпочтительный вариант: блокировать save, чтобы edit mode был честным.

## Сбор metadata при сохранении

5. Добавить helper `#buildManualTokenMetadata(state, renderMetadata, cachedAssets)`:
   - deep clone `state.selection`;
   - deep clone `state.alphaAppliedPolygons`;
   - записать `state.previewZoom`, `state.zoom`, `state.panX`, `state.panY`;
   - записать source dimensions из `state.image.naturalWidth/Height`;
   - записать custom frame config;
   - записать render metadata (`textureScale`, canvas/overflow flags).

6. Расширить `#persistGeneratedTokenBlob(...)` параметром `manualTokenMetadata = null`.
   - При `imageType === PORTRAIT`: создать новый token image и записать metadata на него.
   - При `imageType === TOKEN`: перед заменой `tokenImage.src` сохранить target image id/source context, заменить `src`, затем записать/обновить `tokenImage.manualToken`.
   - Для edit mode это будет тот же path, что и замена token image: новый WebP загружается, target token image обновляется.
   - При auto generation очищать `manualToken`, если auto generation заменяет manual-token output, чтобы кнопка edit не открывала устаревшие metadata.
   - При ручной генерации сохранять metadata всегда.

7. При сохранении Dynamic Ring/custom frame:
   - Сохранить текущую логику: custom frame отключает Dynamic Ring и пишет `textureScale` в `scaleX/Y`; non-custom Dynamic Ring пишет `textureScale` в `dynamicRing.scaleCorrection`.
   - Не сбрасывать без необходимости `ringColor/backgroundColor` при edit: брать существующие цвета target token image, если они уже были настроены.

## UI: вход в edit mode

8. В `_prepareContext()` добавить в `activeSettingsData`:
   - `canEditManualToken: imageType === IMAGE_TYPES.TOKEN && !!image.manualToken`.

9. В `templates/settings-panel.hbs` добавить кнопку рядом с manual create:
   - `data-action="edit-manual-token"`.
   - Показывать только `{{#if canEditManualToken}}`.
   - Текст:
     - EN: `EDIT MANUAL TOKEN`.
     - RU: `Редактировать ручной токен`.

10. В `_onRender()` добавить обработчик:
   - `else if (action === "edit-manual-token") await this.#onEditManualToken(event);`

11. Добавить `#onEditManualToken(event)`:
   - Проверить active settings и что это token image.
   - Получить `image.manualToken`.
   - Загрузить `manualToken.source.src` через `#loadImageElement()`.
   - Если source отсутствует/не грузится, показать понятную ошибку и не открывать dialog.
   - Если custom frame enabled и есть frame src, загрузить frame image до открытия dialog или в initialization step.
   - Вызвать `#openManualTokenDialog({ src: manualToken.source.src, imageType: IMAGE_TYPES.TOKEN, index, image, initialManualToken: manualToken, editMode: true })`.

## Восстановление manual dialog state

12. Расширить `#openManualTokenDialog({ ..., initialManualToken = null, editMode = false })`:
   - `state.editMode = editMode`;
   - `state.manualTokenSource = initialManualToken`;
   - если metadata валидна:
     - `state.isFixed = true`;
     - `state.fixedSource = { x: selection.centerX, y: selection.centerY }`;
     - `state.hoverSource = fixedSource`;
     - `state.fixedSelection = selection`;
     - `state.selection = selection`;
     - `state.previewZoom = manualToken.previewZoom`;
     - `state.zoom/panX/panY = manualToken.stageView` с fallback defaults;
     - `state.alphaAppliedPolygons = cloned manualToken.alphaPolygons`;
     - `state.alphaPendingPolygons = []`;
     - `state.customFrame` заполнить из metadata.

13. Вынести `removeWhiteBackground(img)` из локального helper в method или отдельный helper:
   - Сейчас он объявлен внутри `#bindManualTokenDialog()`, поэтому frame initialization до bind невозможна.
   - После выноса можно восстановить `state.customFrame.image` при открытии edit mode.

14. После bind/render:
   - `refreshAlphaControls()` уже вызывается в конце bind.
   - `#renderManualTokenStage(state)` уже обновляет `state.selection` и preview; при `isFixed` будет использовать `fixedSelection`.
   - Проверить, что при edit mode первый render сразу показывает круг и alpha overlay.

15. Заголовок/кнопка dialog:
   - Можно оставить текущий заголовок, либо добавить `MTA.ManualTokenEditDialogTitle`.
   - Кнопка save может остаться `Создать`, но лучше локализовать по `editMode`: `Сохранить изменения` / `Save Changes`.

## Поведение при сохранении edit mode

16. В `onCreate` внутри manual dialog:
   - Перед render/export вызвать source/frame cache helpers.
   - Создать `manualTokenMetadata` из текущего state и cached paths.
   - Передать `manualTokenMetadata` в `#persistGeneratedTokenBlob()`.
   - В edit mode `imageType` всегда `TOKEN`, поэтому target token image заменяется, новый token image не создается.
   - После сохранения dialog закрывается и manager re-render.

17. Existing manual create from portrait:
   - Продолжает создавать новый token image.
   - Новый token image получает `manualToken.source.imageType = "portrait"`, `source.imageId` исходного portrait image id, durable `source.src` и все alpha metadata.
   - После этого token image можно редактировать через token settings.

18. Existing manual create from token:
   - Перед заменой token image source metadata сохраняет старый full source path как `manualToken.source.src`.
   - Поэтому после замены `tokenImage.src` на generated WebP редактирование открывает не generated output, а исходную полную картинку.

## Локализация

19. Добавить в `lang/en.json` и `lang/ru.json`:
   - `MTA.EditManualToken`.
   - `MTA.ManualTokenEditDialogTitle`.
   - `MTA.ManualTokenSaveChanges`.
   - `MTA.ManualTokenSourceMissing`.
   - `MTA.ManualTokenMetadataInvalid`.
   - При необходимости `MTA.ManualTokenCacheFailed`.

## Стили

20. В `styles/multi-tokenart.css`:
   - При необходимости добавить стиль для edit button в settings panel.
   - Можно переиспользовать `mta-create-token-btn`, чтобы минимизировать CSS.

## Обновление CONTEXT.md

21. Обновить техническую карту:
   - Описать `manualToken` metadata shape.
   - Описать edit mode flow.
   - Описать durable source/frame caching.
   - Указать ограничение старых generated tokens без metadata.

## Проверка

1. Syntax/static:
   - `node --check scripts/apps/MultiTokenArtManager.mjs`
   - `node --check scripts/data/ImageData.mjs`
   - `node --check scripts/utils/flag-utils.mjs`
2. Manual Foundry VTT v13:
   - Создать manual token из portrait с несколькими add/subtract alpha, сохранить, открыть token settings, нажать edit, убедиться что source/circle/alpha восстановились.
   - В edit mode добавить/удалить alpha, сохранить, убедиться что token image заменен, а новая карточка не создана.
   - Создать manual token из token image, убедиться что metadata хранит исходный source до замены `src`.
   - Проверить non-custom Dynamic Ring: кольцо центрировано, overflow не режется, scaleCorrection сохраняется.
   - Проверить custom frame: frame восстанавливается, Dynamic Ring отключен, texture scale сохраняется.
   - Проверить dropped/pasted frame/source: после закрытия и повторного открытия edit mode frame/source грузятся из actor folder, а не из `blob:` URL.
   - Проверить auto generation по тому же token image: stale `manualToken` очищается или edit button пропадает.
   - Проверить старый generated token без metadata: edit button не показывается или работает только documented fallback, если он будет реализован.

## Риски

- Metadata с alpha polygons может быть большой, но actor flags должны выдержать типичный набор контуров; для очень больших масок нужно ограничить количество points или упростить stroke.
- Кэширование source/frame через `fetch()` может не работать для некоторых remote/CORS путей. Для надежного edit mode такие случаи нужно блокировать или явно предупреждать.
- Старые generated WebP нельзя полноценно восстановить без metadata.
- Если пользователь вручную меняет `src` у token image после manual metadata, metadata может стать неактуальной. При `save-settings` с измененным `src` стоит очищать `manualToken` или требовать пересоздания.
