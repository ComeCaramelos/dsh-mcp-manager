# Venir de los bundles sueltos de chrome o docker

Con dsh 0.1, Chrome y Docker se instalaban como bundles independientes:
`@comecaramelos/dsh-chrome-mcp` 1.x y `@comecaramelos/dsh-docker-desktop-mcp` 0.0.x. Con
dsh 0.2 son **componentes** de `@comecaramelos/dsh-mcp-manager-bundle`.

## Qué pasa si no los quitas

- Ambos insertan la misma fila (`mcp-chrome` / `mcp-docker`) que el bundle nuevo, y una
  fila insertada dos veces rompe el arranque.
- El chrome 1.x, además, no carga en dsh 0.2: la web se queda en *Failed to load plugins*
  con `@comecaramelos/dsh-chrome-mcp: pending (waiting for service: settingsScope)`.

## Pasos

1. Quita el paquete viejo del perfil:

   ```sh
   dsh plugin --profile web remove @comecaramelos/dsh-chrome-mcp
   dsh plugin --profile web remove @comecaramelos/dsh-docker-desktop-mcp
   ```

2. Si sigue apareciendo en `dsh.profile.bundles` del `package.json` del perfil, borra esa
   línea.
3. Instala el bundle:

   ```sh
   dsh plugin --profile web add @comecaramelos/dsh-mcp-manager-bundle
   ```

## Tu configuración no se pierde

Lo que configuraste en la fila vieja vive en el `cordis.patch.yml` del perfil, y el
paquete no lo borra. Al arrancar con el bundle nuevo, el componente lo detecta y la
tarjeta **MCP connections** ofrece crear la conexión equivalente:

- **Crear conexión** la da de alta con los mismos flags, el mismo modo de stderr y el
  mismo nombre (`chrome` por defecto), así que las tools se siguen llamando igual. Si los
  flags llevaban `--browserUrl` (lo que dejaba *Prelaunch Windows Chrome*), en WSL se crea
  una conexión `chrome-windows`.
- **Descartar** no la vuelve a ofrecer.

Si la fila vieja sólo tenía los valores por defecto, no hay nada que traducir y no se
ofrece nada: añade la conexión desde *Add connection*.
