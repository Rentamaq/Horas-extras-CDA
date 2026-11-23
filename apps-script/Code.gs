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
// Quienes reciben el aviso por correo de cada nueva solicitud
const DESTINATARIOS = ['rluna@rentamaq.cl', 'mnavarro@rentamaq.cl', 'gbonilla@rentamaq.cl'];
const URL_PAGINA = 'https://rentamaq.github.io/Horas-extras-CDA/';
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
// ---------- Aviso por correo de nuevas solicitudes ----------
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function fecha_(f) { return f ? String(f).split('-').reverse().join('-') : ''; }

function notificar_(recs) {
  try {
    // Un correo por trabajador (una solicitud puede traer varias actividades)
    const grupos = {};
    recs.forEach(function (r) { const k = limpiaRut_(r.rut) || r.nombre; (grupos[k] = grupos[k] || []).push(r); });
    Object.keys(grupos).forEach(function (k) {
      const g = grupos[k], p = g[0];
      const total = g.reduce(function (s, r) { return s + (Number(String(r.horas).replace(',', '.')) || 0); }, 0);
      const hayDup = g.some(function (r) { return String(r.observacion || '').indexOf('POSIBLE DUPLICADO') === 0; });
      const td = 'style="padding:8px 10px;border-bottom:1px solid #e5e5e5;font-size:13px;vertical-align:top"';
      const th = 'style="padding:8px 10px;background:#333333;color:#ffffff;font-size:12px;text-align:left"';
      const filas = g.map(function (r) {
        return '<tr><td ' + td + '>' + fecha_(r.fecha) + '</td><td ' + td + '>' + esc_(r.inicio) + ' – ' + esc_(r.fin) +
          '</td><td ' + td + ' align="center"><b>' + esc_(r.horas) + '</b></td><td ' + td + '>' + esc_(r.actividad) +
          '</td><td ' + td + '>' + esc_(r.area) + '</td><td ' + td + '>' + esc_(r.solicitanteTeck) + '</td></tr>' +
          (r.observacion ? '<tr><td colspan="6" style="padding:4px 10px 8px;font-size:12px;color:#C62828">' + esc_(r.observacion) + '</td></tr>' : '');
      }).join('');
      const html =
        '<div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:auto;border:1px solid #dddddd">' +
        '<div style="padding:14px 18px;border-bottom:5px solid #E88A0F"><img src="' + URL_PAGINA + 'img/logo-rentamaq.png" alt="RENTAMAQ" height="34"></div>' +
        '<div style="background:#333333;color:#ffffff;padding:14px 18px;font-size:18px;font-weight:bold">Nueva solicitud de horas extras · CDA</div>' +
        '<div style="padding:16px 18px;color:#222222;font-size:14px">' +
        '<p style="margin:0 0 12px">Se ingresó una solicitud de horas extras que <b>debe revisarse para su aprobación</b>.</p>' +
        (hayDup ? '<p style="margin:0 0 12px;padding:8px 10px;background:#FDECEA;color:#C62828;font-weight:bold">⚠ Atención: el sistema detectó un posible duplicado con otra solicitud.</p>' : '') +
        '<table cellspacing="0" cellpadding="0" style="font-size:14px;margin-bottom:14px">' +
        '<tr><td style="color:#6b6b6b;padding:2px 14px 2px 0">Trabajador</td><td><b>' + esc_(p.nombre) + '</b></td></tr>' +
        '<tr><td style="color:#6b6b6b;padding:2px 14px 2px 0">RUT</td><td>' + esc_(p.rut) + '</td></tr>' +
        '<tr><td style="color:#6b6b6b;padding:2px 14px 2px 0">Cargo</td><td>' + esc_(p.cargo) + '</td></tr>' +
        '<tr><td style="color:#6b6b6b;padding:2px 14px 2px 0">Supervisor</td><td>' + esc_(p.supervisor) + '</td></tr>' +
        '<tr><td style="color:#6b6b6b;padding:2px 14px 2px 0">Turno</td><td>' + esc_(p.turno) + '</td></tr></table>' +
        '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e5e5e5">' +
        '<tr><th ' + th + '>Fecha</th><th ' + th + '>Horario</th><th ' + th + '>Horas</th><th ' + th + '>Actividad</th><th ' + th + '>Área</th><th ' + th + '>Solicita (Teck)</th></tr>' +
        filas + '</table>' +
        '<p style="margin:14px 0 18px;font-size:15px">Total solicitado: <b style="color:#E88A0F">' + total.toLocaleString('es-CL') + ' h</b></p>' +
        '<a href="' + URL_PAGINA + '" style="display:inline-block;background:#E88A0F;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px">Revisar y aprobar</a>' +
        '<p style="margin:16px 0 0;font-size:12px;color:#6b6b6b">Ingrese a la pestaña "Registros y aprobación" con la clave de administrador.</p>' +
        '</div><div style="background:#f3f3f3;padding:10px 18px;font-size:11px;color:#6b6b6b">Rentamaq · Contrato CDA · Aviso automático del sistema de horas extras</div></div>';
      const texto = 'Nueva solicitud de horas extras de ' + p.nombre + ' (' + p.rut + '), ' + g.length + ' registro(s), total ' + total + ' h. Revisar en ' + URL_PAGINA;
      MailApp.sendEmail({
        to: DESTINATARIOS.join(','),
        subject: (hayDup ? '⚠ ' : '') + 'Solicitud de horas extras: ' + p.nombre + ' · ' + fecha_(g[0].fecha) + ' · ' + total.toLocaleString('es-CL') + ' h',
        body: texto, htmlBody: html, name: 'Horas Extras CDA · Rentamaq',
      });
    });
  } catch (err) {
    console.error('No se pudo enviar el aviso: ' + err); // el registro igual queda guardado
  }
}

/** Ejecutar una vez desde el editor para autorizar el envío de correos y recibir un aviso de prueba. */
function probarCorreo() {
  notificar_([{ id: 'prueba', nombre: 'PRUEBA – no aprobar', rut: '1-9', cargo: 'Prueba', supervisor: 'Prueba', turno: 'Turno A',
    actividad: 'Correo de prueba del sistema de horas extras', area: 'Taller', fecha: Utilities.formatDate(new Date(), 'America/Santiago', 'yyyy-MM-dd'),
    inicio: '20:00', fin: '22:00', horas: 2, solicitanteTeck: 'Prueba', estado: 'Pendiente', observacion: '' }]);
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
    const duplicados = [], ignorados = [], nuevos = [];
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
        if (r.estado === 'Pendiente') nuevos.push(r);
      }
    });
    if (nuevos.length) notificar_(nuevos);
    return json_({ ok: true, duplicados: duplicados, ignorados: ignorados });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
