/**
 * Rewind TT - Google Sheets backend.
 *
 * Paste this file into Extensions > Apps Script in the competition workbook.
 * The script keeps the workbook as the source of truth and exposes only the
 * public competition data through the doGet endpoint.
 */

const SETTINGS = {
  sourceCatalogId: '1FelOidNHL1bqSaKeycZux1eQcDyrosONFC_qWVTYoog',
  sourceCatalogUrl: 'https://docs.google.com/spreadsheets/d/1FelOidNHL1bqSaKeycZux1eQcDyrosONFC_qWVTYoog/export?format=csv',
  timezone: 'Europe/Madrid',
  tracksPerSeason: 4,
  maxCustomTracksPerSeason: 1,
  historyMonthsToAvoid: 2,
  chanceOf200cc: 0.2,
  pointsByPosition: [10, 7, 5, 3, 2, 1],
  sheetNames: {
    tracks: 'Tracks',
    seasons: 'Seasons',
    seasonTracks: 'SeasonTracks',
    players: 'Players',
    times: 'Times',
    config: 'Config',
    errors: 'Errors'
  },
  headers: {
    Tracks: ['trackId', 'name', 'originGame', 'isWiiOriginal', 'sourceFile', 'sourceVersion', 'active', 'retiredAt', 'lastSeenAt', 'category', 'console'],
    Seasons: ['seasonId', 'label', 'status', 'deadline', 'generatedAt', 'catalogVersion', 'starTrackId', 'notes'],
    SeasonTracks: ['seasonId', 'slot', 'trackId', 'cc', 'isStar'],
    Players: ['playerId', 'displayName', 'color', 'active', 'joinedAt', 'email', 'avatarUrl'],
    Times: ['submittedAt', 'seasonId', 'trackId', 'playerId', 'timeMs', 'cc', 'proofUrl', 'verified', 'source', 'comments'],
    Config: ['key', 'value'],
    Errors: ['createdAt', 'type', 'message', 'rawData']
  }
};

const FORM_FIELDS = {
  player: 'Jugador',
  track: 'Pista',
  time: 'Tiempo (mm:ss.mmm o milisegundos)',
  proof: 'Captura del tiempo (opcional)',
  proofUrl: 'Enlace a vídeo o ghost (opcional)',
  avatar: 'Avatar (opcional)',
  avatarUrl: 'Enlace de avatar (opcional)',
  comments: 'Comentarios (opcional)'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Rewind TT')
    .addItem('Preparar hoja', 'setupWorkbook')
    .addItem('Sincronizar catálogo Retro Rewind', 'syncRetroRewindCatalog')
    .addSeparator()
    .addItem('Generar temporada actual', 'generateCurrentSeason')
    .addItem('Regenerar temporada actual (limpia)', 'resetCurrentSeason')
    .addItem('Generar temporada siguiente', 'generateNextSeason')
    .addSeparator()
    .addItem('Crear formulario de tiempos', 'setupSubmissionForm')
    .addItem('Actualizar opciones del formulario', 'refreshSubmissionForm')
    .addItem('Crear formulario de avatar', 'setupAvatarForm')
    .addSeparator()
    .addItem('Abrir panel de revisión', 'openReviewPanel')
    .addItem('Instalar sincronización diaria', 'installAutomation')
    .addItem('Ejecutar automatización mensual ahora', 'runMonthlyAutomation')
    .addToUi();
}

function openReviewPanel() {
  const html = HtmlService.createHtmlOutput(buildReviewPanelHtml_())
    .setWidth(960)
    .setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'Rewind TT / Revisión de tiempos');
}

function listReviewSubmissions(filter) {
  const times = readRows_(getSheet_(SETTINGS.sheetNames.times));
  const players = readRows_(getSheet_(SETTINGS.sheetNames.players));
  const tracks = readRows_(getSheet_(SETTINGS.sheetNames.tracks));
  const playersById = {};
  players.forEach(function (player) { playersById[player.playerId] = player; });
  const tracksById = {};
  tracks.forEach(function (track) { tracksById[track.trackId] = track; });

  const status = String(filter || 'PENDING').toUpperCase();
  return times
    .filter(function (time) {
      if (status === 'ALL') return true;
      return String(time.verified || '').toUpperCase() === status;
    })
    .map(function (time) {
      return {
        submittedAt: time.submittedAt instanceof Date ? time.submittedAt.toISOString() : String(time.submittedAt || ''),
        seasonId: time.seasonId,
        trackName: tracksById[time.trackId] ? tracksById[time.trackId].name : time.trackId,
        playerName: playersById[time.playerId] ? playersById[time.playerId].displayName : time.playerId,
        cc: time.cc,
        timeMs: time.timeMs,
        proofUrl: time.proofUrl || '',
        verified: time.verified || 'PENDING'
      };
    });
}

function setReviewStatus(submittedAt, seasonId, trackId, playerId, timeMs, status) {
  const sheet = getSheet_(SETTINGS.sheetNames.times);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const column = function (name) { return headers.indexOf(name) + 1; };
  const submittedAtColumn = column('submittedAt');
  const seasonColumn = column('seasonId');
  const trackColumn = column('trackId');
  const playerColumn = column('playerId');
  const timeColumn = column('timeMs');
  const verifiedColumn = column('verified');
  if (!verifiedColumn) throw new Error('Times no tiene la columna verified.');

  for (let rowNumber = 2; rowNumber <= sheet.getLastRow(); rowNumber++) {
    const rowSubmitted = dateValue_(sheet.getRange(rowNumber, submittedAtColumn).getValue());
    const matchSubmitted = submittedAtColumn ? String(rowSubmitted) === String(submittedAt) : false;
    const matchSeason = seasonColumn ? String(normalizeSheetValue_('seasonId', sheet.getRange(rowNumber, seasonColumn).getValue())) === String(seasonId) : false;
    const matchTrack = trackColumn ? String(normalizeSheetValue_('trackId', sheet.getRange(rowNumber, trackColumn).getValue())) === String(trackId) : false;
    const matchPlayer = playerColumn ? String(normalizeSheetValue_('playerId', sheet.getRange(rowNumber, playerColumn).getValue())) === String(playerId) : false;
    const matchTime = timeColumn ? Number(sheet.getRange(rowNumber, timeColumn).getValue()) === Number(timeMs) : false;
    if (matchSubmitted && matchSeason && matchTrack && matchPlayer && matchTime) {
      sheet.getRange(rowNumber, verifiedColumn).setValue(String(status).toUpperCase());
      return;
    }
  }
  throw new Error('No se ha encontrado el envío para actualizar.');
}

