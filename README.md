# Photos — GitHub Pages + Google Drive Gallery

A mobile-first photo gallery hosted on **GitHub Pages**. Photos live in a shared Google Drive folder. Visitors unlock the site with a password; after that, they can refresh without signing in again.

> **Privacy note:** This is a simple client-side lock. The password hash and API key are visible in the browser. Suitable for family/personal galleries — not for confidential files.

---

## Quick start (after you fill in config)

1. Edit [`config.js`](config.js) with your values (see below).
2. Push to GitHub and enable Pages.
3. Open `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`.

---

## 1. Configure everything in one file

All settings live in [`config.js`](config.js):

```js
window.SITE_CONFIG = {
  githubRepo: "YOUR_GITHUB_USERNAME/YOUR_REPO_NAME",
  driveFolderId: "YOUR_GOOGLE_DRIVE_FOLDER_ID",
  googleApiKey: "YOUR_GOOGLE_API_KEY",
  passwordHash: "YOUR_PASSWORD_SHA256_HEX",
};
```

| Field | Where it comes from |
| --- | --- |
| `githubRepo` | `username/repo-name` — shown in the footer |
| `driveFolderId` | From the Drive folder URL (step 2) |
| `googleApiKey` | Google Cloud Console (step 3) |
| `passwordHash` | SHA-256 of your password (step 4) |

---

## 2. Google Drive folder

1. Create a folder in [Google Drive](https://drive.google.com) and upload your photos.
2. Right-click the folder → **Share** → **General access** → **Anyone with the link** → **Viewer**.
3. Open the folder. The URL looks like:

   `https://drive.google.com/drive/folders/1AbCDefGhijKLmnopQRsTuvWxYz`

4. Copy the ID (`1AbCDefGhijKLmnopQRsTuvWxYz`) into `config.js` as `driveFolderId`.

### Captions and tags on photos

1. Select a photo in Drive.
2. Open **Details** (ⓘ information panel).
3. Edit **Description**. Example:

   `Beach day with the kids #vacation #family`

4. On the website, open the photo: text appears under the image; `#tags` become chips.
5. Click **Refresh** on the site after editing descriptions so new text loads.

---

## 3. Google Cloud API key

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or pick an existing one).
3. **APIs & Services** → **Library** → enable **Google Drive API**.
4. **APIs & Services** → **Credentials** → **Create credentials** → **API key**.
5. Edit the key → **Application restrictions** → **HTTP referrers**, add:
   - `https://YOUR_USERNAME.github.io/*`
   - `http://localhost:*` (optional, for local testing)
6. Under **API restrictions**, choose **Restrict key** → **Google Drive API**.
7. Save, then paste the key into `config.js` as `googleApiKey`.

---

## 4. Site password (hash only)

Never put the plain password in the repo. Generate a SHA-256 hash:

```bash
echo -n 'your-password' | shasum -a 256
```

Or in a browser console:

```js
crypto.subtle.digest("SHA-256", new TextEncoder().encode("your-password"))
  .then((buf) => console.log([...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")));
```

Paste the hex string into `config.js` as `passwordHash`.

After unlock, the session is kept in `sessionStorage` for that browser tab. Closing the tab requires the password again. **Refresh** only reloads photos from Drive — it does not ask for the password again.

---

## 5. Push to GitHub and enable Pages (no `gh` needed)

This project is set up for **`gabi-in-mtl/gabi-in-mtl`**.

If you use a different GitHub account on this Mac than `gabi-in-mtl`, authenticate as that account when pushing (HTTPS + Personal Access Token is simplest).

### A. Create a Personal Access Token (on the gabi-in-mtl account)

1. Log into GitHub as **gabi-in-mtl**.
2. **Settings → Developer settings → Personal access tokens → Tokens (classic)**.
3. **Generate new token (classic)** with scope **`repo`**.
4. Copy the token (you will paste it as the password when `git push` asks).

### B. Commit and push from this folder

```bash
cd /Users/marenwehrheim/Gabi/website

git init
git branch -M main
git add .
git commit -m "Initial photo gallery site"

git remote add origin https://github.com/gabi-in-mtl/gabi-in-mtl.git
git push -u origin main
```

When prompted:
- **Username:** `gabi-in-mtl`
- **Password:** paste the Personal Access Token (not your GitHub account password)

If macOS Keychain already stored another GitHub login and push fails, clear it: **Keychain Access → search `github.com` → delete the internet password**, then push again.

### C. Enable GitHub Pages (in the browser)

1. Open https://github.com/gabi-in-mtl/gabi-in-mtl/settings/pages
2. **Build and deployment → Source:** Deploy from a branch
3. Branch: **`main`**, folder: **`/ (root)`** → Save

**Site URL:** https://gabi-in-mtl.github.io/gabi-in-mtl/

In the Google API key referrer list, add: `https://gabi-in-mtl.github.io/*`

### Local preview

```bash
# Python
python3 -m http.server 8080

# or Node
npx --yes serve .
```

Open `http://localhost:8080` and unlock with your password.

---

## Features

- Password gate (SHA-256 hash in config)
- Photos-style timeline grouped by month
- Filter by tags from Drive descriptions (multi-select; **All** clears)
- Tap a photo to open a large lightbox with caption/tags
- Tap a tag in the lightbox to filter by it
- Swipe or arrow keys to move between photos
- **Refresh** reloads Drive without re-entering the password
- Responsive layout for phone, tablet, and desktop

## Files

| File | Role |
| --- | --- |
| `config.js` | Your repo, Drive folder, API key, password hash |
| `index.html` | Page structure |
| `styles.css` | Layout and mobile styles |
| `app.js` | Auth, Drive fetch, gallery, lightbox |
| `README.md` | This guide |
