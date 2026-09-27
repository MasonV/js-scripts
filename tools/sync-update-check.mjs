// Kept so the command named in every generated update-check block still
// works. The update check is now one of several shared blocks — this runs
// tools/sync-blocks.mjs, which syncs all of them (flags are passed through).

import { main } from './sync-blocks.mjs'

main()