function setupWorkbook() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SETTINGS.headers).forEach(function (sheetName) {
    ensureSheet_(spreadsheet, sheetName, SETTINGS.headers[sheetName]);
  });

  const config = getConfig_();
  const defaults = {
    SOURCE_CATALOG_ID: SETTINGS.sourceCatalogId,
    SOURCE_CATALOG_URL: SETTINGS.sourceCatalogUrl,
    TIMEZONE: SETTINGS.timezone,
    HISTORY_MONTHS_TO_AVOID: SETTINGS.historyMonthsToAvoid,
    CHANCE_OF_200CC: SETTINGS.chanceOf200cc,
    FORM_ID: '',
    FORM_URL: '',
    AVATAR_FORM_ID: '',
    AVATAR_FORM_URL: '',
    WEB_APP_URL: ''
  };

  Object.keys(defaults).forEach(function (key) {
    if (config[key] === undefined) setConfig_(key, defaults[key]);
  });

  SpreadsheetApp.getUi().alert(
    'Hoja preparada. Añade jugadores en Players, sincroniza el catálogo y genera la primera temporada.'
  );
}

function syncRetroRewindCatalog() {
  const config = getConfig_();
  const sourceId = config.SOURCE_CATALOG_ID || SETTINGS.sourceCatalogId;
  const sourceBook = SpreadsheetApp.openById(sourceId);
  const trackSheet = getSheet_(SETTINGS.sheetNames.tracks);
  ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SETTINGS.sheetNames.tracks, SETTINGS.headers.Tracks);
  const existingTracks = readRows_(trackSheet);
  const seen = {};
  const imported = [];
  const seenAt = new Date();
  let catalogVersion = config.CATALOG_VERSION || 'desconocida';

  sourceBook.getSheets().forEach(function (sourceSheet) {
    if (isBattleArenaSheet_(sourceSheet.getName())) return;
    const rows = sourceSheet.getDataRange().getDisplayValues();
    const headerRowIndex = rows.findIndex(function (row) {
      return row.some(function (cell) {
        return normalizeHeader_(cell) === 'trackname';
      });
    });
    if (headerRowIndex < 0) return;

    const headers = rows[headerRowIndex].map(normalizeHeader_);
    const column = function (name) { return headers.indexOf(normalizeHeader_(name)); };
    const trackNameColumn = column('Track Name');
    const fileColumn = column('File');
    const originalColumn = column('Original Track');
    const sourceVersion = findVersion_(rows.slice(0, headerRowIndex + 1).flat());
    if (sourceVersion) catalogVersion = sourceVersion;

    rows.slice(headerRowIndex + 1).forEach(function (row) {
      const name = cell_(row, trackNameColumn);
      const sourceFile = cell_(row, fileColumn);
      if (!name) return;

      const baseId = slug_(sourceFile || name);
      let trackId = baseId;
      let duplicateNumber = 2;
      while (seen[trackId]) trackId = baseId + '-' + duplicateNumber++;
      seen[trackId] = true;

      const originalTrack = cell_(row, originalColumn);
      const isWiiOriginal = /^(?:Wii)\s+(?!U\b)/i.test(name);
      imported.push({
        trackId: trackId,
        name: name,
        originGame: originalTrack || (isWiiOriginal ? 'Mario Kart Wii' : sourceSheet.getName()),
        isWiiOriginal: isWiiOriginal,
        sourceFile: sourceFile,
        sourceVersion: sourceVersion || catalogVersion,
        active: true,
        retiredAt: '',
        lastSeenAt: seenAt,
        category: sourceCategory_(sourceSheet.getName(), isWiiOriginal),
        console: detectConsole_(name)
      });
    });
  });

  if (imported.length < SETTINGS.tracksPerSeason) {
    throw new Error('El catálogo devuelto tiene menos de cuatro pistas. No se ha modificado la hoja.');
  }

  const sheet = trackSheet;
  const current = existingTracks;
  const merged = imported.slice();

  current.forEach(function (oldTrack) {
    if (seen[oldTrack.trackId]) return;
    merged.push({
      trackId: oldTrack.trackId,
      name: oldTrack.name,
      originGame: oldTrack.originGame,
      isWiiOriginal: oldTrack.isWiiOriginal,
      sourceFile: oldTrack.sourceFile,
      sourceVersion: oldTrack.sourceVersion,
      active: false,
      retiredAt: oldTrack.retiredAt || seenAt,
      lastSeenAt: oldTrack.lastSeenAt,
      category: oldTrack.category || (isTruthy_(oldTrack.isWiiOriginal) ? 'wii-original' : 'retro'),
      console: oldTrack.console || detectConsole_(oldTrack.name)
    });
  });

  merged.sort(compareTracks_);
  writeRows_(sheet, SETTINGS.headers.Tracks, merged);
  formatTrackSheet_(sheet);
  setConfig_('CATALOG_VERSION', catalogVersion);
  setConfig_('CATALOG_SYNCED_AT', seenAt);
}

function generateCurrentSeason() {
  const now = new Date();
  const current = Utilities.formatDate(now, SETTINGS.timezone, 'yyyy-MM').split('-').map(Number);
  generateSeason_(current[0], current[1] - 1, true);
  if (getConfig_().FORM_ID) refreshSubmissionForm();
}

function resetCurrentSeason() {
  const now = new Date();
  const current = Utilities.formatDate(now, SETTINGS.timezone, 'yyyy-MM').split('-').map(Number);
  const seasonId = current[0] + '-' + String(current[1]).padStart(2, '0');
  const seasonSheet = getSheet_(SETTINGS.sheetNames.seasons);
  const seasonExists = readRows_(seasonSheet).some(function (row) { return row.seasonId === seasonId; });
  if (!seasonExists) {
    SpreadsheetApp.getUi().alert('No existe una temporada actual para regenerar.');
    return;
  }

  const ui = SpreadsheetApp.getUi();
  const confirmation = ui.alert(
    'Regenerar ' + seasonId,
    'Se borrarán los tiempos guardados de esta temporada, la selección actual y las opciones antiguas del formulario. ¿Continuar?',
    ui.ButtonSet.YES_NO
  );
  if (confirmation !== ui.Button.YES) return;

  deleteRowsByValue_(getSheet_(SETTINGS.sheetNames.times), 'seasonId', seasonId);
  deleteRowsByValue_(getSheet_(SETTINGS.sheetNames.seasonTracks), 'seasonId', seasonId);
  deleteRowsByValue_(seasonSheet, 'seasonId', seasonId);
  generateSeason_(current[0], current[1] - 1, true);

  if (getConfig_().FORM_ID) refreshSubmissionForm();
}

function generateNextSeason() {
  const now = new Date();
  const current = Utilities.formatDate(now, SETTINGS.timezone, 'yyyy-MM').split('-').map(Number);
  const next = new Date(current[0], current[1], 1);
  generateSeason_(next.getFullYear(), next.getMonth(), true);
}

