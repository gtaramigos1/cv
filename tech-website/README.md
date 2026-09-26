# Voltic — Technology Website

A responsive, single-page marketing site for a fictional cloud/AI/developer-platform company. Pure HTML, CSS and vanilla JavaScript — no build step or dependencies.

## Features
- Hero with an animated typing terminal
- Products, platform tabs (keyboard-accessible), developer SDK code sample with copy button
- Animated stats, testimonials, pricing with monthly/yearly toggle, blog cards, FAQ
- Contact form with client-side validation
- Light/dark theme (remembers your choice, follows system by default)
- Mobile navigation, scroll-reveal animations, respects `prefers-reduced-motion`

## Run locally
Open `index.html` in a browser, or serve the folder:

```bash
cd tech-website
python3 -m http.server 8000
# visit http://localhost:8000
```

## Deploy
Any static host works (GitHub Pages, Netlify, Vercel, Cloudflare Pages) — just publish this folder.
