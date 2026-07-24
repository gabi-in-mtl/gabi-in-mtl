(() => {
  "use strict";

  const SESSION_KEY = "gallery_unlocked";
  const config = window.SITE_CONFIG || {};

  const els = {
    gate: document.getElementById("gate"),
    gateForm: document.getElementById("gate-form"),
    passwordInput: document.getElementById("password-input"),
    gateError: document.getElementById("gate-error"),
    app: document.getElementById("app"),
    status: document.getElementById("status"),
    gallery: document.getElementById("gallery"),
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
  let lightboxIndex = -1;
  let touchStartX = 0;
  let touchStartY = 0;

  /**
   * @typedef {object} Photo
   * @property {string} id
   * @property {string} name
   * @property {string} description
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
    let match;
    while ((match = tagRe.exec(raw)) !== null) {
      tags.push(match[1]);
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
   * @param {object} file
   * @returns {Date}
   */
  function photoDate(file) {
    const metaTime = file.imageMediaMetadata && file.imageMediaMetadata.time;
    if (metaTime) {
      // Drive EXIF times are often "YYYY:MM:DD HH:MM:SS"
      const normalized = String(metaTime).replace(
        /^(\d{4}):(\d{2}):(\d{2})/,
        "$1-$2-$3"
      );
      const parsed = new Date(normalized);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date(file.createdTime || file.modifiedTime || Date.now());
  }

  async function fetchDrivePhotos() {
    const folderId = config.driveFolderId;
    const apiKey = config.googleApiKey;
    const q = `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`;
    const fields =
      "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,description,imageMediaMetadata)";

    /** @type {Photo[]} */
    const all = [];
    let pageToken = "";

    do {
      const params = new URLSearchParams({
        q,
        key: apiKey,
        pageSize: "1000",
        fields,
        orderBy: "createdTime desc",
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
        all.push({
          id: file.id,
          name: file.name || "Photo",
          description: file.description || "",
          date: photoDate(file),
          thumbUrl: driveImageUrl(file.id, 400),
          fullUrl: driveImageUrl(file.id, 2000),
        });
      }

      pageToken = data.nextPageToken || "";
    } while (pageToken);

    all.sort((a, b) => b.date.getTime() - a.date.getTime());
    return all;
  }

  /**
   * @param {Photo[]} list
   * @returns {Map<string, Photo[]>}
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

    setStatus("");
    const groups = groupByMonth(photos);
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
        const globalIndex = photos.indexOf(photo);
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

        btn.addEventListener("click", () => openLightbox(globalIndex));
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
      return;
    }

    if (spinning) els.refreshBtn.classList.add("is-spinning");
    setStatus("Loading photos…");

    try {
      photos = await fetchDrivePhotos();
      renderGallery();
    } catch (err) {
      console.error(err);
      photos = [];
      els.gallery.replaceChildren();
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
    if (index < 0 || index >= photos.length) return;
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
    const photo = photos[lightboxIndex];
    if (!photo) return;

    const { caption, tags } = parseDescription(photo.description);

    els.lightboxImage.src = photo.fullUrl;
    els.lightboxImage.alt = photo.name;
    els.lightboxCaption.textContent = caption || "";

    els.lightboxTags.replaceChildren();
    for (const tag of tags) {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = `#${tag}`;
      els.lightboxTags.appendChild(chip);
    }

    els.lightboxPrev.disabled = lightboxIndex <= 0;
    els.lightboxNext.disabled = lightboxIndex >= photos.length - 1;
  }

  function showPrev() {
    if (lightboxIndex > 0) {
      lightboxIndex -= 1;
      updateLightbox();
    }
  }

  function showNext() {
    if (lightboxIndex < photos.length - 1) {
      lightboxIndex += 1;
      updateLightbox();
    }
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