function generateSeason_(year, monthIndex, showAlert) {
  const seasonId = year + '-' + String(monthIndex + 1).padStart(2, '0');
  const seasonSheet = getSheet_(SETTINGS.sheetNames.seasons);
  const existing = readRows_(seasonSheet).some(function (row) { return row.seasonId === seasonId; });
  if (existing) {
    SpreadsheetApp.getUi().alert(seasonId + ' ya existe. No se ha vuelto a sortear.');
    return;
  }

  const tracks = readRows_(getSheet_(SETTINGS.sheetNames.tracks)).filter(function (track) {
    return isTruthy_(track.active);
  });
  const wiiTracks = tracks.filter(function (track) { return isTruthy_(track.isWiiOriginal); });
  if (!wiiTracks.length) throw new Error('No hay ninguna pista activa marcada como Wii original.');

  const seasonRows = readRows_(getSheet_(SETTINGS.sheetNames.seasonTracks));
  const config = getConfig_();
  const historyMonths = Number(config.HISTORY_MONTHS_TO_AVOID === '' || config.HISTORY_MONTHS_TO_AVOID === undefined ? SETTINGS.historyMonthsToAvoid : config.HISTORY_MONTHS_TO_AVOID);
  const previousSeasonIds = previousSeasonIds_(seasonId, historyMonths);
  const recentTrackIds = seasonRows.filter(function (row) {
    return previousSeasonIds.indexOf(row.seasonId) >= 0;
  }).map(function (row) { return row.trackId; });

  const freshTracks = tracks.filter(function (track) {
    return recentTrackIds.indexOf(track.trackId) < 0;
  });
  const pool = freshTracks.length >= SETTINGS.tracksPerSeason ? freshTracks : tracks;
  const chosenWii = randomItem_(wiiTracks.filter(function (track) { return pool.some(function (candidate) { return candidate.trackId === track.trackId; }); }));
  if (!chosenWii) throw new Error('No se ha podido encontrar una pista Wii original disponible.');

  const remaining = shuffle_(pool.filter(function (track) { return track.trackId !== chosenWii.trackId; }));
  const chosen = [chosenWii];
  let customCount = 0;
  remaining.forEach(function (track) {
    if (chosen.length >= SETTINGS.tracksPerSeason) return;
    if (isCustomTrack_(track)) {
      if (customCount >= SETTINGS.maxCustomTracksPerSeason) return;
      customCount += 1;
    }
    chosen.push(track);
  });
  if (chosen.length !== SETTINGS.tracksPerSeason) throw new Error('No hay suficientes pistas para generar la temporada.');

  const configuredChance = config.CHANCE_OF_200CC;
  const chanceOf200cc = configuredChance === '' || configuredChance === undefined
    ? SETTINGS.chanceOf200cc
    : Math.min(1, Math.max(0, Number(configuredChance)));
  const specialSlot = Math.random() < chanceOf200cc ? Math.floor(Math.random() * chosen.length) : -1;
  const starSlot = Math.floor(Math.random() * chosen.length);
  const generatedAt = new Date();
  const deadline = lastDayOfMonth_(year, monthIndex);
  const catalogVersion = getConfig_().CATALOG_VERSION || 'desconocida';

  seasonSheet.appendRow([
    seasonId,
    seasonLabel_(year, monthIndex),
    'open',
    deadline,
    generatedAt,
    catalogVersion,
    chosen[starSlot].trackId,
    specialSlot >= 0 ? 'Una pista especial de 200cc' : ''
  ]);

  const seasonTrackSheet = getSheet_(SETTINGS.sheetNames.seasonTracks);
  chosen.forEach(function (track, index) {
    seasonTrackSheet.appendRow([
      seasonId,
      index + 1,
      track.trackId,
      index === specialSlot ? 200 : 150,
      index === starSlot
    ]);
  });

  if (showAlert !== false) {
    SpreadsheetApp.getUi().alert(
      'Temporada ' + seasonId + ' generada: ' + chosen.map(function (track) { return track.name; }).join(', ')
    );
  }
}

function setupSubmissionForm() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(spreadsheet, SETTINGS.sheetNames.players, SETTINGS.headers.Players);
  const config = getConfig_();
  if (config.FORM_ID) {
    SpreadsheetApp.getUi().alert('Ya existe un formulario configurado: ' + config.FORM_URL);
    return;
  }

  const players = readRows_(getSheet_(SETTINGS.sheetNames.players)).filter(function (player) { return isTruthy_(player.active); });
  const seasons = getCurrentFormSeasons_();
  const seasonTracks = readRows_(getSheet_(SETTINGS.sheetNames.seasonTracks));
  const tracks = readRows_(getSheet_(SETTINGS.sheetNames.tracks));
  const trackChoices = seasonTracks.filter(function (row) {
    return seasons.some(function (season) { return season.seasonId === row.seasonId; });
  }).map(function (row) {
    const track = tracks.find(function (candidate) { return candidate.trackId === row.trackId; });
    return row.seasonId + ' | ' + (track ? track.name : row.trackId) + ' | ' + row.cc + 'cc';
  });

  if (!players.length) throw new Error('No hay jugadores activos en Players. Añade al menos uno con active = TRUE.');
  if (!seasons.length) throw new Error('No hay ninguna temporada abierta con deadline futuro. Genera la temporada antes de crear el formulario.');
  if (!trackChoices.length) throw new Error('La temporada abierta no tiene pistas en SeasonTracks. Comprueba que contiene cuatro filas.');

  const form = FormApp.create('Rewind TT / Enviar tiempo');
  form.setCollectEmail(true);
  form.setDescription(
    'Introduce tu mejor tiempo del mes. Formato recomendado: mm:ss.mmm.\n\n' +
    'Se permiten todos los glitches y configuraciones. La captura es opcional; el tiempo puede ser revisado por los administradores.\n\n' +
    'El correo de la respuesta debe pertenecer a un jugador autorizado.'
  );

  form.addListItem()
    .setTitle(FORM_FIELDS.player)
    .setChoiceValues(players.map(function (player) { return player.playerId + ' | ' + player.displayName; }))
    .setRequired(true);

  form.addListItem()
    .setTitle(FORM_FIELDS.track)
    .setChoiceValues(trackChoices)
    .setRequired(true);

  form.addTextItem().setTitle(FORM_FIELDS.time).setHelpText('Ejemplos: 1:42.345 o 102345').setRequired(true);

  try {
    form.addFileUploadItem().setTitle(FORM_FIELDS.proof).setHelpText('Opcional. Google puede pedir iniciar sesión para subir archivos.');
  } catch (error) {
    form.addTextItem().setTitle(FORM_FIELDS.proofUrl).setHelpText('Opcional. Enlace a una captura, vídeo o ghost.');
  }
  form.addParagraphTextItem().setTitle(FORM_FIELDS.comments);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheet.getId());

  setConfig_('FORM_ID', form.getId());
  setConfig_('FORM_URL', form.getPublishedUrl());
  removeTriggers_('onFormSubmit');
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(spreadsheet).onFormSubmit().create();

  SpreadsheetApp.getUi().alert('Formulario creado:\n' + form.getPublishedUrl());
}

