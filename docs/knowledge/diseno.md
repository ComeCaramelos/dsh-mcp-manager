# Por qué está hecho así

## Una fila que es la lista

Un plugin de dsh **no puede crear filas de perfil**: las acciones del gestor de plugins
son `list_plugins`, `list_bundles`, `set_plugin`, `set_bundle`, `install_bundle`,
`remove_bundle`, `list_version_exemptions` y `set_version_exemption`, y
`setPluginEnabled` sólo enciende o apaga filas que ya existen.

Así que el manager es dueño de **una** fila, `mcp-manager`, cuyo `config.servers` es la
lista de conexiones, y dentro de ella arranca una conexión de `dsh-mcp-client` por cada
entrada encendida, en el mismo proceso. Por eso añadir, editar o apagar una conexión no
reinicia el perfil, y una conexión que falla no tumba a las demás.

Un paquete que quiere aportar otro tipo de conexión tampoco añade filas: registra un
*kind* (ver [kinds.md](kinds.md)).

## Dos paquetes: el bundle y el plugin

Lo que instalas es `@comecaramelos/dsh-mcp-manager-bundle`, y lo que se ejecuta es
`@comecaramelos/dsh-mcp-manager`. El gestor de plugins lista como *Components* de un
bundle las filas que su `cordis.patch.yml` inserta; si el bundle insertara una fila con
su propio nombre, saldría dos veces en su propia página — como entrada y como componente
que enciende lo mismo. Con el bundle separado (sólo el patch y sus textos), la página
enseña una entrada, **MCP connections**, con sus tres componentes debajo: el manager,
Chrome y Docker.

## El estado vivo sin sondear

El Host publica el estado de cada conexión (conectando, conectada, error, número de
tools) por el mismo canal que la tarjeta edita: campos `.volatile()` de la fila. En dsh
0.2 esas escrituras no se guardan en disco ni reinician nada, pero sí llegan a la
tarjeta, así que está siempre al día sin preguntar cada cierto tiempo.
