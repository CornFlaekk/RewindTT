(function () {
  "use strict";

  const config = window.MKW_CONFIG || {};
  const state = {
    data: null,
    selectedSeasonId: null,
    countdownTimer: null,
    selectedPlayerId: null,
    leaderboardMode: "month"
  };

  const pointsByPosition = [10, 7, 5, 3, 2, 1];
  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindEvents();

    try {
      state.data = await loadData();
      state.selectedSeasonId = getCurrentSeasonId(state.data);
      render();
    } catch (error) {
      console.error(error);
      showToast("No se han podido cargar los datos.");
      renderError();
    }
  }

  function cacheElements() {
    [
      "season-label",
      "season-status",
      "countdown",
      "season-select",
      "catalog-note",
      "track-grid",
      "leaderboard",
      "leaderboard-caption",
      "profile-select",
      "profile-card",
      "history-list",
      "submit-button",
      "last-updated",
      "toast"
    ].forEach(function (id) {
      els[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    els["season-select"].addEventListener("change", function (event) {
      state.selectedSeasonId = event.target.value;
      render();
      document.getElementById("pistas").scrollIntoView({ behavior: "smooth", block: "start" });
    });

    document.querySelectorAll('a[href="#enviar"]').forEach(function (link) {
      link.addEventListener("click", function () {
        if (!config.submitUrl) {
          window.setTimeout(function () {
            showToast("Configura la URL del formulario en config.js.");
          }, 0);
        }
      });
    });

    document.querySelectorAll("[data-leaderboard-mode]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.leaderboardMode = button.dataset.leaderboardMode;
        document.querySelectorAll("[data-leaderboard-mode]").forEach(function (tab) {
          const isSelected = tab.dataset.leaderboardMode === state.leaderboardMode;
          tab.classList.toggle("is-active", isSelected);
          tab.setAttribute("aria-selected", String(isSelected));
        });
        if (state.data) {
          renderLeaderboard(state.data, getSeason(state.data, state.selectedSeasonId));
        }
      });
    });

    els["profile-select"].addEventListener("change", function (event) {
      state.selectedPlayerId = event.target.value;
      renderProfile(state.data, getSeason(state.data, state.selectedSeasonId));
    });
  }

  async function loadData() {
    const url = config.dataUrl || "./data/demo.json";
    if (config.dataSource === "jsonp") {
      return loadJsonp(url);
    }

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Data request failed with status " + response.status);
    }
    return response.json();
  }

  function loadJsonp(url) {
    return new Promise(function (resolve, reject) {
      const callbackName = "__mkwTtCallback_" + Date.now();
      const script = document.createElement("script");
      const separator = url.indexOf("?") === -1 ? "?" : "&";
      const timeout = window.setTimeout(function () {
        cleanup();
        reject(new Error("JSONP request timed out"));
      }, 15000);

      window[callbackName] = function (data) {
        cleanup();
        resolve(data);
      };

      script.src = url + separator + "callback=" + encodeURIComponent(callbackName);
      script.onerror = function () {
        cleanup();
        reject(new Error("JSONP request failed"));
      };
      document.head.appendChild(script);

      function cleanup() {
        window.clearTimeout(timeout);
        delete window[callbackName];
        script.remove();
      }
    });
  }

  function render() {
    const data = state.data;
    const season = getSeason(data, state.selectedSeasonId);
    if (!season) {
      renderError("Todavía no hay ninguna temporada generada.");
      return;
    }

    renderSeasonPicker(data, season.id);
    renderSeasonHeader(data, season);
    renderTracks(data, season);
    renderLeaderboard(data, season);
    renderProfile(data, season);
    renderHistory(data, season);
    renderSubmitLink();

    const sourceVersion = data.meta && data.meta.catalogVersion ? data.meta.catalogVersion : "última versión";
    els["catalog-note"].textContent = "Catálogo Retro Rewind · " + sourceVersion;
    els["last-updated"].textContent = "Actualizado " + formatDateTime(data.meta && data.meta.lastUpdated);
  }

  function renderSeasonPicker(data, selectedId) {
    els["season-select"].innerHTML = data.seasons
      .slice()
      .sort(function (a, b) {
        return b.id.localeCompare(a.id);
      })
      .map(function (season) {
        return '<option value="' + escapeHtml(season.id) + '"' + (season.id === selectedId ? " selected" : "") + ">" + escapeHtml(formatSeasonLabel(season)) + "</option>";
      })
      .join("");
  }

  function renderSeasonHeader(data, season) {
    els["season-label"].textContent = formatSeasonLabel(season);
    window.clearInterval(state.countdownTimer);
    updateCountdown(season);
    state.countdownTimer = window.setInterval(function () {
      updateCountdown(season);
    }, 1000);
  }

  function updateCountdown(season) {
    const isOpen = new Date(season.deadline).getTime() >= Date.now() && season.status !== "closed";
    els["season-status"].textContent = isOpen ? "ABIERTO" : "CERRADO";
    els["season-status"].previousElementSibling.classList.toggle("is-closed", !isOpen);
    if (!isOpen) {
      els["countdown"].textContent = "Temporada cerrada";
      return;
    }

    const remaining = Math.max(0, new Date(season.deadline).getTime() - Date.now());
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    els["countdown"].textContent = days + "d " + String(hours).padStart(2, "0") + "h " + String(minutes).padStart(2, "0") + "m";
  }

  function renderTracks(data, season) {
    const trackRows = getSeasonTracks(data, season.id);
    const bestTimes = getBestTimes(data, season.id);

    els["track-grid"].innerHTML = trackRows
      .map(function (row, index) {
        const track = getTrack(data, row.trackId);
        if (!track) return "";
        const entries = getTrackEntries(data, season.id, row.trackId, bestTimes);
        const topEntry = entries[0];
        const consoleMeta = getConsoleMeta(track);
        const categoryMeta = getCategoryMeta(track);
        const badges = [
          '<span class="pill pill-console ' + consoleMeta.className + '"><span class="console-pill-icon">' + escapeHtml(consoleMeta.icon) + '</span>' + escapeHtml(consoleMeta.label) + '</span>',
          '<span class="pill pill-category ' + categoryMeta.className + '">' + escapeHtml(categoryMeta.label) + '</span>',
          row.cc === 200 ? '<span class="pill pill-hot">200cc</span>' : '<span class="pill">150cc</span>',
          row.isStar ? '<span class="pill pill-star">Pista estrella ×2</span>' : ""
        ].join("");
        const entriesMarkup = entries.length
          ? entries
              .slice(0, 3)
              .map(function (entry, entryIndex) {
                const timeMarkup = entry.proofUrl
                  ? '<a class="entry-proof" href="' + escapeHtml(entry.proofUrl) + '" target="_blank" rel="noreferrer" title="Abrir prueba">' + formatTime(entry.timeMs) + " ↗</a>"
                  : formatTime(entry.timeMs);
                return (
                  '<div class="track-entry"><span class="entry-rank">' +
                  (entryIndex + 1).toString().padStart(2, "0") +
                  '</span><span class="entry-name">' +
                  escapeHtml(entry.player.displayName) +
                  '</span><strong>' +
                  timeMarkup +
                  (isPending(entry.verified) ? '<small class="entry-pending">pendiente</small>' : "") +
                  "</strong></div>"
                );
              })
              .join("")
          : '<p class="empty-state">Aún no hay tiempos. Sé el primero.</p>';

        return (
          '<article class="track-card' + (row.isStar ? " is-star" : "") + '">' +
          '<div class="track-card-number">0' + (index + 1) + '</div>' +
          '<div class="track-card-content">' + renderTrackArt(track) + '<div class="track-card-top"><div class="track-badges">' +
          badges +
          '</div><span class="track-origin">' +
          escapeHtml(track.originGame || "Retro Rewind") +
          '</span></div><h3>' +
          escapeHtml(track.name) +
          '</h3><div class="track-leader">' +
          (topEntry ? '<span>Marca a batir</span><strong>' + formatTime(topEntry.timeMs) + "</strong>" : "") +
          '</div><div class="track-entries">' +
          entriesMarkup +
          '</div><div class="track-card-footer"><span>' +
          entries.length +
          (entries.length === 1 ? " marca" : " marcas") +
          '</span><span class="track-arrow">↘</span></div></div></article>'
        );
      })
      .join("");
    bindBrokenImages(els["track-grid"]);
  }

  function renderProfile(data, season) {
    const players = data.players.filter(function (player) {
      return player.active !== false || data.times.some(function (time) {
        return time.playerId === player.id;
      });
    }).sort(function (a, b) {
      return a.displayName.localeCompare(b.displayName);
    });
    if (!players.length) {
      els["profile-select"].innerHTML = "";
      els["profile-card"].innerHTML = '<p class="empty-state empty-state-large">Aún no hay jugadores.</p>';
      return;
    }

    if (!state.selectedPlayerId || !players.some(function (player) { return player.id === state.selectedPlayerId; })) {
      state.selectedPlayerId = players[0].id;
    }
    els["profile-select"].innerHTML = players.map(function (player) {
      return '<option value="' + escapeHtml(player.id) + '"' + (player.id === state.selectedPlayerId ? ' selected' : '') + '>' + escapeHtml(player.displayName) + '</option>';
    }).join("");

    const player = players.find(function (candidate) { return candidate.id === state.selectedPlayerId; });
    const trackRows = getSeasonTracks(data, season.id);
    const monthly = calculateScores(data, season, trackRows).find(function (row) { return row.player.id === player.id; });
    const overall = calculateOverallScores(data).find(function (row) { return row.player.id === player.id; });
    const bestTimes = getBestTimes(data, season.id);
    const trackTimes = trackRows.map(function (row) {
      const track = getTrack(data, row.trackId);
      const entry = getTrackEntries(data, season.id, row.trackId, bestTimes).find(function (candidate) {
        return candidate.player.id === player.id;
      });
      return { row: row, track: track, entry: entry };
    });

    els["profile-card"].innerHTML =
      '<div class="profile-identity"><div class="profile-avatar" style="--player-color:' + escapeHtml(player.color || "#d7ff4f") + '">' +
      renderAvatarContent(player) +
      '</div><div><p class="section-kicker">Piloto</p><h3>' + escapeHtml(player.displayName) + '</h3><span>@' + escapeHtml(player.id) + '</span></div></div>' +
      '<div class="profile-stat-grid"><div><span>Este mes</span><strong>' + (monthly ? monthly.totalPoints : 0) + ' <small>pts</small></strong></div>' +
      '<div><span>General</span><strong>' + (overall ? overall.totalPoints : 0) + ' <small>pts</small></strong></div>' +
      '<div><span>Victorias</span><strong>' + (overall ? overall.wins : 0) + '</strong></div>' +
      '<div><span>Pendientes</span><strong>' + (monthly ? monthly.pending : 0) + '</strong></div></div>' +
      '<div class="profile-times"><div class="profile-times-head"><span>Mejores marcas · ' + escapeHtml(formatSeasonLabel(season)) + '</span><span>' +
      (monthly ? monthly.completed : 0) + '/' + trackRows.length + ' pistas</span></div>' +
      trackTimes.map(function (item) {
        const time = item.entry ? formatTime(item.entry.timeMs) : "—";
        const proof = item.entry && item.entry.proofUrl
          ? '<a href="' + escapeHtml(item.entry.proofUrl) + '" target="_blank" rel="noreferrer">prueba ↗</a>'
          : "";
        const status = item.entry && isPending(item.entry.verified) ? '<small class="entry-pending">pendiente</small>' : "";
        return '<div class="profile-time-row"><span class="profile-track-name"><b>' + escapeHtml(item.track ? item.track.name : item.row.trackId) + '</b><small>' + item.row.cc + 'cc</small></span><span class="profile-time-value">' + time + status + proof + '</span></div>';
      }).join("") + '</div>';
    bindBrokenImages(els["profile-card"]);
  }

  function renderTrackArt(track) {
    const consoleMeta = getConsoleMeta(track);
    const image = track.imageUrl
      ? '<img data-fallback-image src="' + escapeHtml(track.imageUrl) + '" alt="" loading="lazy">'
      : "";
    return '<div class="track-art ' + consoleMeta.className + (image ? ' has-image' : '') + '"><div class="art-fallback"><span class="art-console-icon">' + escapeHtml(consoleMeta.icon) + '</span><span>' + escapeHtml(consoleMeta.label) + '</span></div>' + image + '</div>';
  }

  function renderAvatarContent(player) {
    const initial = escapeHtml(String(player.displayName || "?").slice(0, 1).toUpperCase());
    return '<span class="avatar-initial">' + initial + '</span>' + (player.avatarUrl ? '<img data-fallback-image src="' + escapeHtml(player.avatarUrl) + '" alt="" loading="lazy">' : "");
  }

  function bindBrokenImages(root) {
    if (!root) return;
    root.querySelectorAll("img[data-fallback-image]").forEach(function (image) {
      image.addEventListener("error", function () {
        const art = image.closest(".track-art");
        if (art) art.classList.remove("has-image");
        image.remove();
      });
    });
  }

  function getCategoryMeta(track) {
    const category = String(track.category || (track.isWiiOriginal ? "wii-original" : "retro")).toLowerCase();
    if (category === "custom") return { label: "CUSTOM", className: "category-custom" };
    if (category === "wii-original") return { label: "WII ORIGINAL", className: "category-wii" };
    return { label: "RETRO", className: "category-retro" };
  }

  function getConsoleMeta(track) {
    const name = String(track.console || inferConsole_(track.name));
    const meta = {
      SNES: ["SNES", "S", "console-snes"],
      N64: ["N64", "64", "console-n64"],
      GBA: ["GBA", "A", "console-gba"],
      GCN: ["GCN", "G", "console-gcn"],
      DS: ["DS", "DS", "console-ds"],
      Wii: ["WII", "W", "console-wii"],
      "Wii U": ["WII U", "U", "console-wiiu"],
      "3DS": ["3DS", "3D", "console-3ds"],
      Tour: ["TOUR", "T", "console-tour"],
      RMX: ["RMX", "R", "console-rmx"],
      "Arcade GP": ["ARCADE", "GP", "console-arcade"],
      Switch: ["SWITCH", "S", "console-switch"],
      "Switch 2": ["SWITCH 2", "S2", "console-switch"]
    }[name] || ["CUSTOM", "?", "console-custom"];
    return { label: meta[0], icon: meta[1], className: meta[2] };
  }

  function inferConsole_(name) {
    const value = String(name || "");
    const prefixes = [
      [/^Wii U\b/i, "Wii U"], [/^Wii\b/i, "Wii"], [/^SNES\b/i, "SNES"], [/^N64\b/i, "N64"],
      [/^GBA\b/i, "GBA"], [/^GCN\b/i, "GCN"], [/^3DS\b/i, "3DS"], [/^DS\b/i, "DS"],
      [/^Tour\b/i, "Tour"], [/^RMX\b/i, "RMX"], [/^GP\b/i, "Arcade GP"], [/^SW2\b/i, "Switch 2"], [/^SW\b/i, "Switch"]
    ];
    const result = prefixes.find(function (entry) { return entry[0].test(value); });
    return result ? result[1] : "Custom";
  }

  function renderLeaderboard(data, season) {
    const trackRows = getSeasonTracks(data, season.id);
    const isOverall = state.leaderboardMode === "overall";
    const scoring = isOverall ? calculateOverallScores(data) : calculateScores(data, season, trackRows);
    els["leaderboard-caption"].textContent = isOverall
      ? data.seasons.length + " meses · puntos acumulados"
      : trackRows.length + " pistas · mejor marca por jugador";

    els["leaderboard"].innerHTML = scoring
      .map(function (row, index) {
        const rankClass = index < 3 ? " rank-top rank-" + (index + 1) : "";
        const avatar = renderAvatarContent(row.player);
        const details = isOverall
          ? row.monthsPlayed + (row.monthsPlayed === 1 ? " mes" : " meses") + " · " + row.completed + " pistas"
          : row.completed + "/" + trackRows.length + " pistas";
        const pendingLabel = row.pending
          ? " · " + row.pending + (row.pending === 1 ? " pendiente" : " pendientes")
          : "";
        return (
          '<div class="leaderboard-row' + rankClass + '"><span class="leaderboard-rank">' +
          String(index + 1).padStart(2, "0") +
          '</span><span class="player-avatar" style="--player-color:' +
          escapeHtml(row.player.color || "#d7ff4f") +
          '">' +
          avatar +
          '</span><div class="player-info"><strong>' +
          escapeHtml(row.player.displayName) +
          '</strong><span>' +
          details +
          (row.completed === trackRows.length && !isOverall ? " · completo" : "") +
          pendingLabel +
          '</span></div><span class="player-races">' +
          row.wins +
          " vict." +
          '</span><strong class="player-points">' +
          row.totalPoints +
          '<small> pts</small></strong></div>'
        );
      })
      .join("");
    bindBrokenImages(els["leaderboard"]);
  }

  function renderHistory(data, selectedSeason) {
    const sortedSeasons = data.seasons.slice().sort(function (a, b) {
      return b.id.localeCompare(a.id);
    });

    els["history-list"].innerHTML = sortedSeasons
      .slice(0, 6)
      .map(function (season) {
        const tracks = getSeasonTracks(data, season.id);
        const scores = calculateScores(data, season, tracks);
        const winner = scores[0];
        const isSelected = season.id === selectedSeason.id;
        const retiredCount = tracks.filter(function (row) {
          const track = getTrack(data, row.trackId);
          return track && !track.active;
        }).length;
        return (
          '<button class="history-row' +
          (isSelected ? " is-selected" : "") +
          '" type="button" data-season-id="' +
          escapeHtml(season.id) +
          '"><span class="history-month">' +
          escapeHtml(formatSeasonLabel(season)) +
          '</span><span class="history-winner">' +
          (winner ? "Ganador · " + escapeHtml(winner.player.displayName) : "Sin tiempos") +
          '</span><span class="history-score">' +
          (winner ? winner.totalPoints + " pts" : "—") +
          '</span><span class="history-arrow">↗</span>' +
          (retiredCount ? '<span class="history-retired">' + retiredCount + " retirada" + (retiredCount > 1 ? "s" : "") + "</span>" : "") +
          '</button>'
        );
      })
      .join("");

    els["history-list"].querySelectorAll("[data-season-id]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.selectedSeasonId = button.dataset.seasonId;
        render();
        window.scrollTo({ top: document.getElementById("pistas").offsetTop - 24, behavior: "smooth" });
      });
    });
  }

  function renderSubmitLink() {
    if (config.submitUrl) {
      els["submit-button"].href = config.submitUrl;
      els["submit-button"].target = "_blank";
      els["submit-button"].rel = "noreferrer";
      els["submit-button"].classList.remove("is-disabled");
    } else {
      els["submit-button"].href = "#enviar";
      els["submit-button"].classList.add("is-disabled");
      els["submit-button"].onclick = function (event) {
        event.preventDefault();
        showToast("Configura la URL del formulario en config.js.");
      };
    }
  }

  function calculateScores(data, season, trackRows) {
    const bestTimes = getBestTimes(data, season.id);
    const activePlayers = data.players.filter(function (player) {
      return player.active !== false || data.times.some(function (time) {
        return time.seasonId === season.id && time.playerId === player.id;
      });
    });

    return activePlayers
      .map(function (player) {
        let totalPoints = 0;
        let wins = 0;
        let completed = 0;
        let totalTime = 0;
        let pending = 0;

        trackRows.forEach(function (row) {
          const entries = getTrackEntries(data, season.id, row.trackId, bestTimes);
          const entryIndex = entries.findIndex(function (entry) {
            return entry.player.id === player.id;
          });
          if (entryIndex === -1) return;

          const entry = entries[entryIndex];
          const rank = entries.findIndex(function (candidate) {
            return candidate.timeMs === entry.timeMs;
          }) + 1;
          const basePoints = pointsByPosition[rank - 1] || 1;
          totalPoints += basePoints * (row.isStar ? 2 : 1);
          completed += 1;
          totalTime += entry.timeMs;
          if (isPending(entry.verified)) pending += 1;
          if (rank === 1) wins += 1;
        });

        if (completed === trackRows.length && trackRows.length > 0) totalPoints += 2;
        return { player: player, totalPoints: totalPoints, wins: wins, completed: completed, totalTime: totalTime, pending: pending };
      })
      .sort(function (a, b) {
        return b.totalPoints - a.totalPoints || b.wins - a.wins || a.totalTime - b.totalTime || a.player.displayName.localeCompare(b.player.displayName);
      });
  }

  function calculateOverallScores(data) {
    const aggregates = new Map();
    data.players.forEach(function (player) {
      aggregates.set(player.id, {
        player: player,
        totalPoints: 0,
        wins: 0,
        completed: 0,
        pending: 0,
        monthsPlayed: 0,
        monthsWon: 0
      });
    });

    data.seasons.forEach(function (season) {
      const monthlyScores = calculateScores(data, season, getSeasonTracks(data, season.id));
      const monthWinnerPoints = monthlyScores.reduce(function (highest, row) {
        return Math.max(highest, row.totalPoints);
      }, 0);

      monthlyScores.forEach(function (row) {
        const aggregate = aggregates.get(row.player.id);
        if (!aggregate) return;
        aggregate.totalPoints += row.totalPoints;
        aggregate.wins += row.wins;
        aggregate.completed += row.completed;
        aggregate.pending += row.pending;
        if (row.completed > 0) aggregate.monthsPlayed += 1;
        if (row.totalPoints > 0 && row.totalPoints === monthWinnerPoints) aggregate.monthsWon += 1;
      });
    });

    return Array.from(aggregates.values())
      .filter(function (row) {
        return row.player.active !== false || row.completed > 0;
      })
      .sort(function (a, b) {
        return b.totalPoints - a.totalPoints || b.monthsWon - a.monthsWon || b.wins - a.wins || a.player.displayName.localeCompare(b.player.displayName);
      });
  }

  function getBestTimes(data, seasonId) {
    const best = new Map();
    (data.times || []).forEach(function (time) {
      if (time.seasonId !== seasonId || isRejected(time.verified) || !Number.isFinite(Number(time.timeMs))) return;
      const key = time.trackId + "::" + time.playerId;
      const current = best.get(key);
      if (!current || Number(time.timeMs) < Number(current.timeMs)) best.set(key, time);
    });
    return best;
  }

  function getTrackEntries(data, seasonId, trackId, bestTimes) {
    return data.players
      .map(function (player) {
        const time = bestTimes.get(trackId + "::" + player.id);
        return time ? { player: player, timeMs: Number(time.timeMs), proofUrl: time.proofUrl, verified: time.verified } : null;
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return a.timeMs - b.timeMs || a.player.displayName.localeCompare(b.player.displayName);
      });
  }

  function isPending(status) {
    return String(status || "PENDING").toUpperCase() === "PENDING";
  }

  function isRejected(status) {
    return String(status || "").toUpperCase() === "REJECTED";
  }

  function getSeasonTracks(data, seasonId) {
    return data.seasonTracks
      .filter(function (row) {
        return row.seasonId === seasonId;
      })
      .sort(function (a, b) {
        return Number(a.slot) - Number(b.slot);
      });
  }

  function getTrack(data, trackId) {
    return data.tracks.find(function (track) {
      return track.id === trackId;
    });
  }

  function getSeason(data, seasonId) {
    return data.seasons.find(function (season) {
      return season.id === seasonId;
    });
  }

  function getCurrentSeasonId(data) {
    if (data.meta && data.meta.currentSeasonId && getSeason(data, data.meta.currentSeasonId)) return data.meta.currentSeasonId;
    const latestSeason = data.seasons.slice().sort(function (a, b) { return b.id.localeCompare(a.id); })[0];
    return latestSeason ? latestSeason.id : null;
  }

  function formatSeasonLabel(season) {
    const [year, month] = season.id.split("-");
    return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: config.timezone || "Europe/Madrid" }).format(new Date(Number(year), Number(month) - 1, 1));
  }

  function formatTime(milliseconds) {
    const total = Math.max(0, Number(milliseconds));
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const millis = Math.floor(total % 1000);
    return minutes + ":" + String(seconds).padStart(2, "0") + "." + String(millis).padStart(3, "0");
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: config.timezone || "Europe/Madrid" }).format(date);
  }

  function renderError(message) {
    const text = message || "Los datos todavía no están disponibles.";
    els["season-label"].textContent = "Sin temporada activa";
    els["track-grid"].innerHTML = '<p class="empty-state empty-state-large">' + escapeHtml(text) + "</p>";
    els["leaderboard"].innerHTML = '<p class="empty-state">Conecta el Apps Script para cargar la clasificación.</p>';
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(function () {
      els.toast.classList.remove("is-visible");
    }, 3500);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