function refreshSubmissionForm(showAlert) {
  ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SETTINGS.sheetNames.players, SETTINGS.headers.Players);
  const formId = getConfig_().FORM_ID;
  if (!formId) throw new Error('Todavía no existe un formulario. Ejecuta Crear formulario de tiempos.');

  const form = FormApp.openById(formId);
  form.setCollectEmail(true);
  const players = readRows_(getSheet_(SETTINGS.sheetNames.players)).filter(function (player) { return isTruthy_(player.active); });
  const seasons = getCurrentFormSeasons_();
  const seasonTracks = readRows_(getSheet_(SETTINGS.sheetNames.seasonTracks));
  const tracks = readRows_(getSheet_(SETTINGS.sheetNames.tracks));
  const playerItem = form.getItems(FormApp.ItemType.LIST).find(function (item) { return item.getTitle() === FORM_FIELDS.player; });
  const trackItem = form.getItems(FormApp.ItemType.LIST).find(function (item) { return item.getTitle() === FORM_FIELDS.track; });
  const trackChoices = seasonTracks.filter(function (row) {
    return seasons.some(function (season) { return season.seasonId === row.seasonId; });
  }).map(function (row) {
    const track = tracks.find(function (candidate) { return candidate.trackId === row.trackId; });
    return row.seasonId + ' | ' + (track ? track.name : row.trackId) + ' | ' + row.cc + 'cc';
  });

  if (!playerItem || !trackItem) throw new Error('No se han encontrado las preguntas desplegables del formulario.');
  if (!players.length) throw new Error('No hay jugadores activos en Players.');
  if (!trackChoices.length) throw new Error('No hay pistas de una temporada abierta.');
  playerItem.asListItem().setChoiceValues(players.map(function (player) {
    return player.playerId + ' | ' + player.displayName;
  }));
  trackItem.asListItem().setChoiceValues(trackChoices);
  if (showAlert !== false) SpreadsheetApp.getUi().alert('Opciones del formulario actualizadas.');
}

function setupAvatarForm() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(spreadsheet, SETTINGS.sheetNames.players, SETTINGS.headers.Players);
  const config = getConfig_();
  if (config.AVATAR_FORM_ID) {
    SpreadsheetApp.getUi().alert('Ya existe un formulario de avatar: ' + config.AVATAR_FORM_URL);
    return;
  }

  const form = FormApp.create('Rewind TT / Cambiar avatar');
  form.setCollectEmail(true);
  form.setDescription(
    'Sube una imagen cuadrada para tu perfil. El correo de la cuenta Google identifica automáticamente al jugador autorizado.\n\n' +
    'La imagen se guardará en Drive y se mostrará públicamente en la web.'
  );
  form.addTextItem()
    .setTitle(FORM_FIELDS.avatarUrl)
    .setHelpText('Opcional. Se usa como alternativa si no añades una pregunta de subida de archivos.');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheet.getId());

  setConfig_('AVATAR_FORM_ID', form.getId());
  setConfig_('AVATAR_FORM_URL', form.getPublishedUrl());
  removeTriggers_('onAvatarSubmit');
  ScriptApp.newTrigger('onAvatarSubmit').forSpreadsheet(spreadsheet).onFormSubmit().create();

  SpreadsheetApp.getUi().alert(
    'Formulario creado. Ábrelo en modo edición y añade una pregunta "Subir archivos" con el título "' + FORM_FIELDS.avatar + '".'
  );
}

function onAvatarSubmit(event) {
  try {
    const values = event.namedValues || {};
    const rawAvatar = getAvatarFromSubmission_(values);
    if (!rawAvatar) return;
    const submittedEmail = getSubmittedEmail_(event);
    const player = readRows_(getSheet_(SETTINGS.sheetNames.players)).find(function (row) {
      return isTruthy_(row.active) && normalizeEmail_(row.email) === normalizeEmail_(submittedEmail);
    });
    if (!submittedEmail || !player) throw new Error('El correo del avatar no pertenece a un jugador activo.');

    const avatarUrl = makeAvatarPublicUrl_(rawAvatar);
    updatePlayerAvatar_(player.playerId, avatarUrl);
  } catch (error) {
    getSheet_(SETTINGS.sheetNames.errors).appendRow([
      new Date(),
      'AVATAR_SUBMISSION',
      error.message,
      JSON.stringify(event && event.namedValues ? event.namedValues : {})
    ]);
  }
}

function getAvatarFromSubmission_(values) {
  const directValue = getNamedValue_(values, FORM_FIELDS.avatar) || getNamedValue_(values, FORM_FIELDS.avatarUrl);
  if (directValue) return directValue;
  const uploadKey = Object.keys(values).find(function (key) {
    return /avatar|foto|imagen|archivo|file|upload/i.test(String(key));
  });
  return uploadKey ? getNamedValue_(values, uploadKey) : '';
}

function makeAvatarPublicUrl_(value) {
  const raw = String(value || '').trim();
  const driveIdMatch = raw.match(/[-\w]{20,}/);
  if (!driveIdMatch || !/drive\.google|^[-\w]{20,}$/.test(raw)) return raw;

  const fileId = driveIdMatch[0];
  const file = DriveApp.getFileById(fileId);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w400';
}

function updatePlayerAvatar_(playerId, avatarUrl) {
  const sheet = getSheet_(SETTINGS.sheetNames.players);
  ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SETTINGS.sheetNames.players, SETTINGS.headers.Players);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const playerColumn = headers.indexOf('playerId') + 1;
  const avatarColumn = headers.indexOf('avatarUrl') + 1;
  if (!playerColumn || !avatarColumn) throw new Error('Players no tiene las columnas necesarias.');

  for (let rowNumber = 2; rowNumber <= sheet.getLastRow(); rowNumber++) {
    const value = normalizeSheetValue_('playerId', sheet.getRange(rowNumber, playerColumn).getValue());
    if (value === playerId) {
      sheet.getRange(rowNumber, avatarColumn).setValue(avatarUrl);
      return;
    }
  }
  throw new Error('No se ha encontrado el jugador en Players.');
}

