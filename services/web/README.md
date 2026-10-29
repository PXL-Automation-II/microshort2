# web — admin dashboard

React 19 + Vite + TypeScript + [shadcn/ui](https://ui.shadcn.com) (Radix primitives, Tailwind v4), React Router, TanStack Query, Recharts. Served in production by `server.js`, a small Express app that also provides `/health`, `/ready`, `/metrics` and the runtime `/config.js`.

```bash
npm install
npm run dev        # Vite on http://localhost:5173, API at VITE_API_BASE_URL (default http://localhost:3000)
npm run build      # type-check + bundle to dist/
npm start          # serve dist/ (needs API_BASE_URL)
```

The browser learns where the API is from `/config.js`, generated at request time from the `API_BASE_URL` environment variable (`/api` behind a path-routing proxy, or an absolute URL). Nothing about the deployment is baked into the bundle.

Add a shadcn component: `npx shadcn@latest add <name>` (configuration in `components.json`).
