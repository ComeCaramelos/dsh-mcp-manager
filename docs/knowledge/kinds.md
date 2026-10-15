# Kinds: cómo añade un paquete su propio tipo de conexión

Un *kind* dice **qué** ejecuta realmente una conexión. Todo lo demás que una conexión
necesita —identidad, interruptor, estado vivo, tools publicadas— ya lo pone el manager,
así que un kind sólo tiene que contestar `resolve()`. El core trae `stdio` y `http`;
`dsh-chrome-mcp` añade `chrome` y `chrome-windows`, y `dsh-docker-desktop-mcp` añade
`docker-profile`.

## La interfaz

```ts
interface McpKind {
    id: string;                        // lo que va en entry.kind
    label: string;                     // lo que lee el selector
    summary?: string;                  // línea bajo el label
    transport: "stdio" | "http" | "none";
    fields?: readonly KindField[];     // campos extra que dibuja el editor
    actions?: readonly KindAction[];   // botones sobre una entrada guardada
    maxEntries?: number;               // cuántas entradas de este kind caben
    icon?: readonly string[];          // trazos para la píldora del composer
    resolve(entry, ctx): ResolvedConnection | PromiseLike<ResolvedConnection>;
}
```

`resolve` contesta, para una entrada concreta, `{ config?, error?, note? }`:

- `config` es la configuración con la que corre la conexión. Es **lo único** que el
  manager compara para decidir si reinicia: cambiar un campo que no cambia `config` no
  corta una conexión viva.
- `error` es una línea para el usuario, no una excepción: la entrada queda `failed` y las
  demás siguen.
- `note` es diagnóstico (por ejemplo, a dónde va el stderr); la tarjeta lo enseña sin
  tratarlo como fallo.
- Puede devolver una **promesa** cuando contestar cuesta (un daemon que levantar, un
  puerto que aún no responde): mientras tanto la entrada se lee `starting`, y una promesa
  rechazada deja esa entrada `failed`.

| caso | respuesta |
|---|---|
| puede contestar | `{ config }`, y `note` si algo se fue a otro lado |
| falta algo del usuario | `{ error }` nombrando el campo |
| su transporte no existe en esta máquina | `{ config, note }` — no es un fallo |
| kind que nadie registró | lo contesta el manager: "kind … is not registered" |

Un kind sin registrar **nunca** se ejecuta como stdio por defecto: arrancaría algo que
nadie pidió justo cuando su paquete se ha ido.

## Registrarlo

Lo más simple es el registro global:

```ts
import { registerMcpKind } from "@comecaramelos/dsh-mcp-manager/api";

export function apply(ctx) {
    // Con ctx.effect, un hot reload no deja dos kinds registrados.
    ctx.effect(() => registerMcpKind(kind));
}
```

Un componente del bundle puede ir en cambio por el **service** del manager,
`inject: ["mcpConnections"]`: `registerKind`, `entries`, `line`, `invalidate`, `update` y
`propose` son las mismas puertas, con el ciclo de vida de cordis — lo que el componente
registró se va con él cuando se apaga.

Lo que necesita el paquete para llegar a ejecutarse:

- **Depender del manager** (`dependencies` o `peerDependencies`). Sin él, el `import`
  falla, sólo se apaga la fila del paquete, y sus conexiones contestan "not registered".
- **Una fila propia en su `cordis.patch.yml`**, aunque no tenga configuración: es lo que
  hace que su `apply` corra. Para crearla se usa `insert` (un `- id: …` a secas sólo
  modifica una fila existente, y si no existe el patch falla con `entry "…" not found`):

  ```yml
  - insert:
      - id: mcp-mi-kind
        name: '@scope/mi-kind'
        config: {}
  ```

## Campos extra (`fields`)

La tarjeta nunca importa el paquete: el Host pregunta al registro y publica los kinds en
la fila, y el selector y los campos salen de ahí. `transport` decide qué campos del
transporte siguen visibles; `fields` se dibujan encima y escriben en `entry.extra` (un
diccionario de cadenas que el core no interpreta).

- **`type: "select"`** con `options` fijas o una **función** que el Host evalúa cada vez
  que publica — así un kind ofrece lo que descubrió (perfiles de Docker, ejecutables de
  Chrome). Cuando el descubrimiento cambie, `notifyMcpKindsChanged()` republica. Un valor
  guardado que las opciones ya no traen se sigue ofreciendo: una selección no cambia sola.
- **`composer: true`** en un `select`, más el `icon` del kind: por cada entrada encendida
  de ese kind sale una píldora bajo la caja del mensaje para elegir `extra.<campo>`.
- **`maxEntries`**: al llegar al límite el selector deja de ofrecer el kind, y las
  entradas que sobren (añadidas por otro camino) contestan `conflict` sin arrancar.
- **`actions`**: botones sobre una entrada guardada ("Prelaunch", "Fetch"…). Cada pulsación
  corre `run(entry, ctx)` **una vez**, para esa entrada; un `run` que lanza deja la línea en
  `failed` sin tocar las demás.

## Proponer una conexión (`propose`)

Un componente que encuentra configuración de antes (por ejemplo, la fila de un bundle
viejo) puede **proponer** la conexión equivalente sin escribirla:

```ts
ctx.mcpConnections.propose({ id, title, entry, onDismiss })   // → () => void
```

La tarjeta la enseña con *Crear conexión* / *Descartar*. La propuesta desaparece sola en
cuanto existe una entrada de ese kind; *Descartar* llama a `onDismiss`, que es donde el
componente recuerda no volver a ofrecerla.

## Lo que un kind no debe hacer

- Añadir filas de perfil (un plugin no puede) ni escribir el `config` del manager.
- Reiniciar conexiones por su cuenta: lo decide el manager comparando `config`.
- Guardar estado que ya da la conexión (tools, estado vivo).
- Depender del DOM: la mitad web vive sólo de lo que el Host publica.

## Ejemplo mínimo

```ts
import { registerMcpKind } from "@comecaramelos/dsh-mcp-manager/api";

registerMcpKind({
    id: "chrome-port",
    label: "Chrome por puerto de depuración",
    transport: "none",
    fields: [{ key: "debugPort", label: "Debugging port", placeholder: "9222", required: true }],
    resolve(entry) {
        const port = Number(entry.extra.debugPort);
        if (!Number.isInteger(port) || port <= 0) {
            return { error: `connection "${entry.id}": set the debugging port Chrome was started with` };
        }
        // El puerto habla CDP, no MCP: el servidor MCP es un chrome-devtools-mcp local.
        return {
            config: { serverName: entry.id, transport: "stdio", command: "npx",
                      args: ["-y", "chrome-devtools-mcp", `--browserUrl=http://127.0.0.1:${port}`] },
            note: "the browser must already be running with --remote-debugging-port"
        };
    }
});
```

Con eso el kind sale en el selector, el editor enseña el campo y el estado vivo sale solo.
