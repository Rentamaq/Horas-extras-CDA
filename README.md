# Horas Extras CDA – Rentamaq

Sistema web para **solicitar, autorizar y controlar horas extras** del contrato CDA.
Busca terminar con las horas duplicadas y las horas sin autorización formal de una jefatura.

## Qué hace

- **Solicitud**: encabezado del trabajador (nombre, RUT validado, cargo, supervisor, turno) y uno o más registros de horas
  (actividad, área, fecha, hora de inicio y término, quién de Teck lo solicita). Calcula el total de horas, incluso si el trabajo pasa la medianoche.
- **Bloqueo de duplicados**: no deja ingresar horas que se crucen con otra solicitud del mismo RUT en la misma fecha y horario.
  Si dos celulares sin señal ingresan lo mismo, la planilla central lo marca como *POSIBLE DUPLICADO*.
- **Aprobación**: cada registro tiene los botones **✔ Aprobado** y **✖ No aprobado**. Ambos piden el **nombre de quien autoriza**
  y guardan la fecha y hora de la decisión.
- **Excel**: el botón *Descargar Excel* genera un `.xlsx` con todos los registros filtrados y una hoja de resumen de horas aprobadas por trabajador.
- **Sin conexión**: se puede instalar en el celular (“Agregar a pantalla de inicio”). Sin señal, las solicitudes y aprobaciones quedan guardadas
  en el teléfono y se envían solas al volver la conexión.

## Publicar en GitHub Pages

1. Subir el contenido de esta carpeta al repositorio **Horas-extras-CDA** (rama `main`, en la raíz).
2. En GitHub: *Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`*.
3. La página queda en `https://<usuario>.github.io/Horas-extras-CDA/`.
4. Abrirla una vez **con señal** en cada celular y agregarla a la pantalla de inicio. Desde ahí funciona sin conexión.

## Planilla central compartida (recomendado)

GitHub Pages solo publica archivos: no puede guardar datos. Para que **todos los celulares y jefaturas vean la misma planilla**,
se usa una Hoja de cálculo de Google como base (descargable como Excel):

1. Abrir la planilla [Horas Extras CDA - Rentamaq](https://docs.google.com/spreadsheets/d/173rdAy_tsAXmQyf30xxHlFakHcM52q4PLYwnCKfR0m8/edit) (ya creada en Google Drive).
2. *Extensiones → Apps Script*, borrar lo que aparece y pegar el contenido de [`apps-script/Code.gs`](apps-script/Code.gs). Guardar.
   Elegir la función `preparar` arriba y presionar ▶ *Ejecutar*: pedirá autorizar permisos y creará los encabezados.
3. *Implementar → Nueva implementación → Tipo: Aplicación web*.
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
4. Autorizar los permisos y copiar la URL que termina en `/exec`.
5. Pegar esa URL en [`config.js`](config.js) (`endpoint: "https://script.google.com/macros/s/…/exec"`) y subir el cambio a GitHub.
   (También se puede pegar en el enlace *Configuración* al pie de la página, solo para ese equipo.)

La hoja **Registros** se crea sola. Para obtener el Excel: *Archivo → Descargar → Microsoft Excel (.xlsx)*, o el botón *Descargar Excel* de la página.

Sin URL configurada, cada equipo guarda sus propios datos y los exporta con *Descargar Excel*.

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | Página principal |
| `styles.css` | Colores corporativos Rentamaq (naranjo `#E88A0F`, gris `#333333`) |
| `app.js` | Formulario, control de duplicados, aprobación, Excel y sincronización |
| `config.js` | URL de la planilla central |
| `sw.js`, `manifest.webmanifest` | Funcionamiento sin conexión / instalación en el celular |
| `apps-script/Code.gs` | Código para la planilla central en Google |
| `img/` | Logo e íconos |

## Importante

Cualquier persona con el enlace puede presionar *Aprobado*; el sistema registra **quién** dice autorizar y **cuándo**,
pero no verifica identidad. Si se requiere que solo jefaturas aprueben, el siguiente paso es agregar un PIN o una lista de autorizadores.
