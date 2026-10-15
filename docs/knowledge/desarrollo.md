# Desarrollo

## Montar el entorno

```sh
npm ci
npm run build                    # lib/index.js (host) + lib/client.js (mitad web)
npm test
node scripts/link-profile.mjs    # enlaza este checkout y el bundle al perfil plugin-dev
```

`link-profile.mjs [perfil]` enlaza el plugin, el bundle y, si están al lado en el mismo
directorio, los checkouts de `dsh-chrome-mcp` y `dsh-docker-desktop-mcp`. Sólo registra el
bundle como capa del perfil: el plugin no es un bundle, y si se registrara dsh avisaría
en cada arranque ("declares no `dsh.bundle` in its package.json").

La mitad web (`src/client/**`) se empaqueta con esbuild y la del host se compila con
`tsc`. La maquinaria común (tarjeta, formulario, espejo vivo, pool de conexiones) vive en
`@comecaramelos/dsh-ancesters`.

## Arrancar dsh para probar

Siempre supervisado con `scripts/gui.mjs`, no a mano:

```sh
node scripts/gui.mjs start   --profile plugin-dev --port 13955             # arranca y espera a que escuche
node scripts/gui.mjs run     --profile plugin-dev --port 13955 --secs 35   # arranca, espera y apaga
node scripts/gui.mjs stop    --profile plugin-dev --port 13955             # apaga todo el grupo
node scripts/gui.mjs cleanup --profile plugin-dev --port 13955 --yes       # recoge huérfanos
```

Usa un puerto fijo: con `--port 0` no se puede confirmar que el servidor escucha. Para
mirar el arranque a mano basta `dsh --profile plugin-dev --no-open --port 0` (en 0.2 el
perfil ya es la app; sin `--no-open`, dsh abre una pestaña en tu navegador).

## Por qué tanto cuidado con los procesos

dsh arranca un hijo por cada conexión encendida, y esos hijos pueden lanzar los suyos
(`chrome-devtools-mcp`, Chrome, el gateway de Docker). Apagar mal deja procesos vivos que
nadie recoge. `gui.mjs` aplica cinco reglas aprendidas así:

1. **Apagar con `SIGTERM` y esperar**; sólo escalar a `SIGKILL` si la espera vence. Un
   `kill -9` al servidor no mata a sus hijos.
2. **Nunca `SIGINT`** (ni `timeout -s INT`): dsh no se cierra con él, y el `timeout` se
   queda esperando para siempre. Si hace falta un límite de tiempo:
   `timeout --signal=TERM --kill-after=10s`.
3. **Confirmar que escucha** antes de dar el arranque por bueno: un dsh con CPU alta y sin
   puerto abierto es un arranque caído, no uno lento.
4. **Lanzar en un grupo propio** y apagar el grupo, no sólo la cabeza.
5. **No matar lo que tiene un padre vivo.** Un `dsh` encontrado por nombre puede ser la
   sesión que estás usando; `cleanup` sólo recoge lo que lanzó su propio `start` y lo que
   de verdad quedó sin padre, aunque se le pase `--yes`.

Tras apagar, `stop` sólo devuelve `0` si no queda ningún proceso tratable del patrón y el
puerto está libre. `test/gui.test.mjs` lo comprueba contra un servidor falso que lanza un
hijo.

En Windows no hay grupos de procesos POSIX: arranca dsh con `Start-Process … -PassThru`,
guarda el PID y apágalo con `taskkill /PID <pid> /T /F`.
