# H.A.G.S. React

React + Vite version of the H.A.G.S. shop basket app for GitHub Pages.

## Files
- `index.html`
- `package.json`
- `vite.config.js`
- `src/App.jsx`
- `src/main.jsx`
- `src/styles.css`

## Notes
- Public checkout page and private shopkeeper page are combined into one React app.
- Storage uses IndexedDB when available and falls back to localStorage.
- GitHub Pages deployment should use the built `dist` output.

## Start

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```