# Rewind TT

Página pública para una competición mensual de time trials de Mario Kart Wii / Retro Rewind.

La web es estática y no contiene credenciales. La hoja de Google Sheets es la fuente de datos; el Apps Script sincroniza el catálogo, genera temporadas, procesa formularios y sirve un endpoint JSONP para GitHub Pages.

## Arranque rápido

1. Crea una hoja de cálculo nueva en Google Drive.
2. Abre `Extensiones > Apps Script` y pega el contenido de `apps-script/Code.gs`.
3. Guarda el proyecto y vuelve a la hoja. Recarga para ver el menú `Rewind TT`.
4. Ejecuta `Rewind TT > Preparar hoja` y acepta los permisos.
5. En la pestaña `Players`, añade jugadores con estas columnas:

   `playerId | displayName | color | active | joinedAt | email`

   Ejemplo: `roy | Roy | #d7ff4f | TRUE | 2026-09-04 | roy@example.com`.

6. Ejecuta `Rewind TT > Sincronizar catálogo Retro Rewind`.
7. Ejecuta `Rewind TT > Generar temporada actual`.
8. Ejecuta `Rewind TT > Crear formulario de tiempos`.
9. Despliega el Apps Script desde `Deploy > New deployment > Web app` con `Execute as me` y acceso `Anyone`.
10. Copia la URL del despliegue en `config.js`:

```js
window.MKW_CONFIG = {
  dataUrl: "https://script.google.com/macros/s/DEPLOYMENT_ID/exec",
  dataSource: "jsonp",
  submitUrl: "URL_PUBLICA_DEL_FORMULARIO",
  timezone: "Europe/Madrid"
};
```

11. Publica este repositorio con GitHub Pages usando la raíz de la rama principal.

Cuando se incorpore alguien nuevo, añade su fila activa en `Players` y ejecuta `Rewind TT > Actualizar opciones del formulario`. Así podrá enviar tiempos de la temporada que ya está en marcha y competir por sus puntos.

## Catálogo Retro Rewind

El script utiliza la hoja pública de catálogo mantenida para Retro Rewind. `Sincronizar catálogo` hace lo siguiente:

- Abre el libro oficial y recorre todas sus pestañas de circuitos, no solo la primera.
- Importa las pistas activas de la versión más reciente disponible, aproximadamente 209 retro + 132 custom.
- Ignora cualquier pestaña de `Battle Arenas` o `Arenas`.
- Marca como `active = FALSE` las pistas que ya no aparecen.
- Conserva esas pistas en `Tracks` para que los meses históricos sigan funcionando.
- Detecta las pistas originales de Mario Kart Wii por su nombre `Wii ...`, excluyendo `Wii U ...`.

La pestaña `Tracks` también se formatea automáticamente: `category` distingue `retro`, `wii-original` y `custom`, `console` identifica la plataforma y las celdas reciben colores por consola. Las pistas retiradas aparecen atenuadas y la tabla queda filtrable con la cabecera congelada.

En cada sincronización el catálogo se ordena por categoría y, dentro de `retro`, por antigüedad de consola: SNES, N64, GBA, GCN, DS, Wii, 3DS, Wii U, Tour, RMX, Arcade GP y Switch. Las pistas activas aparecen antes que las retiradas dentro de cada grupo.

`Rewind TT > Instalar sincronización diaria` crea un trigger de Apps Script que comprueba el catálogo una vez al día. La generación mensual siempre filtra las pistas retiradas, aunque sus tiempos históricos sigan visibles.

Si la hoja oficial cambia sus columnas, revisa `sourceCatalogUrl` y el mapeo de columnas en `syncRetroRewindCatalog`.

## Temporadas

`Generar temporada actual` crea cuatro pistas y no vuelve a sortearlas si la temporada ya existe. Cada temporada incluye:

- Al menos una pista original de Wii.
- 150cc por defecto.
- Un máximo de una pista de 200cc, con una probabilidad configurable del 20%.
- Una pista estrella elegida al azar que duplica sus puntos.
- Cierre el último día del mes a las 23:59.

Puedes cambiar `CHANCE_OF_200CC` en `Config`, usando valores entre `0` y `1`.

## Tiempos y fotos

El formulario acepta tiempos como `1:42.345` o `102345` milisegundos. Cada envío se guarda en `Times`; la web usa automáticamente la mejor marca de cada jugador y pista.

El formulario recoge el correo del remitente y solo acepta envíos cuyo correo esté en `Players` con `active = TRUE`. Además, el correo debe coincidir con el jugador seleccionado. Google Forms puede seguir mostrando el formulario a otros usuarios, pero sus envíos se rechazan y se guardan en `Errors` sin entrar en la competición. Para máxima protección, activa también en Google Forms la opción de correo verificado o de requerir inicio de sesión si aparece disponible en tu cuenta.

El campo de captura usa la subida de archivos de Google Forms cuando la cuenta lo permite. Google suele pedir iniciar sesión para subir archivos. Si no está disponible, el script crea un campo opcional para pegar un enlace a una captura, vídeo o ghost.

