/* Horas Extras CDA – Rentamaq
 * Funciona offline: los registros se guardan en el celular (localStorage) y,
 * si hay una planilla central configurada, se sincronizan al recuperar conexión.
 */
(function () {
  "use strict";

  const KEY_REG = "hhee_registros_v1";
  const KEY_PERFIL = "hhee_perfil_v1";
  const KEY_URL = "hhee_endpoint_v1";
  const KEY_AUTORIZA = "hhee_autoriza_v1";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ---------- Almacenamiento ----------
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { toast("No se pudo guardar en este equipo", true); return false; } },
  };
  let registros = store.get(KEY_REG, []);
  const guardar = () => store.set(KEY_REG, registros);

  function endpoint() {
    let u = "";
    try { u = localStorage.getItem(KEY_URL) || ""; } catch {}
    return (u || (window.HHEE_CONFIG && window.HHEE_CONFIG.endpoint) || "").trim();
  }

  // ---------- Utilidades ----------
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const ahoraISO = () => new Date().toISOString();
  const fmtFechaHora = (iso) => iso ? new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "";
  const fmtFecha = (f) => f ? f.split("-").reverse().join("-") : "";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

  const aMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  // Intervalo absoluto en minutos (soporta turnos que cruzan medianoche)
  function intervalo(r) {
    const base = Date.parse(r.fecha + "T00:00:00Z") / 60000;
    const ini = base + aMin(r.inicio);
    let fin = base + aMin(r.fin);
    if (fin <= ini) fin += 24 * 60;
    return [ini, fin];
  }
  function horas(r) { const [a, b] = intervalo(r); return Math.round(((b - a) / 60) * 100) / 100; }
  const fmtHoras = (h) => h.toLocaleString("es-CL", { maximumFractionDigits: 2 }) + " h";

  function seTraslapan(a, b) {
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
  function mostrarHoras(fs) {
    const ini = fs.querySelector('[name="inicio"]').value, fin = fs.querySelector('[name="fin"]').value;
    const p = fs.querySelector(".horas");
    if (ini && fin) {
      const h = horas({ fecha: "2000-01-01", inicio: ini, fin });
      p.textContent = "Total: " + fmtHoras(h) + (aMin(fin) <= aMin(ini) ? " (termina al día siguiente)" : "");
    } else p.textContent = "";
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
    toast(nuevos.length === 1 ? "Solicitud guardada" : `${nuevos.length} registros guardados`);
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

  // ---------- Pestañas ----------
  $$(".tab").forEach((b) => b.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("active", x === b));
    $$(".panel").forEach((p) => (p.hidden = p.id !== "tab-" + b.dataset.tab));
    if (b.dataset.tab === "registros") { render(); sincronizar(); }
  }));

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
    const lista = filtrados();
    const pend = registros.filter((r) => r.estado === "Pendiente").length;
    const b = $("#pendCount"); b.hidden = !pend; b.textContent = pend;
    const totH = lista.reduce((s, r) => s + (r.estado === "Aprobado" ? r.horas : 0), 0);
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
          ${r.autorizadoPor ? `<div class="autoriza">${r.estado === "Aprobado" ? "Autorizó" : "Rechazó"}: <strong>${esc(r.autorizadoPor)}</strong><br>${fmtFechaHora(r.fechaAutorizacion)}</div>` : ""}
          ${r._dirty ? `<span class="nosync">● pendiente de envío</span>` : ""}
        </div>
      </article>`).join("");
  }

  ["#buscar", "#filtroEstado", "#filtroDesde", "#filtroHasta"].forEach((s) => $(s).addEventListener("input", render));

  let decision = null;
  $("#lista").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-acc]"); if (!btn) return;
    const id = btn.closest(".reg").dataset.id;
    const r = registros.find((x) => x.id === id); if (!r) return;
    decision = { id, estado: btn.dataset.acc };
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

  // ---------- Exportar a Excel ----------
  const COLUMNAS = [
    ["ID", "id"], ["Fecha creación", (r) => fmtFechaHora(r.creado)],
    ["Nombre trabajador", "nombre"], ["RUT", "rut"], ["Cargo", "cargo"], ["Supervisor a cargo", "supervisor"], ["Turno", "turno"],
    ["Actividad", "actividad"], ["Área", "area"], ["Fecha", (r) => fmtFecha(r.fecha)], ["Hora inicio", "inicio"], ["Hora término", "fin"],
    ["Total horas", "horas"], ["Solicitante Teck", "solicitanteTeck"],
    ["Estado", "estado"], ["Autorizado por", "autorizadoPor"], ["Fecha autorización", (r) => fmtFechaHora(r.fechaAutorizacion)], ["Observación", "observacion"],
  ];
  const fila = (r) => COLUMNAS.map(([, k]) => (typeof k === "function" ? k(r) : r[k] ?? ""));

  $("#btnExcel").addEventListener("click", () => {
    const lista = filtrados().slice().reverse();
    if (!lista.length) { toast("No hay registros para exportar", true); return; }
    const nombre = "HorasExtras_CDA_" + new Date().toISOString().slice(0, 10);
    if (window.XLSX) {
      const ws = XLSX.utils.aoa_to_sheet([COLUMNAS.map((c) => c[0]), ...lista.map(fila)]);
      ws["!cols"] = COLUMNAS.map(([t]) => ({ wch: Math.max(12, t.length + 2) }));
      ws["!autofilter"] = { ref: ws["!ref"] };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Horas extras");
      const resumen = {};
      lista.filter((r) => r.estado === "Aprobado").forEach((r) => { const k = r.rut + "|" + r.nombre; resumen[k] = (resumen[k] || 0) + r.horas; });
      const ws2 = XLSX.utils.aoa_to_sheet([["RUT", "Nombre", "Horas aprobadas"], ...Object.entries(resumen).map(([k, h]) => [...k.split("|"), h])]);
      ws2["!cols"] = [{ wch: 14 }, { wch: 30 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Resumen aprobadas");
      XLSX.writeFile(wb, nombre + ".xlsx");
    } else {
      // Respaldo sin conexión: CSV que Excel abre directamente
      const csv = [COLUMNAS.map((c) => c[0]), ...lista.map(fila)]
        .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
      a.download = nombre + ".csv"; a.click(); URL.revokeObjectURL(a.href);
    }
  });

  // ---------- Sincronización con planilla central ----------
  let sincronizando = false;
  async function sincronizar(manual = false) {
    const url = endpoint();
    const pendientes = registros.filter((r) => r._dirty).length;
    estadoSync(pendientes);
    if (!url) { if (manual) toast("Sin planilla central configurada (ver Configuración)", true); return; }
    if (!navigator.onLine) { if (manual) toast("Sin conexión: se enviará al volver la señal", true); return; }
    if (sincronizando) return;
    sincronizando = true; $("#syncStatus").hidden = false; $("#syncStatus").textContent = "Sincronizando…";
    try {
      const sucios = registros.filter((r) => r._dirty).map(({ _dirty, ...r }) => r);
      if (sucios.length) {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "upsert", records: sucios }) });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || "Error al guardar");
        const enviados = new Set(sucios.map((r) => r.id));
        registros.forEach((r) => { if (enviados.has(r.id)) delete r._dirty; });
      }
      const res2 = await fetch(url + (url.includes("?") ? "&" : "?") + "action=list&t=" + Date.now());
      const j2 = await res2.json();
      if (j2.ok && Array.isArray(j2.records)) {
        const locales = new Map(registros.map((r) => [r.id, r]));
        const hhmm = (t) => { const m = String(t || "").match(/^(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, "0") + ":" + m[2] : String(t || ""); };
        const remotos = j2.records.map((r) => ({ ...r, inicio: hhmm(r.inicio), fin: hhmm(r.fin), horas: Number(String(r.horas).replace(",", ".")) || 0 }));
        const ids = new Set(remotos.map((r) => r.id));
        registros = remotos.map((r) => (locales.get(r.id) && locales.get(r.id)._dirty ? locales.get(r.id) : r))
          .concat(registros.filter((r) => !ids.has(r.id) && r._dirty));
      }
      guardar(); aprenderSugerencias(); render();
      if (manual) toast("Sincronizado con la planilla central");
    } catch (err) {
      console.error(err);
      if (manual) toast("No se pudo sincronizar: " + err.message, true);
    } finally {
      sincronizando = false; estadoSync(registros.filter((r) => r._dirty).length);
    }
  }
  function estadoSync(n) {
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

  // ---------- Configuración ----------
  $("#btnConfig").addEventListener("click", () => { $("#cfgUrl").value = endpoint(); $("#dlgConfig").returnValue = ""; $("#dlgConfig").showModal(); });
  $("#dlgConfig").addEventListener("close", () => {
    if ($("#dlgConfig").returnValue !== "ok") return;
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