function onFormSubmit(event) {
  try {
    const values = event.namedValues || {};
    const get = function (key) { return values[key] && values[key][0] ? values[key][0].trim() : ''; };
    const playerValue = get(FORM_FIELDS.player);
    const trackValue = get(FORM_FIELDS.track);
    const timeValue = get(FORM_FIELDS.time);
    if (!playerValue || !trackValue || !timeValue) return;
    const submittedEmail = getSubmittedEmail_(event);
    const playerId = playerValue.split(' | ')[0];
    const trackParts = trackValue.split(' | ');
    const seasonId = trackParts[0];
    const cc = Number(String(trackParts[trackParts.length - 1]).replace(/[^0-9]/g, '')) || 150;
    const trackName = trackParts.slice(1, -1).join(' | ');
    const timeMs = parseTimeToMs_(timeValue);
    const now = new Date();
    const season = readRows_(getSheet_(SETTINGS.sheetNames.seasons)).find(function (row) { return row.seasonId === seasonId; });
    const tracks = readRows_(getSheet_(SETTINGS.sheetNames.tracks));
    const track = tracks.find(function (row) { return row.name === trackName; });
    const player = readRows_(getSheet_(SETTINGS.sheetNames.players)).find(function (row) {
      return row.playerId === playerId && isTruthy_(row.active);
    });
    const authorizedPlayer = readRows_(getSheet_(SETTINGS.sheetNames.players)).find(function (row) {
      return isTruthy_(row.active) && normalizeEmail_(row.email) === normalizeEmail_(submittedEmail);
    });

    if (!submittedEmail) throw new Error('No se ha podido verificar el correo del remitente.');
    if (!authorizedPlayer) throw new Error('El correo del remitente no está autorizado en Players.');
    if (!playerId || !player || !seasonId || !track || !timeMs || !season) throw new Error('Faltan datos obligatorios o el tiempo no es válido.');
    if (authorizedPlayer.playerId !== playerId) throw new Error('El correo autorizado no coincide con el jugador seleccionado.');
    if (Date.now() > new Date(season.deadline).getTime()) throw new Error('La temporada ya está cerrada.');

    const seasonTrack = readRows_(getSheet_(SETTINGS.sheetNames.seasonTracks)).find(function (row) {
      return row.seasonId === seasonId && row.trackId === track.trackId && Number(row.cc) === cc;
    });
    if (!seasonTrack) throw new Error('La pista no pertenece a esa temporada.');

    const proof = getProofFromSubmission_(values);
    getSheet_(SETTINGS.sheetNames.times).appendRow([
      now,
      seasonId,
      track.trackId,
      playerId,
      timeMs,
      cc,
      proof,
      'PENDING',
      'FORM',
      get(FORM_FIELDS.comments)
    ]);
  } catch (error) {
    getSheet_(SETTINGS.sheetNames.errors).appendRow([
      new Date(),
      'FORM_SUBMISSION',
      error.message,
      JSON.stringify(event && event.namedValues ? event.namedValues : {})
    ]);
  }
}

function installAutomation() {
  removeTriggers_('syncRetroRewindCatalog');
  removeTriggers_('runMonthlyAutomation');
  ScriptApp.newTrigger('syncRetroRewindCatalog').timeBased().everyDays(1).atHour(4).create();
  ScriptApp.newTrigger('runMonthlyAutomation').timeBased().onMonthDay(1).atHour(3).create();
  SpreadsheetApp.getUi().alert('Automatización instalada: catálogo diario y temporada mensual el día 1.');
}

function runMonthlyAutomation() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;

  try {
    syncRetroRewindCatalog();
    closeExpiredSeasons_();

    const current = Utilities.formatDate(new Date(), SETTINGS.timezone, 'yyyy-MM').split('-').map(Number);
    const seasonId = current[0] + '-' + String(current[1]).padStart(2, '0');
    const seasonExists = readRows_(getSheet_(SETTINGS.sheetNames.seasons)).some(function (row) {
      return row.seasonId === seasonId;
    });
    if (!seasonExists) generateSeason_(current[0], current[1] - 1, false);

    if (getConfig_().FORM_ID) refreshSubmissionForm(false);
    setConfig_('LAST_MONTHLY_AUTOMATION_AT', new Date());
    setConfig_('LAST_MONTHLY_AUTOMATION_STATUS', 'OK');
  } catch (error) {
    setConfig_('LAST_MONTHLY_AUTOMATION_AT', new Date());
    setConfig_('LAST_MONTHLY_AUTOMATION_STATUS', 'ERROR');
    getSheet_(SETTINGS.sheetNames.errors).appendRow([
      new Date(),
      'MONTHLY_AUTOMATION',
      error.message,
      ''
    ]);
  } finally {
    lock.releaseLock();
  }
}

function closeExpiredSeasons_() {
  const sheet = getSheet_(SETTINGS.sheetNames.seasons);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return;

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const statusColumn = headers.indexOf('status') + 1;
  const deadlineColumn = headers.indexOf('deadline') + 1;
  if (!statusColumn || !deadlineColumn) return;

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const status = String(sheet.getRange(rowNumber, statusColumn).getValue() || '').toLowerCase();
    const deadline = sheet.getRange(rowNumber, deadlineColumn).getValue();
    if (status !== 'closed' && deadline && new Date(deadline).getTime() < Date.now()) {
      sheet.getRange(rowNumber, statusColumn).setValue('closed');
    }
  }
}

function getCurrentFormSeasons_() {
  closeExpiredSeasons_();
  const current = Utilities.formatDate(new Date(), SETTINGS.timezone, 'yyyy-MM');
  return readRows_(getSheet_(SETTINGS.sheetNames.seasons)).filter(function (season) {
    return season.seasonId === current && season.status !== 'closed' && new Date(season.deadline).getTime() >= Date.now();
  });
}

