(() => {
  "use strict";

  const SESSION_KEY = "gallery_unlocked";
  const config = window.SITE_CONFIG || {};

  const els = {
    gate: document.getElementById("gate"),
    gateForm: document.getElementById("gate-form"),
    passwordInput: document.getElementById("password-input"),
    passwordToggle: document.getElementById("password-toggle"),
    gateError: document.getElementById("gate-error"),
    app: document.getElementById("app"),
    status: document.getElementById("status"),
    gallery: document.getElementById("gallery"),
    tagFilters: document.getElementById("tag-filters"),
    refreshBtn: document.getElementById("refresh-btn"),
    repoLink: document.getElementById("repo-link"),
    lightbox: document.getElementById("lightbox"),
    lightboxImage: document.getElementById("lightbox-image"),
    lightboxCaption: document.getElementById("lightbox-caption"),
    lightboxTags: document.getElementById("lightbox-tags"),
    lightboxClose: document.getElementById("lightbox-close"),
    lightboxPrev: document.getElementById("lightbox-prev"),
    lightboxNext: document.getElementById("lightbox-next"),
  };

  /** @type {Photo[]} */
  let photos = [];
  /** @type {Set<string>} lowercase tag keys currently selected */
  let activeTags = new Set();
  let lightboxIndex = -1;
  let touchStartX = 0;
  let touchStartY = 0;

  /**
   * @typedef {object} Photo
   * @property {string} id
   * @property {string} name
   * @property {string} description
   * @property {string} caption
   * @property {string[]} tags
   * @property {Date} date
   * @property {string} thumbUrl
   * @property {string} fullUrl
   */

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function isUnlocked() {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  }

  function setUnlocked() {
    sessionStorage.setItem(SESSION_KEY, "1");
  }

  function showGate() {
    els.gate.hidden = false;
    els.app.hidden = true;
    els.passwordInput.focus();
  }

  function showApp() {
    els.gate.hidden = true;
    els.app.hidden = false;
  }

  function setupFooter() {
    const repo = (config.githubRepo || "").trim();
    if (!repo || repo.includes("YOUR_GITHUB")) {
      els.repoLink.hidden = true;
      return;
    }
    els.repoLink.hidden = false;
    els.repoLink.href = `https://github.com/${repo}`;
    els.repoLink.textContent = repo;
  }

  function configLooksPlaceholder() {
    const folder = config.driveFolderId || "";
    const key = config.googleApiKey || "";
    return (
      !folder ||
      folder.includes("YOUR_") ||
      !key ||
      key.includes("YOUR_")
    );
  }

  /**
   * @param {string} description
   * @returns {{ caption: string, tags: string[] }}
   */
  function parseDescription(description) {
    const raw = (description || "").trim();
    if (!raw) return { caption: "", tags: [] };

    const tagRe = /#([\p{L}\p{N}_-]+)/gu;
    const tags = [];
    const seen = new Set();
    let match;
    while ((match = tagRe.exec(raw)) !== null) {
      const tag = match[1];
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }

    const caption = raw
      .replace(/#([\p{L}\p{N}_-]+)/gu, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    return { caption, tags };
  }

  /**
   * @param {string} fileId
   * @param {number} size
   */
  function driveImageUrl(fileId, size) {
    return `https://lh3.googleusercontent.com/d/${fileId}=w${size}`;
  }

  /**
   * Parse Drive EXIF / ISO timestamps into a Date.
   * Drive often returns EXIF as "YYYY:MM:DD HH:MM:SS" which many browsers
   * (notably Safari) reject unless converted to ISO-like form.
   * @param {unknown} value
   * @returns {Date | null}
   */
  function parseTakenAt(value) {
    if (value == null || value === "") return null;
    const s = String(value).trim();

    // EXIF DateTime / DateTimeOriginal: "2024:07:15 14:30:45" or with T
    const exif = s.match(
      /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/
    );
    if (exif) {
      const iso = `${exif[1]}-${exif[2]}-${exif[3]}T${exif[4]}:${exif[5]}:${exif[6]}`;
      const parsed = new Date(iso);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    // Date-only EXIF: "2024:07:15"
    const exifDate = s.match(/^(\d{4}):(\d{2}):(\d{2})$/);
    if (exifDate) {
      const parsed = new Date(
        `${exifDate[1]}-${exifDate[2]}-${exifDate[3]}T12:00:00`
      );
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    // Already ISO / RFC 3339 (Drive createdTime, etc.)
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return parsed;

    return null;
  }

  /**
   * Prefer camera "taken at" (EXIF) over Drive upload time.
   * @param {object} file
   * @returns {Date}
   */
  function photoDate(file) {
    const taken =
      parseTakenAt(file.imageMediaMetadata && file.imageMediaMetadata.time) ||
      parseTakenAt(file.createdTime) ||
      parseTakenAt(file.modifiedTime);
    return taken || new Date();
  }

  async function fetchDrivePhotos() {
    const folderId = config.driveFolderId;
    const apiKey = config.googleApiKey;
    const q = `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`;
    // Request EXIF time explicitly — this is when the photo was taken on the phone
    const fields =
      "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,description,imageMediaMetadata(time,width,height,rotation))";

    /** @type {Photo[]} */
    const all = [];
    let pageToken = "";

    do {
      const params = new URLSearchParams({
        q,
        key: apiKey,
        pageSize: "1000",
        fields,
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?${params.toString()}`
      );
      const data = await res.json();

      if (!res.ok) {
        const message =
          (data.error && data.error.message) ||
          `Drive API error (${res.status})`;
        throw new Error(message);
      }

      for (const file of data.files || []) {
        const { caption, tags } = parseDescription(file.description || "");
        all.push({
          id: file.id,
          name: file.name || "Photo",
          description: file.description || "",
          caption,
          tags,
          date: photoDate(file),
          thumbUrl: driveImageUrl(file.id, 400),
          fullUrl: driveImageUrl(file.id, 2000),
        });
      }

      pageToken = data.nextPageToken || "";
    } while (pageToken);

    // Newest taken-at first (EXIF when available)
    all.sort((a, b) => b.date.getTime() - a.date.getTime());
    return all;
  }

  /** @returns {Photo[]} */
  function getFilteredPhotos() {
    if (!activeTags.size) return photos;
    return photos.filter((photo) =>
      photo.tags.some((tag) => activeTags.has(tag.toLowerCase()))
    );
  }

  /**
   * Unique tags across all photos, sorted A–Z (case-insensitive).
   * @returns {string[]}
   */
  function collectAllTags() {
    const byKey = new Map();
    for (const photo of photos) {
      for (const tag of photo.tags) {
        const key = tag.toLowerCase();
        if (!byKey.has(key)) byKey.set(key, tag);
      }
    }
    return [...byKey.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }

  /**
   * Drop selected tags that no longer exist after a refresh.
   */
  function pruneActiveTags() {
    const available = new Set(
      collectAllTags().map((tag) => tag.toLowerCase())
    );
    for (const key of [...activeTags]) {
      if (!available.has(key)) activeTags.delete(key);
    }
  }

  function renderTagFilters() {
    const tags = collectAllTags();
    els.tagFilters.replaceChildren();

    if (!tags.length) {
      els.tagFilters.hidden = true;
      return;
    }

    els.tagFilters.hidden = false;

    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "filter-chip";
    allBtn.textContent = "All";
    allBtn.setAttribute("aria-pressed", activeTags.size === 0 ? "true" : "false");
    if (activeTags.size === 0) allBtn.classList.add("is-active");
    allBtn.addEventListener("click", () => {
      activeTags.clear();
      applyFilter();
    });
    els.tagFilters.appendChild(allBtn);

    for (const tag of tags) {
      const key = tag.toLowerCase();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip";
      btn.textContent = `#${tag}`;
      const isActive = activeTags.has(key);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      if (isActive) btn.classList.add("is-active");
      btn.addEventListener("click", () => toggleTag(key));
      els.tagFilters.appendChild(btn);
    }
  }

  function toggleTag(key) {
    if (activeTags.has(key)) activeTags.delete(key);
    else activeTags.add(key);
    applyFilter();
  }

  function applyFilter() {
    if (!els.lightbox.hidden) closeLightbox();
    renderTagFilters();
    renderGallery();
  }

  /**
   * @param {Photo[]} list
   */
  function groupByMonth(list) {
    const groups = new Map();
    const formatter = new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
    });

    for (const photo of list) {
      const key = `${photo.date.getFullYear()}-${String(
        photo.date.getMonth() + 1
      ).padStart(2, "0")}`;
      const label = formatter.format(photo.date);
      if (!groups.has(key)) {
        groups.set(key, { label, photos: [] });
      }
      groups.get(key).photos.push(photo);
    }

    return groups;
  }

  function setStatus(message, isError = false) {
    if (!message) {
      els.status.hidden = true;
      els.status.textContent = "";
      els.status.classList.remove("status--error");
      return;
    }
    els.status.hidden = false;
    els.status.textContent = message;
    els.status.classList.toggle("status--error", isError);
  }

  function renderGallery() {
    els.gallery.replaceChildren();

    if (!photos.length) {
      setStatus("No photos found in this Drive folder yet.");
      return;
    }

    const visible = getFilteredPhotos();

    if (!visible.length) {
      setStatus("No photos match the selected tags.");
      return;
    }

    setStatus("");
    const groups = groupByMonth(visible);
    let delayIndex = 0;

    for (const [, group] of groups) {
      const section = document.createElement("section");
      section.className = "month";
      section.style.animationDelay = `${Math.min(delayIndex * 0.04, 0.4)}s`;

      const heading = document.createElement("h2");
      heading.className = "month__heading";
      heading.textContent = group.label;

      const grid = document.createElement("div");
      grid.className = "month__grid";

      for (const photo of group.photos) {
        const filteredIndex = visible.indexOf(photo);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "thumb";
        btn.setAttribute("aria-label", photo.name);

        const img = document.createElement("img");
        img.src = photo.thumbUrl;
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.addEventListener("load", () => img.classList.add("is-loaded"), {
          once: true,
        });
        img.addEventListener(
          "error",
          () => {
            img.classList.add("is-loaded");
            img.style.opacity = "0.35";
          },
          { once: true }
        );

        btn.addEventListener("click", () => openLightbox(filteredIndex));
        btn.appendChild(img);
        grid.appendChild(btn);
      }

      section.append(heading, grid);
      els.gallery.appendChild(section);
      delayIndex += 1;
    }
  }

  async function loadGallery({ spinning = false } = {}) {
    if (configLooksPlaceholder()) {
      setStatus(
        "Add your Drive folder ID and Google API key in config.js to load photos.",
        true
      );
      els.gallery.replaceChildren();
      els.tagFilters.hidden = true;
      return;
    }

    if (spinning) els.refreshBtn.classList.add("is-spinning");
    setStatus("Loading photos…");

    try {
      photos = await fetchDrivePhotos();
      pruneActiveTags();
      renderTagFilters();
      renderGallery();
    } catch (err) {
      console.error(err);
      photos = [];
      els.gallery.replaceChildren();
      els.tagFilters.hidden = true;
      setStatus(
        err instanceof Error
          ? err.message
          : "Could not load photos from Google Drive.",
        true
      );
    } finally {
      els.refreshBtn.classList.remove("is-spinning");
    }
  }

  function openLightbox(index) {
    const visible = getFilteredPhotos();
    if (index < 0 || index >= visible.length) return;
    lightboxIndex = index;
    els.lightbox.hidden = false;
    document.body.style.overflow = "hidden";
    updateLightbox();
    els.lightboxClose.focus();
  }

  function closeLightbox() {
    els.lightbox.hidden = true;
    document.body.style.overflow = "";
    lightboxIndex = -1;
  }

  function updateLightbox() {
    const visible = getFilteredPhotos();
    const photo = visible[lightboxIndex];
    if (!photo) return;

    els.lightboxImage.src = photo.fullUrl;
    els.lightboxImage.alt = photo.name;
    els.lightboxCaption.textContent = photo.caption || "";

    els.lightboxTags.replaceChildren();
    for (const tag of photo.tags) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag";
      chip.textContent = `#${tag}`;
      chip.setAttribute("aria-label", `Filter by ${tag}`);
      chip.addEventListener("click", () => {
        activeTags.clear();
        activeTags.add(tag.toLowerCase());
        applyFilter();
      });
      els.lightboxTags.appendChild(chip);
    }

    els.lightboxPrev.disabled = lightboxIndex <= 0;
    els.lightboxNext.disabled = lightboxIndex >= visible.length - 1;
  }

  function showPrev() {
    if (lightboxIndex > 0) {
      lightboxIndex -= 1;
      updateLightbox();
    }
  }

  function showNext() {
    const visible = getFilteredPhotos();
    if (lightboxIndex < visible.length - 1) {
      lightboxIndex += 1;
      updateLightbox();
    }
  }

  function setPasswordVisible(visible) {
    els.passwordInput.type = visible ? "text" : "password";
    els.passwordToggle.setAttribute("aria-pressed", visible ? "true" : "false");
    els.passwordToggle.setAttribute(
      "aria-label",
      visible ? "Hide password" : "Show password"
    );

    const showIcon = els.passwordToggle.querySelector(".gate__toggle-icon--show");
    const hideIcon = els.passwordToggle.querySelector(".gate__toggle-icon--hide");
    if (showIcon) showIcon.hidden = visible;
    if (hideIcon) hideIcon.hidden = !visible;
  }

  function togglePasswordVisibility() {
    const visible = els.passwordInput.type === "password";
    setPasswordVisible(visible);
    els.passwordInput.focus();
  }

  async function handleUnlock(event) {
    event.preventDefault();
    els.gateError.hidden = true;

    const expected = (config.passwordHash || "").trim().toLowerCase();
    if (!expected || expected.includes("your_password")) {
      els.gateError.textContent =
        "Set passwordHash in config.js (see README).";
      els.gateError.hidden = false;
      return;
    }

    const entered = els.passwordInput.value;
    const hash = await sha256Hex(entered);

    if (hash !== expected) {
      els.gateError.textContent = "Incorrect password. Try again.";
      els.gateError.hidden = false;
      els.passwordInput.select();
      return;
    }

    setUnlocked();
    els.passwordInput.value = "";
    showApp();
    await loadGallery();
  }

  function onKeydown(event) {
    if (els.lightbox.hidden) return;

    if (event.key === "Escape") {
      closeLightbox();
    } else if (event.key === "ArrowLeft") {
      showPrev();
    } else if (event.key === "ArrowRight") {
      showNext();
    }
  }

  function onTouchStart(event) {
    if (els.lightbox.hidden || !event.changedTouches.length) return;
    touchStartX = event.changedTouches[0].clientX;
    touchStartY = event.changedTouches[0].clientY;
  }

  function onTouchEnd(event) {
    if (els.lightbox.hidden || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - touchStartX;
    const dy = event.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) showPrev();
    else showNext();
  }

  function bindEvents() {
    els.gateForm.addEventListener("submit", handleUnlock);
    els.passwordToggle.addEventListener("click", togglePasswordVisibility);
    els.refreshBtn.addEventListener("click", () =>
      loadGallery({ spinning: true })
    );
    els.lightboxClose.addEventListener("click", closeLightbox);
    els.lightboxPrev.addEventListener("click", showPrev);
    els.lightboxNext.addEventListener("click", showNext);
    els.lightbox.addEventListener("click", (event) => {
      if (event.target === els.lightbox) closeLightbox();
    });
    document.addEventListener("keydown", onKeydown);
    els.lightbox.addEventListener("touchstart", onTouchStart, {
      passive: true,
    });
    els.lightbox.addEventListener("touchend", onTouchEnd, { passive: true });
  }

  async function init() {
    setupFooter();
    bindEvents();

    if (isUnlocked()) {
      showApp();
      await loadGallery();
    } else {
      showGate();
    }
  }

  init();
})();
