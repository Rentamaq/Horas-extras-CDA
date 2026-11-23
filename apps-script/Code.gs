/**
 * Planilla central de Horas Extras CDA – Rentamaq
 * Pegar este código en Extensiones > Apps Script de la Hoja de cálculo de Google
 * y publicarlo como Aplicación web (ver README.md).
 *
 * Seguridad:
 *  - Cualquier trabajador puede ENVIAR solicitudes nuevas (siempre quedan "Pendiente").
 *  - Ver todos los registros, aprobar, editar o eliminar requiere la clave de administrador.
 *  - La clave no está escrita aquí: solo su huella SHA-256 (ADMIN_HASH).
 */
const HOJA = 'Registros';
const ADMIN_HASH = 'c89f5b9a70ba2c6a7cf6c8257bad16a6d480f30e1366afcf910a65deea93423e';
const CAMPOS = ['id','creado','nombre','rut','cargo','supervisor','turno','actividad','area','fecha','inicio','fin','horas','solicitanteTeck','estado','autorizadoPor','fechaAutorizacion','observacion','actualizado'];
const TITULOS = ['ID','Fecha creación','Nombre trabajador','RUT','Cargo','Supervisor a cargo','Turno','Actividad','Área','Fecha','Hora inicio','Hora término','Total horas','Solicitante Teck','Estado','Autorizado por','Fecha autorización','Observación','Última actualización'];

function hoja_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(HOJA);
  if (!sh) {
    const primera = ss.getSheets()[0];
    if (primera && primera.getLastRow() === 0) { sh = primera; sh.setName(HOJA); }
    else sh = ss.insertSheet(HOJA);
    sh.getRange(1, 1, 1, TITULOS.length).setValues([TITULOS]).setFontWeight('bold').setBackground('#E88A0F').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@'); // todo como texto para no deformar fechas/horas/RUT
  }
  return sh;
}

function leer_() {
  const sh = hoja_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, CAMPOS.length).getDisplayValues().map(function (row, i) {
    const o = { _fila: i + 2 };
    CAMPOS.forEach(function (c, j) { o[c] = row[j]; });
    return o;
  });
}

/** Ejecutar una vez desde el editor (botón ▶ con "preparar" seleccionado) para crear los encabezados y autorizar permisos. */
function preparar() { hoja_(); }

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function esAdmin_(key) {
  if (!key) return false;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(key), Utilities.Charset.UTF_8);
  const hex = bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  return hex === ADMIN_HASH;
}

// La lectura de datos ya no se permite por GET (sería pública).
function doGet(e) {
  return json_({ ok: true, servicio: 'Horas Extras CDA' });
}

function limpiaRut_(r) { return String(r || '').replace(/[^0-9kK]/g, '').toUpperCase(); }
function min_(h) { const p = String(h).split(':'); return (+p[0]) * 60 + (+p[1]); }
function intervalo_(r) {
  const base = Date.parse(r.fecha + 'T00:00:00Z') / 60000;
  const a = base + min_(r.inicio); let b = base + min_(r.fin);
  if (b <= a) b += 1440;
  return [a, b];
}
function traslape_(x, y) {
  if (limpiaRut_(x.rut) !== limpiaRut_(y.rut)) return false;
  const a = intervalo_(x), b = intervalo_(y);
  return a[0] < b[1] && b[0] < a[1];
}
function fila_(r) { return CAMPOS.map(function (c) { return r[c] == null ? '' : String(r[c]); }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const admin = esAdmin_(body.key);

    if (body.action === 'login') return json_({ ok: admin, error: admin ? '' : 'Clave incorrecta' });

    if (body.action === 'list') {
      if (!admin) return json_({ ok: false, error: 'No autorizado' });
      return json_({ ok: true, records: leer_().map(function (r) { delete r._fila; return r; }) });
    }

    if (body.action === 'delete') {
      if (!admin) return json_({ ok: false, error: 'No autorizado' });
      const ids = {}; (body.ids || []).forEach(function (id) { ids[id] = true; });
      const sh = hoja_();
      const filas = leer_().filter(function (r) { return ids[r.id]; }).map(function (r) { return r._fila; }).sort(function (a, b) { return b - a; });
      filas.forEach(function (f) { sh.deleteRow(f); });
      return json_({ ok: true, eliminados: filas.length });
    }

    if (body.action !== 'upsert' || !Array.isArray(body.records)) return json_({ ok: false, error: 'Acción no válida' });
    const sh = hoja_();
    const existentes = leer_();
    const porId = {};
    existentes.forEach(function (r) { porId[r.id] = r; });
    const duplicados = [], ignorados = [];
    const ahora = new Date().toISOString();

    body.records.forEach(function (r) {
      if (!r.id) return;
      r.actualizado = ahora;
      const previo = porId[r.id];
      if (previo) {
        if (!admin) { ignorados.push(r.id); return; } // solo el administrador modifica registros existentes
        sh.getRange(previo._fila, 1, 1, CAMPOS.length).setValues([fila_(r)]);
      } else {
        if (!admin) { r.estado = 'Pendiente'; r.autorizadoPor = ''; r.fechaAutorizacion = ''; }
        // Control de duplicados en el servidor (ej. dos celulares offline con la misma hora)
        const choque = existentes.filter(function (x) { return x.estado !== 'Rechazado' && traslape_(x, r); })[0];
        if (choque && r.estado === 'Pendiente') {
          r.observacion = ('POSIBLE DUPLICADO con registro ' + choque.id + ' (' + choque.fecha + ' ' + choque.inicio + '-' + choque.fin + '). ' + (r.observacion || '')).trim();
          duplicados.push(r.id);
        }
        sh.appendRow(fila_(r));
        r._fila = sh.getLastRow();
        existentes.push(r);
        porId[r.id] = r;
      }
    });
    return json_({ ok: true, duplicados: duplicados, ignorados: ignorados });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
