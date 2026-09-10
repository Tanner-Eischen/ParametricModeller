# Web release packaging

Run `npm run release:web` to type-check and build the application with Vite, then create:

- `release/artifacts/parametric-modeler-web-v<version>.zip`
- `release/artifacts/parametric-modeler-web-v<version>.manifest.json`
- `release/artifacts/parametric-modeler-web-v<version>.zip.sha256`

The ZIP contains the static Vite output plus its file manifest. Paths are sorted, archive timestamps
are normalized, and `SOURCE_DATE_EPOCH` can set the recorded build time for reproducible release
automation. The checksum file uses the common `<sha256>  <filename>` format.

## What this artifact is

This is a platform-neutral **web distribution archive**. Extract it to a static web server or upload
its contents to a static hosting service. The server must fall back to `index.html` if client-side
routing is added later.

## What this artifact is not

It is not a Windows/macOS/Linux installer, desktop application, signed executable, auto-updater, or
native offline runtime. It does not bundle Electron, a browser, Node.js, or a web server. Double-clicking
`index.html` is not a supported launch path because Vite's production assets are served over HTTP.

Release signing, installer creation, and publishing are intentionally separate deployment concerns.
