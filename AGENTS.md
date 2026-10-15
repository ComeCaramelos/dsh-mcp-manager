# AGENTS.md

Plugin **de conexiones MCP** para DeepSeek Harness: una sola fila de perfil que es la
*lista* de conexiones, con tarjeta en la GUI Web para añadirlas, editarlas, encenderlas o
apagarlas, y estado vivo por conexión.

Se entrega como dos paquetes, igual que los bundles oficiales: `./bundle` es el **bundle**
(el que se instala y el que la GUI lista como entrada) y `@comecaramelos/dsh-mcp-manager`
es el **plugin** que esa fila ejecuta.

## Restricción que da forma al diseño

Un plugin **no puede crear filas de perfil**. Las acciones del gestor de plugins son
`list_plugins | list_bundles | set_plugin | set_bundle | install_bundle | remove_bundle |
list_version_exemptions | set_version_exemption`, y `setPluginEnabled` sólo enciende o
apaga ids ya existentes (medido en dsh 0.2.0-rc.2). Todo lo demás sería diseñar sobre una
capacidad que no existe.

Consecuencia: el plugin es dueño de **una** fila, `mcp-manager`, cuyo `config.servers` es la
lista, y arranca fibras anidadas de `dsh-mcp-client` **en el mismo proceso** por cada
entrada encendida. Un paquete compañero no añade filas: añade un `kind`.

## Layout

Dos planos, un archivo público por plano, como `dsh-chrome-mcp` y `dsh-docker-desktop-mcp`.

- `src/index.ts` — superficie del plano host: `apply(ctx, config)`, `name`, `inject`,
  `Config` (el `Config` de la fila: `servers`, `live`, `kinds`, todos `.volatile()`), y la
  costura de extensión.
- `src/api.ts` — lo que importa un paquete compañero (`registerMcpKind`, tipos).
- `src/host/**` — comportamiento del host, partido por conciencia:
  - `constants.ts`, `schema.ts`, `types.ts`, `values.ts` — la entrada tal como la entrega
    cordis, normalizada;
  - `apply.ts` — el orden: controller → formulario → **plegar la fila al final** (ninguna
    fibra debe arrancar contra una capa de fila todavía sin resolver);
  - `controller/` — lo que el pool no sabe por sí solo: `index.ts` levanta el
    `createFiberPool` de `@comecaramelos/dsh-ancesters/host` con los tres agujeros
    del manager (`entries` vivo, `resolve` por kind, `start` de la fibra
    `dsh-mcp-client`) y la regla de identidad del `id`; `publish` (el mirror
    volatile) va dentro, `kinds.ts` proyecta los kinds para la tarjeta, y
    `tools.ts` pliega lo que cada conexión publicó realmente.
  - `kinds/` — el registro global y los `stdio`/`http` que trae el core;
  - `settings.ts` — cómo se enrolla un commit de la fila en el controller.
- `src/client/**` — mitad web: `index.ts` compone la tarjeta con
  `mountSettingsCard` (mitad compartida: locales, controlador, registro del slot
  de la fila), `card/connections.ts` la lista + editor, `catalog.ts` el modelo de vista
  puro, `locales/`, `styles/` (la hoja propia la inyecta `styles/index.ts` desde el
  `apply` propio, porque lo compartido inyecta **sólo** la suya), `plugin-meta.ts` la
  identidad (`ENTRY_ID`, `PLUGIN_ID`, `BUNDLE_ID`, `ROW_CONFIG_KEY = <bundle>#<entryId>`,
  `MAX_SERVERS`) que **espeja** los valores del host, y `test/client.test.mjs` fija
  el espejo para que un drift duela.
- `bundle/**` — el paquete que se instala, no el que corre: `package.json` con
  `dsh.bundle.patch`, `index.js` vacío (nada importa un bundle), `cordis.patch.yml`
  (la fila `mcp-manager`, que es `@comecaramelos/dsh-mcp-manager`) y `locale/{en,zh}.json`
  con `meta.title`/`meta.description` — sin eso, lo que la GUI lista es el id del
  paquete, ruido largo.

Una tarjeta vive en el **panel de Plugins** (en 0.2.x ya no está dentro de
Ajustes): el **bundle** como entrada, con sus componentes debajo, y la página de
configuración de esa fila, que es donde `plugins.row.config` renderiza la tarjeta.
Esa página se contesta por `<bundle>#<row id>` — el bundle que la persona
instala, no el paquete que la fila ejecuta —, y por eso `mountSettingsCard` lleva
`bundleId` además de `pluginId`: un hueco de tarjeta keyed por el id del plugin es
una página que no se abre nunca desde la lista de componentes. Y la copia se
registra por **el id que el cliente declara** (`zh`, `en`, cerrando la cadena de
fallback en `en`); una clave `en-US` no la alcanza nunca nadie.

## Qué hace el diff

El diff es el `createFiberPool` de `@comecaramelos/dsh-ancesters/host`: es el único sitio
que levanta, cambia o apaga puentes, y corre tras cada arranque y tras cada commit que
nombre `servers`. El manager le pone los tres agujeros y la regla de identidad; lo demás
es la mecánica compartida (su `test/pool.test.mjs`).

| vivo | pedido | acción |
|---|---|---|
| nada | encendida y resolvible | `ctx.plugin(McpClient, cfg)` — fibra nueva |
| fibra | mismo id, misma config resuelta | nada |
| fibra | mismo id, config resuelta distinta | `fiber.update(cfg)` — conmuta en sitio |
| fibra | apagada, borrada o no resolvible | `fiber.dispose()` |

