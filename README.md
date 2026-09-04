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

`Generar temporada actual` crea cinco pistas y no vuelve a sortearlas si la temporada ya existe. Cada temporada incluye:

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

Los envíos recibidos después del deadline se registran en `Errors` y no entran en la clasificación.

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

Completar las cinco pistas suma `2` puntos. Los empates reciben la misma puntuación. En la clasificación visual, el desempate secundario es número de victorias y después tiempo acumulado.

## Desarrollo local

No hace falta instalar dependencias. Abre la carpeta con un servidor estático, por ejemplo:

```bash
python -m http.server 8000
```

Después visita `http://localhost:8000`. Mientras `config.js` use `data/demo.json`, la página muestra datos de ejemplo con una pista retirada histórica y una carrera de 200cc.
