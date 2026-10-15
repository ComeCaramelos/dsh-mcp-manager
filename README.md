# @comecaramelos/dsh-mcp-manager

Gestor de conexiones MCP para [DeepSeek Harness](https://github.com/deepseek-ai). Desde la
GUI Web declaras **varios** servidores MCP —stdio y Streamable HTTP, más Chrome y el MCP
Toolkit de Docker Desktop— y los enciendes o apagas uno por uno sin reiniciar el perfil.

Requiere dsh `^0.2.0` (0.2.0 y 0.2.1), en Linux, WSL o Windows.

## Instalar

```sh
dsh plugin --profile web add @comecaramelos/dsh-mcp-manager-bundle
```

En el panel de **Plugins** aparece una entrada, **MCP connections**, con tres componentes:

- **MCP connections** — el gestor; su página es la tarjeta de conexiones.
- **Chrome MCP** — añade los tipos `chrome` (y `chrome-windows` en WSL).
- **Docker MCP Toolkit** — añade el tipo `docker-profile`.

Apagar Chrome o Docker quita su tipo del selector; sus conexiones guardadas se quedan con
la línea "kind … is not registered" hasta que lo vuelvas a encender.

**¿Venías de los bundles sueltos de chrome 1.x o docker 0.0.x?** Quítalos antes: chocan
con este bundle, y el chrome 1.x ni siquiera carga en dsh 0.2. Tu configuración no se
pierde — la tarjeta te ofrece crear la conexión equivalente. Pasos en
[docs/knowledge/migracion.md](docs/knowledge/migracion.md).

## Usar la tarjeta

Plugins → MCP connections → **MCP connections**. Una fila por conexión:

| columna | qué muestra |
|---|---|
| toggle | enciende o apaga esa conexión |
| label · id | su nombre; las tools salen como `mcp__<id>__<tool>` |
| kind | el tipo de conexión |
| punto + texto | estado: `connected`, `connecting…`, `failed: …`, `stopped` |
| número | cuántas tools publica |

*Add connection* abre el editor. Editar una conexión que no cambia lo que ejecuta no la
reinicia.

- **stdio** — `command`, `args` (uno por línea, sin comillas de shell), `env` y `cwd`. El
  stderr del servidor va a la consola de dsh (*Console*) o a un fichero propio (*Log
  file*, para servidores ruidosos); la ruta del log sale bajo la conexión.
- **HTTP** — `url` y `headers` sobre Streamable HTTP.
- **chrome / chrome-windows / docker-profile** — los añaden los componentes; ver los
  README de `@comecaramelos/dsh-chrome-mcp` y `@comecaramelos/dsh-docker-desktop-mcp`.

Ejemplo: el relay MCP de Unity, que es un ejecutable de Windows, desde dsh en WSL:

```yml
- id: unity
  kind: stdio
  enabled: true
  command: /mnt/c/<usuario>/.unity/relay/relay_win.exe
  args:
    - --mcp
  stderrMode: log
```

## WSL y Windows

Funciona igual en los dos; lo que cambia es de plataforma:

- `chrome-windows` (manejar el Chrome de Windows desde WSL) sólo existe en WSL; en
  Windows nativo usa `chrome`.
- Docker en WSL usa el `docker.exe` de Docker Desktop si existe
  (`/Docker/host/bin/docker.exe`). El Toolkit necesita los perfiles de MCP activados en
  Docker Desktop.
- Los `.cmd` de Windows (como `npx`) se lanzan sin shell.

## Añadir tus propios tipos de conexión

Otro paquete puede registrar un *kind* con `registerMcpKind` (o por el service
`mcpConnections`) y sus conexiones salen en la misma tarjeta. Guía:
[docs/knowledge/kinds.md](docs/knowledge/kinds.md).

## Desarrollo

```sh
npm ci
npm run build
npm test
node scripts/link-profile.mjs    # enlaza este checkout (y chrome/docker si están al lado) al perfil plugin-dev
```

Para arrancar dsh en pruebas usa `scripts/gui.mjs`, que no deja procesos huérfanos.
Detalles en [docs/knowledge/desarrollo.md](docs/knowledge/desarrollo.md); el porqué del
diseño en [docs/knowledge/diseno.md](docs/knowledge/diseno.md). Si eres un agente, lee
[AGENTS.md](AGENTS.md).
