(function () {
  "use strict";

  const config = window.MKW_CONFIG || {};
  const state = {
    data: null,
    selectedSeasonId: null,
    countdownTimer: null
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
        const badges = [
          row.cc === 200 ? '<span class="pill pill-hot">200cc</span>' : '<span class="pill">150cc</span>',
          track.isWiiOriginal ? '<span class="pill pill-wii">Wii original</span>' : "",
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
                  "</strong></div>"
                );
              })
              .join("")
          : '<p class="empty-state">Aún no hay tiempos. Sé el primero.</p>';

        return (
          '<article class="track-card' + (row.isStar ? " is-star" : "") + '">' +
          '<div class="track-card-number">0' + (index + 1) + '</div>' +
          '<div class="track-card-content"><div class="track-card-top"><div class="track-badges">' +
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
  }

  function renderLeaderboard(data, season) {
    const trackRows = getSeasonTracks(data, season.id);
    const scoring = calculateScores(data, season, trackRows);
    els["leaderboard-caption"].textContent = trackRows.length + " pistas · mejor marca por jugador";

    els["leaderboard"].innerHTML = scoring
      .map(function (row, index) {
        const rankClass = index < 3 ? " rank-top rank-" + (index + 1) : "";
        const avatar = row.player.displayName.slice(0, 1).toUpperCase();
        const details = row.completed + "/" + trackRows.length + " pistas";
        return (
          '<div class="leaderboard-row' + rankClass + '"><span class="leaderboard-rank">' +
          String(index + 1).padStart(2, "0") +
          '</span><span class="player-avatar" style="--player-color:' +
          escapeHtml(row.player.color || "#d7ff4f") +
          '">' +
          escapeHtml(avatar) +
          '</span><div class="player-info"><strong>' +
          escapeHtml(row.player.displayName) +
          '</strong><span>' +
          details +
          (row.completed === trackRows.length ? " · completo" : "") +
          '</span></div><span class="player-races">' +
          row.wins +
          " vict." +
          '</span><strong class="player-points">' +
          row.totalPoints +
          '<small> pts</small></strong></div>'
        );
      })
      .join("");
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
          if (rank === 1) wins += 1;
        });

        if (completed === trackRows.length && trackRows.length > 0) totalPoints += 2;
        return { player: player, totalPoints: totalPoints, wins: wins, completed: completed, totalTime: totalTime };
      })
      .sort(function (a, b) {
        return b.totalPoints - a.totalPoints || b.wins - a.wins || a.totalTime - b.totalTime || a.player.displayName.localeCompare(b.player.displayName);
      });
  }

  function getBestTimes(data, seasonId) {
    const best = new Map();
    (data.times || []).forEach(function (time) {
      if (time.seasonId !== seasonId || !Number.isFinite(Number(time.timeMs))) return;
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
