// Atlas Workspace server entry point.
//   npm run app            development server (loopback only by default)
//   npm start              production server (after `npm run build`)
// The implementation lives in ./server. This file stays at the repository root because the build, the Electron shell
// and the documentation all refer to `app.tsx` / `dist-desktop/app.mjs`.
import { isEntryPoint, main } from './server/index'

export * from './server/index'

if (isEntryPoint(import.meta.url)) await main()