Dos reglas que son el comportamiento, no detalles:

1. El diff se decide sobre la **config resuelta**, no sobre la entrada: un campo que no
   cambia la respuesta del kind no debe reiniciar una conexión viva.
2. Una entrada que no puede resolver es una línea `failed`/`conflict` del mirror, nunca
   una fila fallida: `fiber` que falla al conectar queda registrada con su error, y las
   demás conexiones siguen vivas. Un `serverName` duplicado lo responde el pool con
   `conflict` porque `dsh-mcp-client` rechaza el segundo; un `id` inválido lo responde el
   manager en `validate` antes de que nadie arranque.

## Publicar y escribir

- Publicar: `createLiveMirror` de `@comecaramelos/dsh-ancesters/host` sobre `live` y
  `kinds`. Volatile-only diff: persiste cero, no remonta, y mueve el revision.
- Escribir: `attachSettingsForm` también de ancestros, con `userFields: ["servers"]` y
  `liveKeys: ["live", "kinds"]`. Un commit que no nombre `servers` no enruta: no hay que
   frenar el revision por cada espejo que el Host publica solo.
- `Config` marca `.volatile()` **sólo en los campos de primera nivel**. Un `.volatile()`
  dentro del item de un array volatile es error de configuración: cordis pide una ruta fija
  sin campo volatile envolvente, y la fila entera no activa.

## Los kinds

Registro global (`globalThis` bajo `Symbol.for("@comecaramelos/dsh-mcp-manager/kinds")`),
no el ámbito del módulo: dos árboles del paquete deben ver el mismo mapa. `registerMcpKind`
devuelve un disposer que respeta el orden inverso de disposición.

Un `McpKind` describe la forma del transport (`transport: "stdio" | "http" | "none"`),
declara los `fields` extra que van a `entry.extra`, y responde `resolve(entry, ctx)`:

```ts
resolve(entry, ctx) => { config?, error?, note? }
```

- `config` es la config que corre la fibra (`stdio` → `transport: "stdio"`, `http` →
  `streamable-http`), y es lo único que el diff compara.
- `error` es una línea para el usuario, no una excepción.
- `note` es diagnóstico (por ejemplo, a dónde se fue el stderr), jamás un fallo.

Un kind desconocido nunca se resuelve como stdio por defecto: arrancaría una conexión que
nadie pidió.

## Cómo se comprueba

```sh
npm ci
npm run build
npm test
node scripts/link-profile.mjs  # enlaza fuente y bundle al perfil plugin-dev
node scripts/gui.mjs start     # GUI supervisado para las comprobaciones vivas
```

Los tests cubren lo que tiene lógica propia: normalización de la entrada y registro de
kinds (`host.test.mjs`), las dos reglas del controller con una fibra falsa
(`controller.test.mjs`), el espejo de identidades y el modelo de vista de la mitad web
(`client.test.mjs`), el contrato del bundle emitido bajo `lib/client.js` contra el
cargador (`client-bundle.test.mjs`), y el reparto en dos paquetes (`bundle.test.mjs`) —
que el plugin no sea su propio bundle, que el patch sólo inserte paquetes ajenos y que
el bundle conteste su propio `meta.title`. Nada se prueba por DOM.

Las comprobaciones vivas no vuelven a ser un ritual a mano: `scripts/gui.mjs` es el
único sitio que levanta y apaga el GUI de perfil, y codifica las reglas de
[`docs/knowledge/desarrollo.md`](docs/knowledge/desarrollo.md) (grupo propio, wait con escalado, confirmar escucha
antes de dar por válido, comprobar al final que no queda nada, y no tocar por nombre lo
que todavía vive de un padre vivo). `test/gui.test.mjs` lo prueba contra un server falso
que engendra hijo. No se lanza `timeout -s INT … dsh web …` jamás: eso deja huérfanos, no
pruebas; y no se borra con `cleanup --yes` una línea que tenga el padre vivo: eso apaga
la sesión en la que se está trabajando.

El diff en sí ya no se prueba aquí: se prueba en `../dsh-ancesters/test/pool.test.mjs`.
Este checkout sólo prueba lo que el pool no puede saber por sí solo.

## Reglas de la casa

- Un bundle **no es un plugin**: el suyo no ejecuta nada, y su patch no inserta nunca una
  fila que se llame como él. Un `name` insertado que coincide con el del bundle sale dos
  veces de su propia página: como entrada y como componente que enciende lo mismo.
- Lo que no es dominio del manager va a `@comecaramelos/dsh-ancesters` y se prueba allí.
  Ninguna maquinaria de tarjeta, formulario, mirror o run chain se vuelve a escribir aquí.
- `lib/` es producto: nunca se edita.
- Nada de `git push`; nada de commit en `main`/`develop`; una rama de trabajo = una
  squashed.
- Toda línea de log lleva prefijo `dsh-mcp-manager(<id>)`.
- Documentación: `README.md` es para personas (instalar, usar, enlaces) y corto; lo largo
  va a `docs/knowledge/*.md` enlazado desde el README; lo que sólo necesita un agente va
  aquí. `docs/spec/` y `docs/plans/` son locales (ignorados): nada versionado los enlaza.
- Arrancar dsh siempre con `--no-open` (si no, abre una pestaña en el navegador del
  usuario). En Windows, `chrome.exe --version` abre una ventana: nunca se ejecuta.
- Sólo se hace commit de trabajo terminado.
- Los locales y los estilos van en archivos aparte; un string nunca queda en el medio de un
  componente.