Si se añade manualmente una pregunta de tipo `Subir archivos`, el script detecta respuestas con títulos como `Captura del tiempo`, `Imagen` o `Archivo`, y convierte IDs de Drive en enlaces guardables en `proofUrl`. Los envíos anteriores a este procesamiento no se rellenan automáticamente.

Los envíos recibidos después del deadline se registran en `Errors` y no entran en la clasificación.

## Autorización de tiempos

La autorización se hace por correo electrónico, no por el nombre elegido en el formulario.

1. Añade cada jugador en `Players` con `active = TRUE` y su correo en la columna `email`.
2. Ejecuta `Rewind TT > Actualizar opciones del formulario` después de añadir o quitar jugadores.
3. Google Forms recoge el correo del remitente mediante `setCollectEmail(true)`.
4. El trigger `onFormSubmit` recibe la respuesta y busca ese correo en `Players`.
5. Si el correo no existe o el jugador seleccionado no coincide con ese correo, el envío se guarda en `Errors` y no se añade a `Times`.
6. Si el correo, el jugador, la pista, el tiempo, la temporada y el deadline son válidos, se añade una fila a `Times` con estado `PENDING`.
7. La web utiliza el mejor tiempo válido de cada jugador y pista.

La autorización de datos y la restricción de acceso al formulario son cosas distintas. Un Google Form puede seguir siendo visitable si alguien obtiene el enlace; el backend rechaza sus respuestas, pero esa persona todavía puede abrir y enviar el formulario. Para impedir también el acceso necesitas activar `Recopilar direcciones de correo` en modo verificado y `Requerir inicio de sesión` si tu cuenta lo permite. En cuentas personales de Google puede que no exista una lista de permitidos real dentro de Forms. Si se necesita esa restricción fuerte, habría que migrar el formulario a una página con autenticación propia o utilizar Google Workspace.

Los correos nunca se incluyen en el JSON público que consume GitHub Pages. Los envíos rechazados y sus datos quedan únicamente en `Errors`, dentro de la hoja.

La columna `verified` de `Times` se prepara como `PENDING`. La web sigue contando esos tiempos, pero los marca visualmente como `pendiente`; los tiempos `REJECTED` no cuentan.

## Operación habitual

1. Añade o modifica jugadores en `Players`.
2. Si ha cambiado el catálogo, ejecuta `Sincronizar catálogo Retro Rewind`.
3. El día 1 genera la temporada con `Generar temporada actual`.
4. Ejecuta `Actualizar opciones del formulario` para que el formulario tenga las pistas nuevas.
5. Durante el mes, los jugadores envían sus mejores tiempos.
6. Revisa `Times` y `Errors` si hay algún envío dudoso.
7. El último día del mes a las 23:59 dejan de aceptarse nuevos tiempos.

## Puntuación

La web calcula estos puntos por pista:

| Puesto | Puntos |
| --- | ---: |
| 1.º | 10 |
| 2.º | 7 |
| 3.º | 5 |
| 4.º | 3 |
| 5.º | 2 |
| 6.º o posterior | 1 |

Completar las cuatro pistas suma `2` puntos. Los empates reciben la misma puntuación. En la clasificación visual, el desempate secundario es número de victorias y después tiempo acumulado.

## Desarrollo local

No hace falta instalar dependencias. Abre la carpeta con un servidor estático, por ejemplo:

```bash
python -m http.server 8000
```

Después visita `http://localhost:8000`. Mientras `config.js` use `data/demo.json`, la página muestra datos de ejemplo con una pista retirada histórica y una carrera de 200cc.

## Mejoras pendientes

### Prioridad alta

- Activar y verificar GitHub Pages con datos reales.
- Hacer una prueba completa con un correo autorizado y otro no autorizado.
- Proteger rangos administrativos de Google Sheets para evitar cambios accidentales.
- Comprobar que el trigger instalable `onFormSubmit` está activo.
- Revisar manualmente el modo de correo verificado del formulario.

### Competición

- Añadir un panel de revisión de envíos pendientes.
- Permitir editar o anular un tiempo manteniendo un registro de cambios.

### Automatización

- Generar automáticamente la temporada el día 1 de cada mes.
- Crear recordatorio mensual en Google Calendar.
- Actualizar automáticamente las opciones del formulario al cambiar de temporada.
- Cerrar y archivar temporadas antiguas automáticamente.
- Añadir avisos por Discord o Telegram.

### Web

- Mostrar categoría y consola con colores también en las tarjetas públicas.
- Añadir perfiles individuales de jugadores.
- Añadir estadísticas de mejora, rachas y récords personales.
- Crear una página de enfrentamientos directos.
- Añadir filtros por mes, consola y categoría.
- Añadir imágenes o miniaturas de las pistas.

### Reglas y diversión

- Configurar la puntuación desde `Config` en lugar de tenerla fija en el código.
- Añadir premios a la mayor mejora y a la participación perfecta.
- Añadir una pista comodín o sorpresa configurable.
- Añadir temporadas trimestrales o anuales.
- Permitir reglas especiales para meses de 200cc.

### Evolución técnica

- Separar los datos públicos y administrativos en hojas distintas.
- Añadir copias de seguridad automáticas de la hoja.
- Migrar a autenticación y base de datos propias si la competición crece mucho.