function doGet(event) {
  const payload = JSON.stringify(buildPublicData_());
  const callback = event && event.parameter && event.parameter.callback;
  if (callback && /^[A-Za-z_$][\w$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + payload + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
}

function buildPublicData_() {
  const config = getConfig_();
  const tracks = readRows_(getSheet_(SETTINGS.sheetNames.tracks));
  const seasons = readRows_(getSheet_(SETTINGS.sheetNames.seasons));
  const currentSeasonId = seasons.slice().sort(function (a, b) { return b.seasonId.localeCompare(a.seasonId); })[0];
  return {
    meta: {
      currentSeasonId: currentSeasonId ? currentSeasonId.seasonId : '',
      catalogVersion: config.CATALOG_VERSION || 'desconocida',
      lastUpdated: new Date().toISOString(),
      timezone: config.TIMEZONE || SETTINGS.timezone,
      avatarFormUrl: config.AVATAR_FORM_URL || '',
      sourceCatalogUrl: config.SOURCE_CATALOG_URL || SETTINGS.sourceCatalogUrl,
      rules: {
        defaultCc: 150,
        max200ccPerSeason: 1,
        maxCustomTracksPerSeason: SETTINGS.maxCustomTracksPerSeason,
        glitchesAllowed: true,
        deadline: 'last-day-23:59',
        pointsByPosition: SETTINGS.pointsByPosition,
        completionBonus: 2,
        starTrackMultiplier: 2
      }
    },
    players: readRows_(getSheet_(SETTINGS.sheetNames.players)).map(function (row) {
      return { id: row.playerId, displayName: row.displayName, color: row.color, avatarUrl: row.avatarUrl || '', active: isTruthy_(row.active) };
    }),
    tracks: tracks.map(function (row) {
      return {
        id: row.trackId,
        name: row.name,
        originGame: row.originGame,
        isWiiOriginal: isTruthy_(row.isWiiOriginal),
        category: row.category || (isTruthy_(row.isWiiOriginal) ? 'wii-original' : 'retro'),
        console: row.console || detectConsole_(row.name),
        active: isTruthy_(row.active),
        retiredAt: row.retiredAt || ''
      };
    }),
    seasons: seasons.map(function (row) {
      return {
        id: row.seasonId,
        label: row.label,
        status: row.status,
        deadline: dateValue_(row.deadline),
        generatedAt: dateValue_(row.generatedAt),
        catalogVersion: row.catalogVersion,
        starTrackId: row.starTrackId,
        notes: row.notes || ''
      };
    }),
    seasonTracks: readRows_(getSheet_(SETTINGS.sheetNames.seasonTracks)).map(function (row) {
      return {
        seasonId: row.seasonId,
        slot: Number(row.slot),
        trackId: row.trackId,
        cc: Number(row.cc),
        isStar: isTruthy_(row.isStar)
      };
    }),
    times: readRows_(getSheet_(SETTINGS.sheetNames.times)).map(function (row) {
      return {
        submittedAt: dateValue_(row.submittedAt),
        seasonId: row.seasonId,
        trackId: row.trackId,
        playerId: row.playerId,
        timeMs: Number(row.timeMs),
        cc: Number(row.cc),
        proofUrl: row.proofUrl || '',
        verified: row.verified || 'PENDING'
      };
    }).filter(function (row) {
      return row.seasonId && row.trackId && row.playerId && Number.isFinite(row.timeMs);
    })
  };
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const existingHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
    headers.forEach(function (header) {
      if (existingHeaders.indexOf(header) >= 0) return;
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      existingHeaders.push(header);
    });
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return sheet;
}

function getSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('No existe la pestaña ' + name + '. Ejecuta Preparar hoja.');
  return sheet;
}

function readRows_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  return sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues().map(function (values) {
    const row = {};
    headers.forEach(function (header, index) { row[header] = normalizeSheetValue_(header, values[index]); });
    return row;
  }).filter(function (row) {
    return Object.keys(row).some(function (key) { return row[key] !== ''; });
  });
}

function normalizeSheetValue_(header, value) {
  const identifierHeaders = ['seasonId', 'trackId', 'playerId'];
  if (identifierHeaders.indexOf(header) < 0) return value;
  if (value === '' || value === null || value === undefined) return '';
  if (header === 'seasonId' && value instanceof Date) {
    return Utilities.formatDate(value, SETTINGS.timezone, 'yyyy-MM');
  }
  return String(value).trim();
}

function writeRows_(sheet, headers, rows) {
  const currentRows = Math.max(0, sheet.getLastRow() - 1);
  if (currentRows) sheet.getRange(2, 1, currentRows, headers.length).clearContent();
  if (!rows.length) return;
  const values = rows.map(function (row) {
    return headers.map(function (header) { return row[header] === undefined ? '' : row[header]; });
  });
  sheet.getRange(2, 1, values.length, headers.length).setValues(values);
}

function getConfig_() {
  const sheet = getSheet_(SETTINGS.sheetNames.config);
  const rows = readRows_(sheet);
  const result = {};
  rows.forEach(function (row) { result[row.key] = row.value; });
  return result;
}

function setConfig_(key, value) {
  const sheet = getSheet_(SETTINGS.sheetNames.config);
  const rows = readRows_(sheet);
  const rowIndex = rows.findIndex(function (row) { return row.key === key; });
  if (rowIndex >= 0) {
    sheet.getRange(rowIndex + 2, 2).setValue(value);
  } else {
    sheet.appendRow([key, value]);
  }
}

function deleteRowsByValue_(sheet, header, expectedValue) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return;
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const columnIndex = headers.indexOf(header);
  if (columnIndex < 0) return;

  for (let rowNumber = lastRow; rowNumber >= 2; rowNumber--) {
    const value = sheet.getRange(rowNumber, columnIndex + 1).getValue();
    const normalizedValue = normalizeSheetValue_(header, value);
    if (String(normalizedValue) === String(expectedValue)) sheet.deleteRow(rowNumber);
  }
}

function formatTrackSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) return;

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const column = function (name) { return headers.indexOf(name) + 1; };
  const nameColumn = column('name');
  const categoryColumn = column('category');
  const consoleColumn = column('console');
  const activeColumn = column('active');
  const header = sheet.getRange(1, 1, 1, lastColumn);

  header
    .setBackground('#202124')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  header.setWrap(true);
  sheet.setRowHeight(1, 34);
  sheet.setFrozenRows(1);
  sheet.setTabColor('#d7ff4f');

  if (lastRow < 2) return;
  const rows = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  const backgrounds = rows.map(function (row) {
    const inactive = activeColumn > 0 && !isTruthy_(row[activeColumn - 1]);
    return row.map(function () { return inactive ? '#f1f3f4' : '#ffffff'; });
  });
  const fontColors = rows.map(function (row) {
    const inactive = activeColumn > 0 && !isTruthy_(row[activeColumn - 1]);
    return row.map(function () { return inactive ? '#9aa0a6' : '#202124'; });
  });

  const categoryColors = {
    retro: '#d9eaf7',
    'wii-original': '#d9ead3',
    custom: '#fce5cd'
  };
  const consoleColors = {
    SNES: '#f4cccc',
    N64: '#c9daf8',
    GBA: '#d9ead3',
    GCN: '#d9d2e9',
    DS: '#fff2cc',
    Wii: '#b6d7a8',
    'Wii U': '#cfe2f3',
    '3DS': '#ead1dc',
    Tour: '#fce5cd',
    RMX: '#d9d2e9',
    'Arcade GP': '#f4cccc',
    Switch: '#d0e0e3',
    'Switch 2': '#d0e0e3',
    Custom: '#ead1dc'
  };

  rows.forEach(function (row, rowIndex) {
    const category = categoryColumn > 0 ? String(row[categoryColumn - 1] || '') : '';
    const consoleName = consoleColumn > 0 ? String(row[consoleColumn - 1] || '') : '';
    const inactive = activeColumn > 0 && !isTruthy_(row[activeColumn - 1]);
    if (categoryColumn > 0 && !inactive) backgrounds[rowIndex][categoryColumn - 1] = categoryColors[category] || '#eeeeee';
    if (consoleColumn > 0 && !inactive) backgrounds[rowIndex][consoleColumn - 1] = consoleColors[consoleName] || '#eeeeee';
    if (nameColumn > 0 && !inactive) backgrounds[rowIndex][nameColumn - 1] = consoleColors[consoleName] || '#f8f9fa';
    if (activeColumn > 0) {
      backgrounds[rowIndex][activeColumn - 1] = inactive ? '#f4cccc' : '#d9ead3';
      fontColors[rowIndex][activeColumn - 1] = inactive ? '#990000' : '#274e13';
    }
  });

  const dataRange = sheet.getRange(2, 1, lastRow - 1, lastColumn);
  dataRange.setBackgrounds(backgrounds).setFontColors(fontColors).setVerticalAlignment('middle');
  dataRange.setFontSize(10);
  if (nameColumn > 0) sheet.setColumnWidth(nameColumn, 220);
  if (categoryColumn > 0) sheet.setColumnWidth(categoryColumn, 115);
  if (consoleColumn > 0) sheet.setColumnWidth(consoleColumn, 95);
  if (activeColumn > 0) sheet.setColumnWidth(activeColumn, 75);
  sheet.autoResizeColumns(1, Math.max(1, lastColumn));
  if (nameColumn > 0) sheet.setColumnWidth(nameColumn, 220);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getRange(1, 1, lastRow, lastColumn).createFilter();
}

