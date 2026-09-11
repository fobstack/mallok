# Your plugins

A plugin is real JavaScript that runs inside the Worker. Put its source here,
import it in `src/worker/index.ts`, and pass it to `createMallok`:

```ts
import { createMallok, atelier } from 'mallok/worker';
import { myPlugin } from './plugins/my-plugin/index.js';

export default createMallok({ theme: atelier, plugins: [myPlugin] });
```

Installing, updating or removing a plugin needs a deploy. Its enable switch
and its settings are database state and take effect immediately — the admin
keeps those two things apart on purpose.

The plugin interface is documented at
<https://github.com/fobstack/mallok/blob/main/docs/PLUGIN_API.md>.
