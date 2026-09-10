# Parametric Modeler

[![CI](https://github.com/Tanner-Eischen/ParametricModeller/actions/workflows/ci.yml/badge.svg)](https://github.com/Tanner-Eischen/ParametricModeller/actions/workflows/ci.yml)

A browser-based 3D CAD editor for planar, prismatic woodworking models. The application
stores an editable feature history and rebuilds B-Rep geometry from that history.

## What it supports

- Sketches, extrudes, cuts, resizes, patterns, mirrors, body transforms, and planar booleans
- Miter cuts and paired woodworking joints
- Components, instances, and face-based assembly constraints
- Exact B-Rep measurements, cut lists, and shop drawings
- Cut-list CSV plus SVG, DXF, and PDF shop-drawing exports
- JSON document persistence, recent files, and browser autosave

Geometry operations are intentionally limited to flat faces and sharp-edged prismatic solids.
Risky or unsupported operations fail closed instead of attempting automatic geometry repair.

## Run locally

Node.js 22 is used in CI.

```bash
npm ci
npm run dev
```

Vite prints the local URL after the development server starts.

## Verify changes

Install Chromium once for the browser suite, then run the same verification gate used by
GitHub Actions:

```bash
npx playwright install chromium
npm run check:all
```

The gate runs ESLint, TypeScript checking, a production Vite build, Vitest with coverage
thresholds, and Playwright browser tests. Individual commands are also available:

```bash
npm run lint
npm run typecheck
npm run build
npm test
npm run test:coverage
npm run test:e2e
```

## Web release

```bash
npm run release:web
```

This creates a versioned static-site archive, manifest, and SHA-256 checksum under
`release/artifacts/`. See [`release/README.md`](release/README.md) for packaging details.

Implementation milestones and the project roadmap are indexed in
[`plans/README_INDEX.md`](plans/README_INDEX.md).