function previousSeasonIds_(seasonId, amount) {
  const [year, month] = seasonId.split('-').map(Number);
  const ids = [];
  for (let offset = 1; offset <= Number(amount); offset++) {
    const date = new Date(year, month - 1 - offset, 1);
    ids.push(date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0'));
  }
  return ids;
}

function lastDayOfMonth_(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0, 23, 59, 59);
}

function seasonLabel_(year, monthIndex) {
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return months[monthIndex] + ' ' + year;
}

function parseTimeToMs_(value) {
  const input = String(value || '').trim().replace(',', '.');
  if (!input) return 0;
  if (/^\d+$/.test(input)) return Number(input);
  const parts = input.split(':').map(Number);
  if (parts.some(function (part) { return !Number.isFinite(part); })) return 0;
  if (parts.length === 2 && parts[1] < 60) return Math.round(parts[0] * 60000 + parts[1] * 1000);
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) return Math.round(parts[0] * 3600000 + parts[1] * 60000 + parts[2] * 1000);
  return 0;
}

function getSubmittedEmail_(event) {
  const namedValues = event && event.namedValues ? event.namedValues : {};
  const emailKey = Object.keys(namedValues).find(function (key) {
    return /email|correo|e-mail/i.test(String(key));
  });
  if (emailKey && namedValues[emailKey] && namedValues[emailKey][0]) return String(namedValues[emailKey][0]).trim();
  if (event && event.response && typeof event.response.getRespondentEmail === 'function') {
    return String(event.response.getRespondentEmail() || '').trim();
  }
  return '';
}

function getProofFromSubmission_(values) {
  const directValue = getNamedValue_(values, FORM_FIELDS.proof) || getNamedValue_(values, FORM_FIELDS.proofUrl);
  if (directValue) return normalizeProofLinks_(directValue);

  const uploadKey = Object.keys(values).find(function (key) {
    return /captura|archivo|imagen|foto|file|upload/i.test(String(key));
  });
  return uploadKey ? normalizeProofLinks_(getNamedValue_(values, uploadKey)) : '';
}

function getNamedValue_(values, key) {
  if (!values[key] || !values[key][0]) return '';
  return String(values[key][0]).trim();
}

function normalizeProofLinks_(value) {
  return String(value || '').split(/\s*,\s*/).map(function (part) {
    if (/^https?:\/\//i.test(part)) return part;
    if (/^[A-Za-z0-9_-]{20,}$/.test(part)) return 'https://drive.google.com/open?id=' + encodeURIComponent(part);
    return part;
  }).filter(Boolean).join(', ');
}

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function findVersion_(values) {
  for (let index = 0; index < values.length; index++) {
    const match = String(values[index] || '').match(/v\d+(?:\.\d+)+/i);
    if (match) return match[0];
  }
  return '';
}

function normalizeHeader_(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isBattleArenaSheet_(name) {
  return /battle|arena/i.test(String(name || ''));
}

function sourceCategory_(sheetName, isWiiOriginal) {
  if (/custom/i.test(String(sheetName || ''))) return 'custom';
  if (isWiiOriginal) return 'wii-original';
  return 'retro';
}

function isCustomTrack_(track) {
  return String(track.category || '').toLowerCase() === 'custom';
}

function detectConsole_(trackName) {
  const name = String(trackName || '');
  const consoles = [
    [/^Wii U\b/i, 'Wii U'],
    [/^Wii\b/i, 'Wii'],
    [/^SNES\b/i, 'SNES'],
    [/^N64\b/i, 'N64'],
    [/^GBA\b/i, 'GBA'],
    [/^GCN\b/i, 'GCN'],
    [/^3DS\b/i, '3DS'],
    [/^DS\b/i, 'DS'],
    [/^Tour\b/i, 'Tour'],
    [/^RMX\b/i, 'RMX'],
    [/^GP\b/i, 'Arcade GP'],
    [/^SW2\b/i, 'Switch 2'],
    [/^SW\b/i, 'Switch']
  ];
  const match = consoles.find(function (entry) { return entry[0].test(name); });
  return match ? match[1] : 'Custom';
}

function compareTracks_(left, right) {
  const categoryOrder = {
    retro: 0,
    'wii-original': 1,
    custom: 2
  };
  const consoleOrder = {
    SNES: 0,
    N64: 1,
    GBA: 2,
    GCN: 3,
    DS: 4,
    Wii: 5,
    '3DS': 6,
    'Wii U': 7,
    Tour: 8,
    RMX: 9,
    'Arcade GP': 10,
    Switch: 11,
    'Switch 2': 12,
    Custom: 99
  };
  const leftCategory = categoryOrder[left.category] === undefined ? 99 : categoryOrder[left.category];
  const rightCategory = categoryOrder[right.category] === undefined ? 99 : categoryOrder[right.category];
  const leftConsole = consoleOrder[left.console] === undefined ? 99 : consoleOrder[left.console];
  const rightConsole = consoleOrder[right.console] === undefined ? 99 : consoleOrder[right.console];
  const leftActive = isTruthy_(left.active) ? 0 : 1;
  const rightActive = isTruthy_(right.active) ? 0 : 1;
  return leftCategory - rightCategory || leftConsole - rightConsole || leftActive - rightActive || String(left.name || '').localeCompare(String(right.name || ''));
}

function cell_(row, index) {
  return index >= 0 ? String(row[index] || '').trim() : '';
}

function slug_(value) {
  return String(value || 'track')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'track';
}

function isTruthy_(value) {
  const normalized = String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return value === true || normalized === 'true' || normalized === '1' || normalized === 'si';
}

function dateValue_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function randomItem_(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle_(items) {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = result[index];
    result[index] = result[swapIndex];
    result[swapIndex] = current;
  }
  return result;
}

function removeTriggers_(functionName) {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === functionName) ScriptApp.deleteTrigger(trigger);
  });
}

