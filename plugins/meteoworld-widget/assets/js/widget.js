/**
 * MeteoWorld Widget — JS Principal v1.1
 * Corrections : slides 2+, musique, scroll horaire, F11, hauteur
 */
(function () {
  'use strict';

  const CFG  = window.MWW || {};
  const REST = CFG.rest   || '/wp-json/mww/v1';
  const OPTS = CFG.options || {};

  /* ── Bibliothèque sonore (pistes libres de droit, hébergées CDN) ──
     Override possible : ajoutez vos MP3 dans /wp-content/uploads/mww-sounds/
     et configurez via window.MWW_CUSTOM_SOUNDS dans un script enfant.   */
  const DEFAULT_SOUNDS = {
    weather: {
      sunny:    null,
      rainy:    'https://cdn.pixabay.com/audio/2022/03/10/audio_a9e1c9eaae.mp3',
      stormy:   'https://cdn.pixabay.com/audio/2021/10/11/audio_31d2da9b87.mp3',
      snowy:    'https://cdn.pixabay.com/audio/2022/03/15/audio_bbf6e1c4ec.mp3',
      foggy:    null,
      drizzle:  'https://cdn.pixabay.com/audio/2022/03/10/audio_a9e1c9eaae.mp3',
      cloudy:   null,
      'partly-cloudy': null,
      showery:  'https://cdn.pixabay.com/audio/2022/03/10/audio_a9e1c9eaae.mp3',
    },
    region: {
      'lounge':         'https://cdn.pixabay.com/audio/2023/03/06/audio_426c5c7a0b.mp3',
      'jazz':            'https://cdn.pixabay.com/audio/2022/05/27/audio_1808fbf07a.mp3',
      'ambient-asia':    'https://cdn.pixabay.com/audio/2022/08/02/audio_884fe92c21.mp3',
      'arabic-lounge':   'https://cdn.pixabay.com/audio/2021/11/25/audio_00fa5b3a89.mp3',
      'afrobeat-chill':  'https://cdn.pixabay.com/audio/2022/10/25/audio_8baf01d24a.mp3',
      'chill-wave':      'https://cdn.pixabay.com/audio/2023/03/06/audio_426c5c7a0b.mp3',
    }
  };
  // Fusion avec d'éventuelles pistes custom définies par l'admin
  const SOUND_MAP = window.MWW_CUSTOM_SOUNDS
    ? {
        weather: { ...DEFAULT_SOUNDS.weather, ...(window.MWW_CUSTOM_SOUNDS.weather || {}) },
        region:  { ...DEFAULT_SOUNDS.region,  ...(window.MWW_CUSTOM_SOUNDS.region  || {}) },
      }
    : DEFAULT_SOUNDS;

  const MUSIC_LABELS = {
    'lounge':'🎹 Lounge', 'jazz':'🎷 Jazz', 'ambient-asia':'🎐 Ambient Asia',
    'arabic-lounge':'🪕 Oriental', 'afrobeat-chill':'🥁 Afrobeat', 'chill-wave':'🌊 Chill Wave',
  };

  const $  = (s, ctx = document) => ctx.querySelector(s);
  const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];
  const xhr = (url) => fetch(url, { headers: { 'X-WP-Nonce': CFG.nonce || '' } })
    .then(r => r.ok ? r.json() : Promise.reject(r));

  function localTime(tz) {
    try {
      return new Intl.DateTimeFormat('fr-FR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: tz, hour12: false
      }).format(new Date());
    } catch { return '--:--:--'; }
  }

  /* ══════════════════════════════════════════════════════════
     CLASSE PRINCIPALE
     ══════════════════════════════════════════════════════════ */
  class MWWSlider {
    constructor(el) {
      this.el           = el;
      this.config       = JSON.parse(el.dataset.mww || '{}');
      this.cities       = [];
      this.data         = {};
      this.aiData       = {};
      this.current      = 0;
      this.total        = 0;
      this.autoTimer    = null;
      this.audio        = null;
      this.muted        = false;
      this.musicOn      = true;
      this.volume       = (OPTS.sound_volume || 40) / 100;
      this.touchStartX  = 0;
      this.clocks       = {};
      this.loading      = {};   // évite double-fetch concurrent
      this.init();
    }

    async init() {
      try {
        const all = await xhr(`${REST}/cities`);
        const filter = this.config.cities && this.config.cities.length ? this.config.cities : null;
        this.cities = filter ? all.filter(c => filter.includes(c.index)) : all;
        this.total  = this.cities.length;
        if (!this.total) { this.el.innerHTML = '<p style="padding:20px;color:#e55">Aucune ville configurée.</p>'; return; }

        this.buildSkeleton();
        this.bindEvents();

        await this.loadSlide(0);
        this.setActive(0);
        this.startAutoplay();

        // Précharge le reste en tâche de fond, séquentiellement
        // (évite de saturer l'API météo en rafale)
        this._preloadRest();
      } catch (e) {
        console.error('[MeteoWorld]', e);
        this.el.innerHTML = '<p style="padding:20px;color:#e55">Erreur de chargement météo.</p>';
      }
    }

    async _preloadRest() {
      for (let i = 1; i < this.total; i++) {
        await this.loadSlide(i);
        await new Promise(r => setTimeout(r, 250)); // throttle léger
      }
    }

    /* ── Squelette HTML ────────────────────────────────────── */
    buildSkeleton() {
      const trans = this.config.transition || OPTS.transition || 'slide';
      const theme = this.config.theme || OPTS.theme || 'cinematic';
      this.el.className = `mww-widget mww-theme-${theme} mww-transition-${trans}`;

      const slidesHtml = this.cities.map((c, i) => `
        <div class="mww-slide" data-index="${i}" id="mww-slide-${i}">
          <div class="mww-city-image" data-wclass="sunny">
            <div class="mww-img-skeleton"></div>
            <div class="mww-city-overlay">
              <div>
                <div class="mww-city-name">${c.name}</div>
                <div class="mww-city-country">${c.country}</div>
              </div>
              <div class="mww-temp-hero" id="mww-temp-${i}">--<sup>°</sup></div>
            </div>
          </div>
          <div class="mww-content" id="mww-content-${i}">
            <div class="mww-meta-row">
              <div class="mww-weather-badge" id="mww-badge-${i}">
                <span class="mww-weather-icon">🌡️</span>
                <span id="mww-label-${i}">Chargement…</span>
              </div>
              <div class="mww-local-time" id="mww-time-${i}">🕐 <span>--:--</span></div>
            </div>
            <div class="mww-stats-grid" id="mww-stats-${i}"></div>
            ${OPTS.show_hourly !== false ? `
            <div class="mww-hourly-wrap">
              <div class="mww-hourly" id="mww-hourly-scroll-${i}">
                <div class="mww-hourly-inner" id="mww-hourly-${i}"></div>
              </div>
            </div>` : ''}
            ${OPTS.show_daily !== false ? `<div class="mww-daily-wrap"><div class="mww-daily" id="mww-daily-${i}"></div></div>` : ''}
            <div class="mww-sun-row" id="mww-sun-${i}"></div>
            ${OPTS.show_aitext !== false ? `<div class="mww-ai-text" id="mww-ai-${i}"><span class="mww-ai-badge">✦ IA</span><span class="mww-ai-content">Chargement description…</span></div>` : ''}
          </div>
        </div>
      `).join('');

      const musicOptions = Object.keys(MUSIC_LABELS).map(k =>
        `<option value="${k}">${MUSIC_LABELS[k]}</option>`
      ).join('');

      this.el.innerHTML = `
        <div class="mww-slides">${slidesHtml}</div>
        <div class="mww-controls">
          <button class="mww-nav-btn mww-prev" aria-label="Ville précédente">‹</button>
          <div class="mww-progress-bar"><div class="mww-progress-fill"></div></div>
          <div class="mww-dots">${this.cities.map((_,i) => `<button class="mww-dot${i===0?' active':''}" data-i="${i}" aria-label="Ville ${i+1}"></button>`).join('')}</div>
          <button class="mww-nav-btn mww-next" aria-label="Ville suivante">›</button>
        </div>
        <div class="mww-toolbar">
          <div class="mww-toolbar-left">
            <button class="mww-tool-btn mww-sound-btn" title="Couper/activer le son">
              <span class="mww-btn-icon">🔊</span>
            </button>
            <select class="mww-music-select" title="Choisir une ambiance musicale">
              <option value="auto">🎵 Auto (région)</option>
              ${musicOptions}
            </select>
            <input type="range" class="mww-volume" min="0" max="100" value="${OPTS.sound_volume || 40}" aria-label="Volume" title="Volume">
          </div>
          <div class="mww-toolbar-right">
            <button class="mww-tool-btn mww-pause-btn" title="Pause/Lecture"><span class="mww-btn-icon">⏸</span></button>
            ${this.config.fullscreen !== false ? `<button class="mww-tool-btn mww-fs-btn" title="Plein écran (F)"><span class="mww-btn-icon">⛶</span></button>` : ''}
          </div>
        </div>
        <button class="mww-fs-close" aria-label="Quitter le plein écran">✕</button>
      `;
    }

    /* ── Chargement données d'une ville (idempotent) ────────── */
    async loadSlide(i) {
      if (this.data[i] || this.loading[i]) return;
      const city = this.cities[i];
      if (!city) return;
      this.loading[i] = true;
      try {
        const [wx, ai] = await Promise.all([
          xhr(`${REST}/weather/${city.index}`),
          xhr(`${REST}/ai/${city.index}`).catch(() => null),
        ]);
        this.data[i] = wx;
        if (ai) this.aiData[i] = ai;
        this.renderSlide(i, wx, ai);
      } catch (e) {
        console.warn('[MeteoWorld] échec slide', i, e);
        const badge = $(`#mww-label-${i}`, this.el);
        if (badge) badge.textContent = 'Indisponible';
      } finally {
        this.loading[i] = false;
      }
    }

    /* ── Rendu météo complet pour le slide i ─────────────────── */
    renderSlide(i, wx, ai) {
      const cur = wx.current;
      const slideEl = $(`#mww-slide-${i}`, this.el);
      if (!slideEl) return;
      const img_el = $('.mww-city-image', slideEl);

      if (ai?.image_url) {
        const img = new Image();
        let settled = false;
        const fallbackTimer = setTimeout(() => {
          if (!settled) { settled = true; this._setImage(img_el, ai.image_fallback || null, wx); }
        }, 8000); // Pollinations peut être lent à générer — on bascule après 8s
        img.onload  = () => { if (!settled) { settled = true; clearTimeout(fallbackTimer); this._setImage(img_el, img.src, wx); } };
        img.onerror = () => { if (!settled) { settled = true; clearTimeout(fallbackTimer); this._setImage(img_el, ai.image_fallback || null, wx); } };
        img.src = ai.image_url;
      } else {
        this._setImage(img_el, null, wx);
      }
      img_el.dataset.wclass = cur.class;

      const tmpEl = $(`#mww-temp-${i}`, this.el);
      if (tmpEl) tmpEl.innerHTML = `${cur.temp}<sup>°</sup>`;

      const badge = $(`#mww-badge-${i}`, this.el);
      if (badge) badge.innerHTML = `<span class="mww-weather-icon">${cur.icon}</span><span>${cur.label}</span>`;

      this._startClock(i, wx.city.tz);

      const stats = [
        { icon:'💧', val:`${cur.humidity}%`,    label:'Humidité' },
        { icon:'💨', val:`${cur.wind} km/h`,    label:`Vent ${cur.wind_dir}` },
        { icon:'📊', val:`${cur.pressure} hPa`, label:'Pression' },
        { icon:'🌡️', val:`${cur.feels_like}°`,  label:'Ressenti' },
        { icon:'👁️', val:`${cur.visibility} km`,label:'Visibilité' },
        { icon:'☀️', val:`UV ${cur.uv}`,        label:'Indice UV' },
      ];
      const statsEl = $(`#mww-stats-${i}`, this.el);
      if (statsEl) statsEl.innerHTML = stats.map(s => `
        <div class="mww-stat"><span class="mww-stat-icon">${s.icon}</span><span class="mww-stat-val">${s.val}</span><span class="mww-stat-label">${s.label}</span></div>
      `).join('');

      const hrEl = $(`#mww-hourly-${i}`, this.el);
      if (hrEl && wx.hourly) {
        const now = new Date().getHours();
        hrEl.innerHTML = wx.hourly.slice(0, 12).map(h => {
          const hh = parseInt(h.time.split(':')[0]);
          const isNow = hh === now;
          return `<div class="mww-hour-item${isNow?' now':''}">
            <span class="mww-hour-time">${isNow ? 'Maint.' : h.time}</span>
            <span class="mww-hour-icon">${h.icon}</span>
            <span class="mww-hour-temp">${h.temp}°</span>
            ${h.precip > 10 ? `<span class="mww-hour-precip">💧${h.precip}%</span>` : '<span class="mww-hour-precip">&nbsp;</span>'}
          </div>`;
        }).join('');
      }

      const dayEl = $(`#mww-daily-${i}`, this.el);
      if (dayEl && wx.daily) {
        dayEl.innerHTML = wx.daily.slice(0, 5).map(d => `
          <div class="mww-day-row">
            <span class="mww-day-name">${d.day}</span>
            <span class="mww-day-icon">${d.icon}</span>
            <span class="mww-day-label">${d.label}</span>
            <span class="mww-day-max">${d.max}°</span>
            <span class="mww-day-min">${d.min}°</span>
          </div>`).join('');
      }

      const today = wx.daily && wx.daily[0];
      const sunEl = $(`#mww-sun-${i}`, this.el);
      if (sunEl && today) {
        sunEl.innerHTML = `
          <div class="mww-sun-item"><span>🌅</span><span><strong>${today.sunrise}</strong></span></div>
          <div class="mww-sun-item"><span>🌇</span><span><strong>${today.sunset}</strong></span></div>
          ${today.precip > 0 ? `<div class="mww-sun-item"><span>🌧️</span><span><strong>${today.precip}mm</strong></span></div>` : ''}
        `;
      }

      if (ai) this.renderAI(i, ai);
    }

    renderAI(i, ai) {
      const aiEl = $(`#mww-ai-${i} .mww-ai-content`, this.el);
      if (aiEl && ai?.text) aiEl.textContent = ai.text;
    }

    _setImage(img_el, src, wx) {
      const overlay = `
        <div class="mww-city-overlay">
          <div>
            <div class="mww-city-name">${wx.city.name}</div>
            <div class="mww-city-country">${wx.city.country}</div>
          </div>
          <div class="mww-temp-hero">${wx.current.temp}<sup>°</sup></div>
        </div>`;
      img_el.innerHTML = src
        ? `<img src="${src}" alt="${wx.city.name}" loading="lazy">${overlay}`
        : `<div class="mww-img-skeleton"></div>${overlay}`;
    }

    _startClock(i, tz) {
      if (this.clocks[i]) clearInterval(this.clocks[i]);
      const update = () => {
        const el = $(`#mww-time-${i} span`, this.el);
        if (el) el.textContent = localTime(tz);
      };
      update();
      this.clocks[i] = setInterval(update, 1000);
    }

    /* ── Navigation ────────────────────────────────────────── */
    setActive(idx) {
      const prev = this.current;
      this.current = ((idx % this.total) + this.total) % this.total;

      $$('.mww-slide', this.el).forEach((s, i) => {
        s.classList.remove('active', 'exit-left', 'exit-right');
        if (i === prev && i !== this.current) {
          s.classList.add(idx > prev ? 'exit-left' : 'exit-right');
          setTimeout(() => s.classList.remove('exit-left','exit-right'), 700);
        }
        if (i === this.current) s.classList.add('active');
      });

      $$('.mww-dot', this.el).forEach((d, i) => d.classList.toggle('active', i === this.current));

      if (!this.data[this.current]) this.loadSlide(this.current);
      if (OPTS.show_sound !== false) this.playSound(this.current);
    }

    next() { this.setActive(this.current + 1); this.resetProgress(); }
    prev() { this.setActive(this.current - 1); this.resetProgress(); }

    /* ── Autoplay ──────────────────────────────────────────── */
    startAutoplay() {
      if (this.config.autoplay === false || OPTS.autoplay === false) return;
      const speed = OPTS.autoplay_speed || 7000;
      this.startProgress(speed);
      this.autoTimer = setInterval(() => this.next(), speed);
    }
    stopAutoplay() { clearInterval(this.autoTimer); this.autoTimer = null; this.stopProgress(); }

    toggleAutoplay() {
      const btn = $('.mww-pause-btn .mww-btn-icon', this.el);
      if (this.autoTimer) {
        this.stopAutoplay();
        if (btn) btn.textContent = '▶';
      } else {
        this.startAutoplay();
        if (btn) btn.textContent = '⏸';
      }
    }

    startProgress(duration) {
      const fill = $('.mww-progress-fill', this.el);
      if (!fill) return;
      fill.style.transition = 'none';
      fill.style.width = '0%';
      requestAnimationFrame(() => {
        fill.style.transition = `width ${duration}ms linear`;
        fill.style.width = '100%';
      });
    }
    stopProgress() {
      const fill = $('.mww-progress-fill', this.el);
      if (fill) { fill.style.transition = 'none'; fill.style.width = '0%'; }
    }
    resetProgress() {
      this.stopProgress();
      if (this.autoTimer) this.startProgress(OPTS.autoplay_speed || 7000);
    }

    /* ── Son / Musique ─────────────────────────────────────── */
    playSound(i) {
      if (this.muted || !this.musicOn) return;
      const city = this.cities[i];
      const wx   = this.data[i];
      let url    = null;

      if (this.forcedMusic && this.forcedMusic !== 'auto') {
        url = SOUND_MAP.region[this.forcedMusic] || null;
      } else {
        if (wx) url = SOUND_MAP.weather[wx.current?.class] || null;
        if (!url && city) url = SOUND_MAP.region[city.music] || null;
      }

      if (!url) { this._stopAudio(); return; }
      if (this.audio && this.audio.dataset?.src === url && !this.audio.paused) return;

      this._stopAudio();
      this.audio = new Audio(url);
      this.audio.dataset.src = url;
      this.audio.loop   = true;
      this.audio.volume = this.volume;
      this.audio.play().catch(() => {
        // L'autoplay est bloqué tant qu'aucune interaction utilisateur n'a eu lieu —
        // normal côté navigateur, le son démarrera au premier clic.
      });
    }

    _stopAudio() {
      if (this.audio) { this.audio.pause(); this.audio.src=''; this.audio = null; }
    }

    toggleMute() {
      this.muted = !this.muted;
      const btn = $('.mww-sound-btn .mww-btn-icon', this.el);
      if (this.muted) {
        this._stopAudio();
        if (btn) btn.textContent = '🔇';
        $('.mww-sound-btn', this.el)?.classList.add('active');
      } else {
        if (btn) btn.textContent = '🔊';
        $('.mww-sound-btn', this.el)?.classList.remove('active');
        this.playSound(this.current);
      }
    }

    setMusic(key) {
      this.forcedMusic = key;
      if (!this.muted) this.playSound(this.current);
    }

    /* ── Plein écran ───────────────────────────────────────── */
    toggleFullscreen() {
      const isFs = this.el.classList.toggle('mww-fullscreen');
      document.body.style.overflow = isFs ? 'hidden' : '';

      if (isFs) {
        const req = this.el.requestFullscreen || this.el.webkitRequestFullscreen || this.el.msRequestFullscreen;
        req?.call(this.el).catch(() => {});
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        if (document.fullscreenElement) exit?.call(document).catch(() => {});
      }
    }

    exitFullscreen() {
      this.el.classList.remove('mww-fullscreen');
      document.body.style.overflow = '';
      if (document.fullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen)?.call(document).catch(()=>{});
      }
    }

    /* ── Événements ────────────────────────────────────────── */
    bindEvents() {
      this.el.addEventListener('click', e => {
        if (e.target.closest('.mww-prev'))      this.prev();
        if (e.target.closest('.mww-next'))      this.next();
        if (e.target.closest('.mww-dot'))       { this.setActive(+e.target.closest('.mww-dot').dataset.i); this.resetProgress(); }
        if (e.target.closest('.mww-sound-btn')) this.toggleMute();
        if (e.target.closest('.mww-pause-btn')) this.toggleAutoplay();
        if (e.target.closest('.mww-fs-btn'))    this.toggleFullscreen();
        if (e.target.closest('.mww-fs-close'))  this.exitFullscreen();
      });

      this.el.addEventListener('input', e => {
        if (e.target.classList.contains('mww-volume')) {
          this.volume = e.target.value / 100;
          if (this.audio) this.audio.volume = this.volume;
        }
      });

      this.el.addEventListener('change', e => {
        if (e.target.classList.contains('mww-music-select')) {
          this.setMusic(e.target.value);
        }
      });

      this.el.addEventListener('mouseenter', () => {
        if (this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null; this.stopProgress(); }
      });
      this.el.addEventListener('mouseleave', () => {
        const paused = $('.mww-pause-btn .mww-btn-icon', this.el)?.textContent.includes('▶');
        if (OPTS.autoplay !== false && !paused) this.startAutoplay();
      });

      this.el.addEventListener('touchstart', e => { this.touchStartX = e.touches[0].clientX; }, {passive:true});
      this.el.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - this.touchStartX;
        if (Math.abs(dx) > 50) { dx < 0 ? this.next() : this.prev(); this.resetProgress(); }
      });

      // Scroll wheel horizontal sur la zone horaire (desktop)
      this.el.addEventListener('wheel', e => {
        const scrollZone = e.target.closest('.mww-hourly');
        if (scrollZone && e.deltaY !== 0) {
          scrollZone.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      }, { passive: false });

      document.addEventListener('keydown', e => {
        if (!this.el.classList.contains('mww-fullscreen')) return;
        if (e.key === 'ArrowRight') { this.next(); this.resetProgress(); }
        if (e.key === 'ArrowLeft')  { this.prev(); this.resetProgress(); }
        if (e.key === 'Escape')     { this.exitFullscreen(); }
        if (e.key === 'f' || e.key === 'F') { this.toggleFullscreen(); }
        if (e.key === ' ') { e.preventDefault(); this.toggleAutoplay(); }
        if (e.key === 'm' || e.key === 'M') { this.toggleMute(); }
      });

      document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && this.el.classList.contains('mww-fullscreen')) {
          this.el.classList.remove('mww-fullscreen');
          document.body.style.overflow = '';
        }
      });

      // Détecte le mode F11 natif du navigateur (le viewport change sans passer par notre bouton)
      window.addEventListener('resize', () => {
        const nativeFs = window.innerHeight === screen.height && window.innerWidth === screen.width;
        if (nativeFs && !this.el.classList.contains('mww-fullscreen')) {
          // L'utilisateur a appuyé sur F11 natif : on adapte juste le layout, pas de classe forcée
          this.el.classList.add('mww-native-fs-aware');
        } else {
          this.el.classList.remove('mww-native-fs-aware');
        }
      });
    }
  }

  function initAll() {
    document.querySelectorAll('.mww-widget').forEach(el => {
      if (!el.dataset.mwwInit) {
        el.dataset.mwwInit = '1';
        new MWWSlider(el);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  window.addEventListener('elementor/frontend/init', () => {
    window.elementorFrontend?.hooks?.addAction('frontend/element_ready/mww_slider.default', () => initAll());
  });

  window.MWWInit = initAll;
})();
