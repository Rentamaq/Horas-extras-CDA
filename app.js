/* Horas Extras CDA – Rentamaq
 * Funciona offline: los registros se guardan en el celular (localStorage) y,
 * si hay una planilla central configurada, se sincronizan al recuperar conexión.
 * La pestaña "Registros y aprobación" es solo para el administrador (clave).
 */
(function () {
  "use strict";

  const KEY_REG = "hhee_registros_v1";
  const KEY_PERFIL = "hhee_perfil_v1";
  const KEY_URL = "hhee_endpoint_v1";
  const KEY_AUTORIZA = "hhee_autoriza_v1";
  const KEY_ADMIN = "hhee_admin_v1"; // sessionStorage: se borra al cerrar la pestaña
  // SHA-256 de la clave de administrador (la clave no se guarda en el código)
  const ADMIN_HASH = "c89f5b9a70ba2c6a7cf6c8257bad16a6d480f30e1366afcf910a65deea93423e";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ---------- Almacenamiento ----------
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { toast("No se pudo guardar en este equipo", true); return false; } },
  };
  let registros = store.get(KEY_REG, []);
  let eliminados = store.get("hhee_eliminados_v1", []); // ids a borrar en la planilla central
  const guardar = () => { store.set(KEY_REG, registros); store.set("hhee_eliminados_v1", eliminados); };

  function endpoint() {
    let u = "";
    try { u = localStorage.getItem(KEY_URL) || ""; } catch {}
    return (u || (window.HHEE_CONFIG && window.HHEE_CONFIG.endpoint) || "").trim();
  }

  // ---------- Sesión de administrador ----------
  function claveAdmin() { try { return sessionStorage.getItem(KEY_ADMIN) || ""; } catch { return ""; } }
  const esAdmin = () => !!claveAdmin();
  async function sha256(txt) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function actualizarAdminUI() {
    const a = esAdmin();
    $("#candado").textContent = a ? "🔓" : "🔒";
    $("#btnConfig").hidden = !a;
    const pend = registros.filter((r) => r.estado === "Pendiente").length;
    $("#pendCount").hidden = !a || !pend; $("#pendCount").textContent = pend;
  }

  // ---------- Utilidades ----------
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const ahoraISO = () => new Date().toISOString();
  const fmtFechaHora = (iso) => iso ? new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "";
  const fmtFecha = (f) => f ? f.split("-").reverse().join("-") : "";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hhmm = (t) => { const m = String(t || "").match(/^(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, "0") + ":" + m[2] : String(t || ""); };

  function limpiarRut(r) { return String(r || "").replace(/[^0-9kK]/g, "").toUpperCase(); }
  function formatearRut(r) {
    const c = limpiarRut(r); if (c.length < 2) return c;
    const cuerpo = c.slice(0, -1), dv = c.slice(-1);
    return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + dv;
  }
  function rutValido(r) {
    const c = limpiarRut(r); if (c.length < 2) return false;
    const cuerpo = c.slice(0, -1), dv = c.slice(-1);
    if (!/^\d+$/.test(cuerpo)) return false;
    let suma = 0, m = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) { suma += +cuerpo[i] * m; m = m === 7 ? 2 : m + 1; }
    const res = 11 - (suma % 11);
    const esperado = res === 11 ? "0" : res === 10 ? "K" : String(res);
    return dv === esperado;
  }

  const aMin = (t) => { const [h, m] = hhmm(t).split(":").map(Number); return h * 60 + m; };
  // Intervalo absoluto en minutos (soporta turnos que cruzan medianoche)
  function intervalo(r) {
    const base = Date.parse(r.fecha + "T00:00:00Z") / 60000;
    const ini = base + aMin(r.inicio);
    let fin = base + aMin(r.fin);
    if (fin <= ini) fin += 24 * 60;
    return [ini, fin];
  }
  function horas(r) { const [a, b] = intervalo(r); return Math.round(((b - a) / 60) * 100) / 100; }
  const fmtHoras = (h) => (Number(h) || 0).toLocaleString("es-CL", { maximumFractionDigits: 2 }) + " h";

  function seTraslapan(a, b) {
    if (a.id && a.id === b.id) return false;
    if (limpiarRut(a.rut) !== limpiarRut(b.rut)) return false;
    const [a1, a2] = intervalo(a), [b1, b2] = intervalo(b);
    return a1 < b2 && b1 < a2;
  }

  function toast(msg, err = false) {
    const t = $("#toast");
    t.textContent = msg; t.className = "show" + (err ? " err" : "");
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = err ? "err" : ""), 3800);
  }

  // ---------- Formulario ----------
  const lineas = $("#lineas");
  function agregarLinea() {
    const n = $("#tpl-linea").content.cloneNode(true);
    const fs = n.querySelector("fieldset");
    fs.querySelector('[name="fecha"]').value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    fs.querySelector(".quitar").addEventListener("click", () => { fs.remove(); numerar(); });
    fs.addEventListener("input", () => mostrarHoras(fs));
    lineas.appendChild(n);
    numerar();
  }
  function numerar() { $$(".linea", lineas).forEach((fs, i, arr) => { fs.querySelector(".n").textContent = arr.length > 1 ? "#" + (i + 1) : ""; }); }
  function textoHoras(ini, fin) {
    if (!ini || !fin) return "";
    const h = horas({ fecha: "2000-01-01", inicio: ini, fin });
    return "Total: " + fmtHoras(h) + (aMin(fin) <= aMin(ini) ? " (termina al día siguiente)" : "");
  }
  function mostrarHoras(fs) {
    fs.querySelector(".horas").textContent = textoHoras(fs.querySelector('[name="inicio"]').value, fs.querySelector('[name="fin"]').value);
  }

  // Perfil recordado
  const perfil = store.get(KEY_PERFIL, null);
  if (perfil) for (const k of ["nombre", "rut", "cargo", "supervisor", "turno"]) { const el = $(`#form [name="${k}"]`); if (el && perfil[k]) el.value = perfil[k]; }

  $('#form [name="rut"]').addEventListener("blur", (e) => { e.target.value = formatearRut(e.target.value); });
  $("#addLinea").addEventListener("click", agregarLinea);
  agregarLinea();

  $("#form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    $$(".invalid", f).forEach((x) => x.classList.remove("invalid"));
    let ok = true;
    $$("[required]", f).forEach((el) => { if (!el.value.trim()) { el.classList.add("invalid"); ok = false; } });
    const rutEl = f.rut;
    if (rutEl.value && !rutValido(rutEl.value)) { rutEl.classList.add("invalid"); toast("El RUT no es válido", true); rutEl.focus(); return; }
    if (!ok) { toast("Completa todos los campos marcados", true); $(".invalid", f).focus(); return; }

    const cab = {
      nombre: f.nombre.value.trim(), rut: formatearRut(rutEl.value), cargo: f.cargo.value.trim(),
      supervisor: f.supervisor.value.trim(), turno: f.turno.value.trim(),
    };
    const nuevos = $$(".linea", lineas).map((fs) => {
      const v = (n) => fs.querySelector(`[name="${n}"]`).value.trim();
      const r = {
        id: uid(), creado: ahoraISO(), ...cab,
        actividad: v("actividad"), area: v("area"), fecha: v("fecha"), inicio: v("inicio"), fin: v("fin"),
        solicitanteTeck: v("solicitanteTeck"),
        estado: "Pendiente", autorizadoPor: "", fechaAutorizacion: "", observacion: "",
        _dirty: true,
      };
      r.horas = horas(r);
      return r;
    });

    // Control de duplicados (contra lo existente y dentro de la misma solicitud)
    const vigentes = registros.filter((r) => r.estado !== "Rechazado");
    for (let i = 0; i < nuevos.length; i++) {
      const n = nuevos[i];
      if (n.horas <= 0) { toast("Revisa las horas del registro #" + (i + 1), true); return; }
      const choque = vigentes.find((r) => seTraslapan(r, n)) || nuevos.slice(0, i).find((r) => seTraslapan(r, n));
      if (choque) {
        const fs = $$(".linea", lineas)[i];
        ["fecha", "inicio", "fin"].forEach((k) => fs.querySelector(`[name="${k}"]`).classList.add("invalid"));
        toast(`Duplicado: ${cab.nombre} ya tiene horas el ${fmtFecha(choque.fecha)} de ${choque.inicio} a ${choque.fin} (${choque.estado})`, true);
        fs.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }

    registros = registros.concat(nuevos);
    guardar();
    if ($("#recordar").checked) store.set(KEY_PERFIL, cab); else { try { localStorage.removeItem(KEY_PERFIL); } catch {} }
    aprenderSugerencias();

    // Limpiar líneas, conservar encabezado
    lineas.innerHTML = ""; agregarLinea();
    toast(nuevos.length === 1 ? "Solicitud enviada" : `${nuevos.length} registros enviados`);
    render();
    sincronizar();
  });

  // ---------- Sugerencias (autocompletar) ----------
  function aprenderSugerencias() {
    const sets = { "dl-cargo": "cargo", "dl-supervisor": "supervisor", "dl-area": "area", "dl-teck": "solicitanteTeck" };
    for (const [id, campo] of Object.entries(sets)) {
      const vals = [...new Set(registros.map((r) => r[campo]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
      $("#" + id).innerHTML = vals.map((v) => `<option value="${esc(v)}">`).join("");
    }
  }

  // ---------- Pestañas (registros bloqueado con clave) ----------
  function mostrarTab(nombre) {
    $$(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === nombre));
    $$(".panel").forEach((p) => (p.hidden = p.id !== "tab-" + nombre));
    if (nombre === "registros") { render(); sincronizar(); }
  }
  $$(".tab").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.tab === "registros" && !esAdmin()) {
      $("#loginClave").value = ""; $("#loginError").hidden = true;
      $("#dlgLogin").returnValue = ""; $("#dlgLogin").showModal(); $("#loginClave").focus();
      return;
    }
    mostrarTab(b.dataset.tab);
  }));

  $("#formLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const clave = $("#loginClave").value;
    if ((await sha256(clave)) !== ADMIN_HASH) {
      $("#loginError").hidden = false; $("#loginClave").select(); return;
    }
    try { sessionStorage.setItem(KEY_ADMIN, clave); } catch {}
    $("#dlgLogin").close("ok");
    actualizarAdminUI();
    mostrarTab("registros");
    toast("Sesión de administrador iniciada");
  });

  $("#btnSalir").addEventListener("click", () => {
    try { sessionStorage.removeItem(KEY_ADMIN); } catch {}
    actualizarAdminUI();
    mostrarTab("solicitud");
    toast("Sesión cerrada");
  });

  // ---------- Listado y aprobación ----------
  function filtrados() {
    const q = $("#buscar").value.trim().toLowerCase();
    const est = $("#filtroEstado").value, d = $("#filtroDesde").value, h = $("#filtroHasta").value;
    return registros
      .filter((r) => !est || r.estado === est)
      .filter((r) => !d || r.fecha >= d)
      .filter((r) => !h || r.fecha <= h)
      .filter((r) => !q || [r.nombre, r.rut, r.cargo, r.area, r.actividad, r.supervisor, r.solicitanteTeck, r.autorizadoPor].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (b.fecha + b.inicio).localeCompare(a.fecha + a.inicio));
  }

  function render() {
    actualizarAdminUI();
    if (!esAdmin()) { $("#lista").innerHTML = ""; $("#resumen").textContent = ""; return; }
    const lista = filtrados();
    const totH = lista.reduce((s, r) => s + (r.estado === "Aprobado" ? Number(r.horas) || 0 : 0), 0);
    $("#resumen").textContent = `${lista.length} registro(s) · ${fmtHoras(totH)} aprobadas en la vista`;

    if (!lista.length) { $("#lista").innerHTML = `<div class="vacio card">No hay registros${registros.length ? " con esos filtros" : " todavía"}.</div>`; return; }

    $("#lista").innerHTML = lista.map((r) => `
      <article class="reg ${esc(r.estado)}" data-id="${esc(r.id)}">
        <div>
          <h3>${esc(r.nombre)} <span class="meta">· ${esc(r.rut)} · ${esc(r.cargo)}</span></h3>
          <div class="meta">${fmtFecha(r.fecha)} · ${esc(r.inicio)}–${esc(r.fin)} · <strong>${fmtHoras(r.horas)}</strong> · Turno ${esc(r.turno)}</div>
          <dl>
            <dt>Actividad</dt><dd>${esc(r.actividad)}</dd>
            <dt>Área</dt><dd>${esc(r.area)}</dd>
            <dt>Supervisor</dt><dd>${esc(r.supervisor)}</dd>
            <dt>Solicita (Teck)</dt><dd>${esc(r.solicitanteTeck)}</dd>
            ${r.observacion ? `<dt>Obs.</dt><dd>${esc(r.observacion)}</dd>` : ""}
          </dl>
        </div>
        <div class="lado">
          <span class="estado ${esc(r.estado)}">${esc(r.estado)}</span>
          <div class="aprob">
            <button class="btn btn-aprobar" data-acc="Aprobado" ${r.estado === "Aprobado" ? "disabled" : ""}>✔ Aprobado</button>
            <button class="btn btn-rechazar" data-acc="Rechazado" ${r.estado === "Rechazado" ? "disabled" : ""}>✖ No aprobado</button>
          </div>
          <button class="btn btn-editar" data-editar>✎ Editar</button>
          ${r.autorizadoPor ? `<div class="autoriza">${r.estado === "Rechazado" ? "Rechazó" : "Autorizó"}: <strong>${esc(r.autorizadoPor)}</strong><br>${fmtFechaHora(r.fechaAutorizacion)}</div>` : ""}
          ${r._dirty ? `<span class="nosync">● pendiente de envío</span>` : ""}
        </div>
      </article>`).join("");
  }

  ["#buscar", "#filtroEstado", "#filtroDesde", "#filtroHasta"].forEach((s) => $(s).addEventListener("input", render));

  let decision = null;
  $("#lista").addEventListener("click", (e) => {
    if (!esAdmin()) return;
    const card = e.target.closest(".reg"); if (!card) return;
    const r = registros.find((x) => x.id === card.dataset.id); if (!r) return;
    if (e.target.closest("[data-editar]")) { abrirEditor(r); return; }
    const btn = e.target.closest("button[data-acc]"); if (!btn) return;
    decision = { id: r.id, estado: btn.dataset.acc };
    const aprobar = decision.estado === "Aprobado";
    $("#dlgTitulo").textContent = aprobar ? "Aprobar horas extras" : "No aprobar horas extras";
    $("#dlgOk").textContent = aprobar ? "Confirmar aprobación" : "Confirmar rechazo";
    $("#dlgOk").className = "btn " + (aprobar ? "btn-aprobar" : "btn-rechazar");
    $("#dlgDetalle").textContent = `${r.nombre} · ${fmtFecha(r.fecha)} ${r.inicio}–${r.fin} (${fmtHoras(r.horas)}) · ${r.actividad}`;
    $("#autorizaNombre").value = store.get(KEY_AUTORIZA, "");
    $("#autorizaObs").value = "";
    $("#dlgAprobar").returnValue = "";
    $("#dlgAprobar").showModal();
    $("#autorizaNombre").focus();
  });

  $("#dlgAprobar").addEventListener("close", () => {
    const dlg = $("#dlgAprobar");
    if (dlg.returnValue !== "ok" || !decision) { decision = null; return; }
    const nombre = $("#autorizaNombre").value.trim();
    if (!nombre) { toast("Debes ingresar el nombre de quien autoriza", true); decision = null; return; }
    const r = registros.find((x) => x.id === decision.id);
    if (r) {
      r.estado = decision.estado;
      r.autorizadoPor = nombre;
      r.fechaAutorizacion = ahoraISO();
      const obs = $("#autorizaObs").value.trim();
      if (obs) r.observacion = obs;
      r._dirty = true;
      guardar();
      store.set(KEY_AUTORIZA, nombre);
      toast(r.estado === "Aprobado" ? "Solicitud aprobada" : "Solicitud no aprobada");
      render();
      sincronizar();
    }
    decision = null;
  });
  $("#dlgAprobar").addEventListener("cancel", () => { decision = null; });

  // ---------- Edición completa (administrador) ----------
  const CAMPOS_EDIT = ["nombre", "rut", "cargo", "supervisor", "turno", "area", "actividad", "fecha", "solicitanteTeck", "inicio", "fin", "estado", "autorizadoPor", "observacion"];
  let editandoId = null;
  const fe = $("#formEditar");
  function abrirEditor(r) {
    editandoId = r.id;
    CAMPOS_EDIT.forEach((k) => { fe.elements[k].value = k === "inicio" || k === "fin" ? hhmm(r[k]) : (r[k] ?? ""); fe.elements[k].classList.remove("invalid"); });
    $("#editHoras").textContent = textoHoras(fe.elements.inicio.value, fe.elements.fin.value);
    $("#dlgEditar").returnValue = "";
    $("#dlgEditar").showModal();
  }
  fe.addEventListener("input", () => { $("#editHoras").textContent = textoHoras(fe.elements.inicio.value, fe.elements.fin.value); });
  fe.elements.rut.addEventListener("blur", (e) => { e.target.value = formatearRut(e.target.value); });

  fe.addEventListener("submit", (e) => {
    e.preventDefault();
    const r = registros.find((x) => x.id === editandoId); if (!r) return;
    let ok = true;
    $$("[required]", fe).forEach((el) => { const v = !el.value.trim(); el.classList.toggle("invalid", v); if (v) ok = false; });
    if (!ok) { toast("Completa los campos marcados", true); return; }
    if (!rutValido(fe.elements.rut.value)) { fe.elements.rut.classList.add("invalid"); toast("El RUT no es válido", true); return; }
    const nuevo = { ...r };
    CAMPOS_EDIT.forEach((k) => { nuevo[k] = fe.elements[k].value.trim(); });
    nuevo.rut = formatearRut(nuevo.rut);
    nuevo.horas = horas(nuevo);
    if (nuevo.horas <= 0) { toast("Revisa las horas de inicio y término", true); return; }
    const choque = registros.find((x) => x.estado !== "Rechazado" && seTraslapan(x, nuevo));
    if (choque && nuevo.estado !== "Rechazado" &&
        !confirm(`Este horario se cruza con otro registro de ${choque.nombre} (${fmtFecha(choque.fecha)} ${choque.inicio}–${choque.fin}). ¿Guardar de todas formas?`)) return;
    if (nuevo.estado !== r.estado || nuevo.autorizadoPor !== r.autorizadoPor) {
      nuevo.fechaAutorizacion = nuevo.estado === "Pendiente" ? "" : ahoraISO();
      if (nuevo.estado === "Pendiente") nuevo.autorizadoPor = "";
      else if (!nuevo.autorizadoPor) { fe.elements.autorizadoPor.classList.add("invalid"); toast("Indica quién autoriza", true); return; }
    }
    nuevo._dirty = true;
    Object.assign(r, nuevo);
    guardar();
    $("#dlgEditar").close("ok");
    toast("Registro actualizado");
    aprenderSugerencias(); render(); sincronizar();
  });

  $("#btnEliminar").addEventListener("click", () => {
    const r = registros.find((x) => x.id === editandoId); if (!r) return;
    if (!confirm(`¿Eliminar definitivamente el registro de ${r.nombre} del ${fmtFecha(r.fecha)} (${r.inicio}–${r.fin})?\nSe borrará también de la planilla central.`)) return;
    registros = registros.filter((x) => x.id !== r.id);
    eliminados.push(r.id);
    guardar();
    $("#dlgEditar").close("cancel");
    toast("Registro eliminado");
    render(); sincronizar();
  });

  // ---------- Exportar a Excel con diseño corporativo ----------
  const C = { naranjo: "FFE88A0F", gris: "FF333333", grisTexto: "FF5F5E5F", blanco: "FFFFFFFF", zebra: "FFF7F7F7", borde: "FFD9D9D9", naranjoClaro: "FFFDF1E1",
    ok: "FF2E7D32", okBg: "FFE8F5E9", no: "FFC62828", noBg: "FFFDECEA", pend: "FF8A5A00", pendBg: "FFFFF4DC" };
  const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const bordeFino = { style: "thin", color: { argb: C.borde } };
  const bordes = { top: bordeFino, left: bordeFino, bottom: bordeFino, right: bordeFino };
  const fechaExcel = (ymd) => { if (!ymd) return null; const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fechaHoraExcel = (iso) => { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : new Date(d.getTime() - d.getTimezoneOffset() * 60000); };
  const colLetra = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  function banner(ws, ncols, imgId, titulo, subtitulo, kpis, colTitulo) {
    const ultima = colLetra(ncols);
    ws.getRow(1).height = 34; ws.getRow(2).height = 20; ws.getRow(3).height = 6; ws.getRow(4).height = 24; ws.getRow(5).height = 8;
    ws.addImage(imgId, { tl: { col: 0.2, row: 0.25 }, ext: { width: 250, height: 38 } });
    ws.mergeCells(`${colLetra(colTitulo)}1:${ultima}1`);
    ws.mergeCells(`${colLetra(colTitulo)}2:${ultima}2`);
    const t = ws.getCell(`${colLetra(colTitulo)}1`);
    t.value = titulo; t.font = { name: "Calibri", size: 18, bold: true, color: { argb: C.gris } }; t.alignment = { vertical: "middle", horizontal: "right" };
    const s = ws.getCell(`${colLetra(colTitulo)}2`);
    s.value = subtitulo; s.font = { name: "Calibri", size: 10, color: { argb: C.grisTexto } }; s.alignment = { vertical: "middle", horizontal: "right" };
    for (let c = 1; c <= ncols; c++) ws.getCell(3, c).fill = fill(C.naranjo);
    ws.mergeCells(`A4:${ultima}4`);
    const k = ws.getCell("A4");
    k.value = kpis; k.fill = fill(C.naranjoClaro); k.font = { bold: true, size: 11, color: { argb: C.gris } }; k.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  }
  function encabezados(ws, fila, titulos) {
    const row = ws.getRow(fila);
    row.values = titulos; row.height = 32;
    row.eachCell((c) => {
      c.fill = fill(C.gris); c.font = { bold: true, color: { argb: C.blanco }, size: 10 };
      c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      c.border = { ...bordes, bottom: { style: "medium", color: { argb: C.naranjo } } };
    });
  }
  function estiloEstado(c, estado) {
    const m = { Aprobado: [C.okBg, C.ok], Rechazado: [C.noBg, C.no], Pendiente: [C.pendBg, C.pend] }[estado];
    if (!m) return;
    c.fill = fill(m[0]); c.font = { bold: true, color: { argb: m[1] }, size: 10 }; c.alignment = { horizontal: "center", vertical: "top" };
  }
  function pie(ws, titulo) {
    ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.2 }, printTitlesRow: "6:6" };
    ws.headerFooter = { oddFooter: `&L&8Rentamaq · ${titulo}&R&8Página &P de &N` };
  }

  async function exportarExcel() {
    if (!esAdmin()) return;
    await sincronizar();
    const lista = registros.slice().sort((a, b) => (a.fecha + hhmm(a.inicio) + a.nombre).localeCompare(b.fecha + hhmm(b.inicio) + b.nombre));
    if (!lista.length) { toast("No hay registros para exportar", true); return; }
    const nombreArchivo = "HorasExtras_CDA_" + new Date().toISOString().slice(0, 10);
    if (!window.ExcelJS) { exportarCSV(lista, nombreArchivo); return; }

    const btn = $("#btnExcel"); btn.disabled = true; btn.textContent = "Generando…";
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = "Rentamaq"; wb.created = new Date();
      const logo = await (await fetch("img/logo-rentamaq.png")).arrayBuffer();
      const imgId = wb.addImage({ buffer: logo, extension: "png" });

      const cuenta = (e) => lista.filter((r) => r.estado === e);
      const sumH = (arr) => arr.reduce((s, r) => s + (Number(r.horas) || 0), 0);
      const nf = (n) => n.toLocaleString("es-CL", { maximumFractionDigits: 2 });
      const generado = new Date().toLocaleString("es-CL", { dateStyle: "long", timeStyle: "short" });
      const fechas = lista.map((r) => r.fecha).filter(Boolean).sort();
      const periodo = fechas.length ? `Período ${fmtFecha(fechas[0])} al ${fmtFecha(fechas[fechas.length - 1])}` : "";
      const kpis = `Registros: ${lista.length}     ·     Aprobadas: ${cuenta("Aprobado").length} (${nf(sumH(cuenta("Aprobado")))} h)     ·     ` +
        `Pendientes: ${cuenta("Pendiente").length} (${nf(sumH(cuenta("Pendiente")))} h)     ·     Rechazadas: ${cuenta("Rechazado").length}`;

      // ---- Hoja 1: detalle ----
      const cols = [
        ["N°", 5], ["Fecha", 11], ["Nombre trabajador", 26], ["RUT", 13], ["Cargo", 18], ["Supervisor a cargo", 20], ["Turno", 11],
        ["Actividad", 38], ["Área", 16], ["Hora inicio", 11], ["Hora término", 11], ["Total horas", 11], ["Solicitante Teck", 20],
        ["Estado", 12], ["Autorizado por", 20], ["Fecha autorización", 16], ["Observación", 30], ["Fecha solicitud", 16], ["ID", 12],
      ];
      const ws = wb.addWorksheet("Horas extras", { views: [{ state: "frozen", ySplit: 6, showGridLines: false }] });
      ws.columns = cols.map(([, w]) => ({ width: w }));
      banner(ws, cols.length, imgId, "REGISTRO DE HORAS EXTRAS · CDA", `${periodo}   ·   Generado el ${generado}`, kpis, 6);
      encabezados(ws, 6, cols.map((c) => c[0]));

      lista.forEach((r, i) => {
        const row = ws.addRow([
          i + 1, fechaExcel(r.fecha), r.nombre, r.rut, r.cargo, r.supervisor, r.turno, r.actividad, r.area,
          hhmm(r.inicio), hhmm(r.fin), Number(r.horas) || 0, r.solicitanteTeck, r.estado, r.autorizadoPor,
          fechaHoraExcel(r.fechaAutorizacion), r.observacion, fechaHoraExcel(r.creado), r.id,
        ]);
        row.eachCell({ includeEmpty: true }, (c, n) => {
          c.border = bordes;
          c.font = { size: 10, color: { argb: n === 19 ? "FF9A9A9A" : "FF222222" } };
          c.alignment = { vertical: "top", wrapText: n === 8 || n === 17, horizontal: [1, 2, 4, 7, 10, 11, 12].includes(n) ? "center" : "left" };
          if (i % 2) c.fill = fill(C.zebra);
        });
        row.getCell(2).numFmt = "dd-mm-yyyy";
        row.getCell(12).numFmt = "0.0#";
        row.getCell(16).numFmt = "dd-mm-yyyy hh:mm";
        row.getCell(18).numFmt = "dd-mm-yyyy hh:mm";
        estiloEstado(row.getCell(14), r.estado);
      });
      const ini = 7, fin = 6 + lista.length;
      ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: fin, column: cols.length } };
      const tot = ws.addRow([]);
      ws.mergeCells(`A${tot.number}:K${tot.number}`);
      tot.getCell(1).value = "TOTAL HORAS APROBADAS";
      tot.getCell(12).value = { formula: `SUMIF(N${ini}:N${fin},"Aprobado",L${ini}:L${fin})`, result: sumH(cuenta("Aprobado")) };
      tot.height = 22;
      for (let c = 1; c <= cols.length; c++) {
        const cell = tot.getCell(c);
        cell.fill = fill(C.naranjo); cell.font = { bold: true, color: { argb: C.blanco }, size: 11 };
        cell.alignment = { vertical: "middle", horizontal: c === 1 ? "right" : "center" };
      }
      tot.getCell(12).numFmt = "0.0#";
      pie(ws, "Registro de horas extras CDA");

      // ---- Hoja 2: resumen por trabajador ----
      const grupos = new Map();
      lista.forEach((r) => {
        const k = limpiarRut(r.rut) || r.nombre;
        const g = grupos.get(k) || { nombre: r.nombre, rut: r.rut, cargo: r.cargo, n: 0, a: 0, p: 0, x: 0 };
        g.n++; const h = Number(r.horas) || 0;
        if (r.estado === "Aprobado") g.a += h; else if (r.estado === "Pendiente") g.p += h; else g.x += h;
        grupos.set(k, g);
      });
      const filasRes = [...grupos.values()].sort((a, b) => b.a - a.a || a.nombre.localeCompare(b.nombre, "es"));
      const cols2 = [["N°", 5], ["Nombre trabajador", 30], ["RUT", 14], ["Cargo", 22], ["Solicitudes", 12], ["Horas aprobadas", 14], ["Horas pendientes", 14], ["Horas rechazadas", 14]];
      const ws2 = wb.addWorksheet("Resumen por trabajador", { views: [{ state: "frozen", ySplit: 6, showGridLines: false }] });
      ws2.columns = cols2.map(([, w]) => ({ width: w }));
      banner(ws2, cols2.length, imgId, "RESUMEN DE HORAS EXTRAS", `${periodo}   ·   Generado el ${generado}`, `Trabajadores: ${filasRes.length}     ·     Total aprobado: ${nf(sumH(cuenta("Aprobado")))} h`, 4);
      encabezados(ws2, 6, cols2.map((c) => c[0]));
      filasRes.forEach((g, i) => {
        const row = ws2.addRow([i + 1, g.nombre, g.rut, g.cargo, g.n, g.a, g.p, g.x]);
        row.eachCell({ includeEmpty: true }, (c, n) => {
          c.border = bordes; c.font = { size: 10, bold: n === 6 };
          c.alignment = { vertical: "middle", horizontal: n === 2 || n === 4 ? "left" : "center" };
          if (n >= 6) c.numFmt = "0.0#";
          if (i % 2) c.fill = fill(C.zebra);
        });
        row.getCell(6).font = { size: 10, bold: true, color: { argb: C.ok } };
      });
      const f1 = 7, f2 = 6 + filasRes.length;
      const t2 = ws2.addRow(["", "TOTAL", "", "",
        { formula: `SUM(E${f1}:E${f2})`, result: lista.length },
        { formula: `SUM(F${f1}:F${f2})`, result: sumH(cuenta("Aprobado")) },
        { formula: `SUM(G${f1}:G${f2})`, result: sumH(cuenta("Pendiente")) },
        { formula: `SUM(H${f1}:H${f2})`, result: sumH(cuenta("Rechazado")) }]);
      t2.height = 22;
      t2.eachCell({ includeEmpty: true }, (c, n) => {
        c.fill = fill(C.naranjo); c.font = { bold: true, color: { argb: C.blanco } };
        c.alignment = { vertical: "middle", horizontal: n === 2 ? "left" : "center" };
        if (n >= 6) c.numFmt = "0.0#";
      });
      pie(ws2, "Resumen de horas extras CDA");

      const buf = await wb.xlsx.writeBuffer();
      descargar(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nombreArchivo + ".xlsx");
      toast("Excel descargado");
    } catch (err) {
      console.error(err);
      toast("No se pudo generar el Excel: " + err.message, true);
    } finally {
      btn.disabled = false; btn.textContent = "Descargar Excel";
    }
  }
  function descargar(blob, nombre) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportarCSV(lista, nombre) {
    // Respaldo si la librería de Excel no está disponible (sin conexión la primera vez)
    const tit = ["Fecha", "Nombre", "RUT", "Cargo", "Supervisor", "Turno", "Actividad", "Área", "Inicio", "Término", "Horas", "Solicitante Teck", "Estado", "Autorizado por", "Fecha autorización", "Observación"];
    const filas = lista.map((r) => [fmtFecha(r.fecha), r.nombre, r.rut, r.cargo, r.supervisor, r.turno, r.actividad, r.area, r.inicio, r.fin, String(r.horas).replace(".", ","), r.solicitanteTeck, r.estado, r.autorizadoPor, fmtFechaHora(r.fechaAutorizacion), r.observacion]);
    const csv = [tit, ...filas].map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    descargar(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), nombre + ".csv");
    toast("Sin librería de Excel: se descargó CSV", true);
  }
  $("#btnExcel").addEventListener("click", exportarExcel);

  // ---------- Sincronización con planilla central ----------
  let sincronizando = null;
  async function post(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || "Error de la planilla");
    return j;
  }
  function sincronizar(manual = false) {
    if (sincronizando) return sincronizando;
    sincronizando = sincronizarAhora(manual).finally(() => { sincronizando = null; });
    return sincronizando;
  }
  async function sincronizarAhora(manual) {
    const url = endpoint();
    estadoSync();
    if (!url) { if (manual) toast("Sin planilla central configurada (ver Configuración)", true); return; }
    if (!navigator.onLine) { if (manual) toast("Sin conexión: se enviará al volver la señal", true); return; }
    $("#syncStatus").hidden = false; $("#syncStatus").textContent = "Sincronizando…";
    const key = claveAdmin();
    try {
      const sucios = registros.filter((r) => r._dirty).map(({ _dirty, ...r }) => r);
      if (sucios.length) {
        await post(url, { action: "upsert", key, records: sucios });
        const enviados = new Set(sucios.map((r) => r.id));
        registros.forEach((r) => { if (enviados.has(r.id)) delete r._dirty; });
        guardar();
      }
      if (key && eliminados.length) {
        await post(url, { action: "delete", key, ids: eliminados });
        eliminados = []; guardar();
      }
      if (key) {
        const j = await post(url, { action: "list", key });
        if (Array.isArray(j.records)) {
          const locales = new Map(registros.map((r) => [r.id, r]));
          const borrar = new Set(eliminados);
          const remotos = j.records.filter((r) => !borrar.has(r.id))
            .map((r) => ({ ...r, inicio: hhmm(r.inicio), fin: hhmm(r.fin), horas: Number(String(r.horas).replace(",", ".")) || 0 }));
          const ids = new Set(remotos.map((r) => r.id));
          registros = remotos.map((r) => (locales.get(r.id) && locales.get(r.id)._dirty ? locales.get(r.id) : r))
            .concat(registros.filter((r) => !ids.has(r.id) && r._dirty));
          guardar();
        }
      }
      aprenderSugerencias(); render();
      if (manual) toast("Sincronizado con la planilla central");
    } catch (err) {
      console.error(err);
      if (manual || key) toast("No se pudo sincronizar: " + err.message, true);
    } finally {
      estadoSync();
    }
  }
  function estadoSync() {
    const n = registros.filter((r) => r._dirty).length;
    const s = $("#syncStatus");
    s.hidden = !n; s.textContent = n + " por enviar";
  }
  $("#btnSync").addEventListener("click", () => sincronizar(true));

  function estadoRed() {
    const on = navigator.onLine, p = $("#netStatus");
    p.textContent = on ? "En línea" : "Sin conexión"; p.classList.toggle("off", !on);
  }
  window.addEventListener("online", () => { estadoRed(); sincronizar(); });
  window.addEventListener("offline", estadoRed);
  estadoRed();

  // ---------- Configuración (solo administrador) ----------
  $("#btnConfig").addEventListener("click", () => { if (!esAdmin()) return; $("#cfgUrl").value = endpoint(); $("#dlgConfig").returnValue = ""; $("#dlgConfig").showModal(); });
  $("#dlgConfig").addEventListener("close", () => {
    if ($("#dlgConfig").returnValue !== "ok" || !esAdmin()) return;
    try { localStorage.setItem(KEY_URL, $("#cfgUrl").value.trim()); } catch {}
    toast("Configuración guardada"); sincronizar(true);
  });

  $$(".js-cerrar").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close("cancel")));

  const urlPlanilla = window.HHEE_CONFIG && window.HHEE_CONFIG.planilla;
  if (urlPlanilla) { $("#btnPlanilla").href = urlPlanilla; $("#btnPlanilla").hidden = false; }

  // ---------- Inicio ----------
  aprenderSugerencias();
  render();
  sincronizar();
  setInterval(() => sincronizar(), 5 * 60 * 1000);

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW", e));
  }
})();