function buildReviewPanelHtml_() {
  return [
    '<!doctype html><html><head><base target="_top"><meta charset="utf-8">',
    '<style>',
    '*{box-sizing:border-box}body{margin:0;padding:24px;background:#101018;color:#f2f0e8;font-family:system-ui,-apple-system,Segoe UI,sans-serif}',
    'h1{margin:0 0 4px;font-size:20px;letter-spacing:-.02em}h1 span{color:#d7ff4f}.sub{color:#92919b;font-size:12px;margin:0 0 18px}',
    '.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px}',
    '.tab{border:1px solid rgba(245,244,237,.16);background:#171720;color:#92919b;padding:7px 12px;font-size:12px;cursor:pointer;border-radius:4px}',
    '.tab.active{background:#d7ff4f;color:#101018;border-color:#d7ff4f}',
    'select{background:#171720;border:1px solid rgba(245,244,237,.16);color:#f2f0e8;padding:7px 10px;font-size:12px;border-radius:4px}',
    'table{width:100%;border-collapse:collapse;font-size:12.5px}',
    'th{text-align:left;color:#92919b;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:8px 10px;border-bottom:1px solid rgba(245,244,237,.16)}',
    'td{padding:10px;border-bottom:1px solid rgba(245,244,237,.08);vertical-align:top}',
    'tr:hover td{background:rgba(215,255,79,.03)}',
    '.time{font-family:ui-monospace,monospace;color:#d7ff4f}',
    '.badge{display:inline-block;padding:3px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;border-radius:3px}',
    '.b-pending{background:rgba(255,200,87,.15);color:#ffc857}.b-approved{background:rgba(167,220,150,.15);color:#a7dc96}.b-rejected{background:rgba(255,107,157,.15);color:#ff6b9d}',
    'a.proof{color:#65d7ff;text-decoration:none;font-size:12px}a.proof:hover{text-decoration:underline}',
    '.actions{display:flex;gap:6px}.btn{border:0;padding:6px 10px;font-size:11px;border-radius:4px;cursor:pointer}',
    '.btn-ok{background:#a7dc96;color:#101018}.btn-no{background:#ff6b9d;color:#101018}.btn:hover{filter:brightness(1.1)}',
    '.empty{color:#92919b;text-align:center;padding:40px 0;font-size:13px}',
    '</style></head><body>',
    '<h1>Revisión de <span>tiempos</span></h1><p class="sub">Aprobar o rechazar envíos pendientes. Los cambios se guardan al instante en la hoja.</p>',
    '<div class="bar">',
    '<button class="tab active" data-filter="PENDING">Pendientes</button>',
    '<button class="tab" data-filter="APPROVED">Aprobados</button>',
    '<button class="tab" data-filter="REJECTED">Rechazados</button>',
    '<button class="tab" data-filter="ALL">Todos</button>',
    '<select id="player-filter"><option value="">Todos los jugadores</option></select>',
    '</div>',
    '<table><thead><tr><th>Hora</th><th>Jugador</th><th>Pista</th><th>CC</th><th>Tiempo</th><th>Prueba</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="rows"></tbody></table>',
    '<div id="empty" class="empty" style="display:none">No hay envíos para este filtro.</div>',
    '<script>',
    'var currentFilter="PENDING";var currentPlayer="";var rows=[];',
    'function load(){google.script.run.withSuccessHandler(onLoad).listReviewSubmissions(currentFilter);}',
    'function onLoad(data){rows=data;renderPlayers();render();}',
    'function renderPlayers(){var sel=document.getElementById("player-filter");var seen={};sel.innerHTML=\'<option value="">Todos los jugadores</option>\';rows.forEach(function(r){if(seen[r.playerName])return;seen[r.playerName]=1;var o=document.createElement("option");o.value=r.playerName;o.textContent=r.playerName;sel.appendChild(o);});sel.value=currentPlayer;}',
    'function render(){var tbody=document.getElementById("rows");var empty=document.getElementById("empty");tbody.innerHTML="";var list=rows.filter(function(r){return !currentPlayer||r.playerName===currentPlayer;});empty.style.display=list.length?"none":"block";list.forEach(function(r){var tr=document.createElement("tr");tr.innerHTML=',
    '\'<td>\'+esc(r.submittedAt.slice(0,16).replace("T"," "))+\'</td>\'+',
    '\'<td>\'+esc(r.playerName)+\'</td>\'+',
    '\'<td>\'+esc(r.trackName)+\'</td>\'+',
    '\'<td>\'+r.cc+\'</td>\'+',
    '\'<td class="time">\'+formatMs(r.timeMs)+\'</td>\'+',
    '\'<td>\'+proofLink(r.proofUrl)+\'</td>\'+',
    '\'<td><span class="badge b-\'+r.verified.toLowerCase()+\'">\'+esc(r.verified)+\'</span></td>\'+',
    '\'<td><div class="actions">\'+actionBtn(r,"APPROVED","Aprobar","btn-ok")+actionBtn(r,"REJECTED","Rechazar","btn-no")+\'</div></td>\';',
    'tbody.appendChild(tr);});}',
    'function proofLink(url){if(!url)return "—";var first=url.split(",")[0].trim();return \'<a class="proof" href="\'+first+\'" target="_blank">Ver prueba ↗</a>\';}',
    'function actionBtn(r,status,label,cls){return \'<button class="btn \'+cls+\'" data-idx="\'+rows.indexOf(r)+\'" data-status="\'+status+\'">\'+label+\'</button>\';}',
    'function formatMs(ms){ms=Number(ms);var m=Math.floor(ms/60000);var s=Math.floor((ms%60000)/1000);var mm=Math.floor(ms%1000);return m+":"+String(s).padStart(2,"0")+"."+String(mm).padStart(3,"0");}',
    'function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}',
    'document.querySelectorAll(".tab").forEach(function(b){b.addEventListener("click",function(){document.querySelectorAll(".tab").forEach(function(x){x.classList.remove("active");});b.classList.add("active");currentFilter=b.dataset.filter;currentPlayer="";load();});});',
    'document.getElementById("player-filter").addEventListener("change",function(e){currentPlayer=e.target.value;render();});',
    'document.getElementById("rows").addEventListener("click",function(e){var btn=e.target.closest("button[data-status]");if(!btn)return;var r=rows[Number(btn.dataset.idx)];if(!r)return;btn.disabled=true;google.script.run.withSuccessHandler(function(){load();}).withFailureHandler(function(){btn.disabled=false;}).setReviewStatus(r.submittedAt,r.seasonId,r.trackId,r.playerId,r.timeMs,btn.dataset.status);});',
    'load();',
    '</script></body></html>'
  ].join('\n');
}
