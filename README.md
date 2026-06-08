# Monobloc.online

Static rebuild of monobloc.online. No framework, no build step — plain HTML/CSS.

## Structure

```
public/
├── index.html          CRT homepage (logo + nav)
├── live/index.html     Bandsintown tour widget
├── media/index.html    Streaming + social links
├── 404.html
├── _redirects          Old Webflow URL → new URL map
└── assets/
    ├── styles.css      Shared fluid responsive CSS
    ├── logo-transparent.png
    ├── logo-nav.png
    └── favicon.png
netlify.toml            Optional Netlify config (publish dir + cache headers)
```

## Local preview

Any static server works:

```bash
cd public && python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy

**Netlify** — drag `public/` onto app.netlify.com, or:
```bash
netlify deploy --dir=public --prod
```

**Cloudflare Pages** — point the Pages project at this repo, build output directory `public`.

**Vercel** — `vercel --cwd public --prod`.

The `_redirects` file is honoured by Netlify and Cloudflare Pages out of the box. Vercel: rename to `vercel.json` with redirect rules if you need the old URLs.

## Fonts

The original site uses **PP Mondwest** (Pangram Pangram, paid). This rebuild uses **VT323** from Google Fonts as a free substitute that keeps the CRT/terminal feel.

If you license PP Mondwest:
1. Drop the `.woff2` into `public/assets/fonts/`
2. Uncomment the `@font-face` block at the bottom of `assets/styles.css`
3. Change `--font-display` to `'PP Mondwest'`

## Stripe (merch)

The shop lives at [`public/shop/index.html`](public/shop/index.html) with 3 placeholder products. They currently link to `#stripe-tee`, `#stripe-cassette`, `#stripe-stickers` — you swap those for real Stripe URLs.

**Setup (≈5 min per product):**

1. Log into [dashboard.stripe.com](https://dashboard.stripe.com) → flip to **Test mode** in the top right while you're wiring things up.
2. **Products** → **Add product** → name, price, (optional) image. Save.
3. On the product page, click **Create payment link** → configure shipping / quantity / tax → **Create link** → copy the URL.
4. In [`public/shop/index.html`](public/shop/index.html), replace `href="#stripe-tee"` etc. with the copied URL (`https://buy.stripe.com/test_...`).
5. Flip Stripe to **Live mode**, repeat steps 2–4, swap in the live URLs (`https://buy.stripe.com/...` without `test_`).

**After-payment redirect:** in the Stripe Payment Link settings, you can point "Confirmation page" back to `https://monobloc.online/shop/` or a custom `/thanks/` page you add here.

**Adding more products:** copy one of the `<article class="product">` blocks in `shop/index.html`, tweak the title/price/icon, paste a new Payment Link URL. The grid auto-fits any number.

**Want real product photos?** Drop them in `public/assets/shop/` and replace the `<svg>` placeholder inside `.product__media` with `<img src="/assets/shop/tee.jpg" alt="Monobloc Tee">`.

**Going beyond Payment Links?** If you later need carts, dynamic pricing, or volume discounts, the next step is Stripe Checkout Sessions via a small serverless function (Netlify Function / Cloudflare Worker). Ping me when that day comes.

## Design system

Colors, fonts, spacing live as CSS custom properties at the top of `assets/styles.css`. Typography scales with `clamp()` so there are no jumpy breakpoints — the original's pain point.
