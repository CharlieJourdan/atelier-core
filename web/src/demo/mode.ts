// Demo build of the site (vite.site-demo.config.ts sets VITE_ATELIER_DEMO=1): no backend at all. The Cloud layer
// (cloud.ts) answers every route from the in-browser fake of server.ts, the router uses the URL hash so a static folder
// served under any sub-path works, and the links to the app open the demo app built next to the site (../index.html).
export const DEMO: boolean = import.meta.env.VITE_ATELIER_DEMO === '1'

/** The fictional founder account the demo signs in as, without typing anything. */
export const DEMO_ACCOUNT = { name: 'Studio Démo', email: 'demo@example.com' } as const

/** Where « Ouvrir l'app » goes in the demo: the demo app sits one folder up (dist-demo/index.html, the site in dist-demo/site). */
export const DEMO_APP_HREF = '../index.html'

/** The `?token=` the demo pages use when the address bar carries none (the fake accepts any token). */
export const DEMO_TOKEN = 'jeton-demo'
