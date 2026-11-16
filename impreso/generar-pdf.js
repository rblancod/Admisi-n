// Genera el cuadernillo imprimible (impreso/cuadernillo-simulacro-admision.pdf) a partir del
// banco de ítems de index.html. Uso: node impreso/generar-pdf.js
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT_PDF = path.join(__dirname, 'cuadernillo-simulacro-admision.pdf');
const OUT_HTML = path.join(__dirname, 'cuadernillo-simulacro.html');

const AREA = { L: 'Lectura', G: 'Lógica', M: 'Matemática' };
// Cortes iguales a los del panel de administrador.
const AREA_CUT = { fuerte: 0.75, aceptable: 0.55 };
const LEVELS = [[0.8, 'Muy buen nivel'], [0.65, 'Buen nivel'], [0.5, 'Nivel intermedio'], [0, 'Nivel bajo']];

// Generador pseudoaleatorio con semilla: el cuadernillo sale igual cada vez.
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
function shuffle(a, r) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Ítems que comparten texto (p. ej. "Texto 1 / Texto 2") viajan juntos.
function units(items) {
  const out = []; let prev = null;
  items.forEach(it => {
    const m = it.q.match(/^(.*?<\/(?:blockquote|div)>)/s); const key = m && m[1].length > 300 ? m[1] : null;
    if (key && prev && prev.key === key) prev.items.push(it); else { prev = { key, items: [it] }; out.push(prev); }
  });
  return out;
}
function pick(items, n, r, exclude = new Set()) {
  const us = shuffle(units(items.filter(i => !exclude.has(i.id))), r), got = [];
  for (const u of us) { if (got.length + u.items.length <= n) got.push(...u.items); if (got.length === n) break; }
  if (got.length < n) throw new Error('No alcanzan los ítems: ' + got.length + ' de ' + n);
  return got.sort((a, b) => a.id - b.id);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ceil = Math.ceil;

function cutTable(test) {
  const rows = ['L', 'G', 'M'].map(a => {
    const n = test.counts[a], f = ceil(n * AREA_CUT.fuerte), ac = ceil(n * AREA_CUT.aceptable);
    return `<tr><th>${AREA[a]}</th><td class="c">____ de ${n}</td><td>${f} o más</td><td>${ac} a ${f - 1}</td><td>${ac - 1} o menos</td></tr>`;
  }).join('');
  return `<table class="cut"><thead><tr><th>Área</th><th class="c">Mis aciertos</th><th>Fuerte</th><th>Aceptable</th><th>Debe mejorar</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function levelTable(n) {
  const b = LEVELS.map(([p]) => ceil(n * p));
  const rng = [`${b[0]} a ${n}`, `${b[1]} a ${b[0] - 1}`, `${b[2]} a ${b[1] - 1}`, `0 a ${b[2] - 1}`];
  return `<table class="cut lvl"><thead><tr><th>Total de aciertos (de ${n})</th>${LEVELS.map(l => `<th>${l[1]}</th>`).join('')}</tr></thead>
    <tbody><tr><td class="c">________</td>${rng.map(x => `<td>${x}</td>`).join('')}</tr></tbody></table>`;
}

function itemHTML(it, num) {
  const short = it.o.every(o => o.replace(/<[^>]+>/g, '').length <= 34);
  return `<article class="item"><div class="num">${num}</div><div class="body"><div class="stem">${it.q}</div>
    <ol class="opts${short ? ' grid' : ''}">${it.o.map((o, k) => `<li><span class="bub">${'ABCD'[k]}</span><span>${o}</span></li>`).join('')}</ol></div></article>`;
}

function answerSheet(test) {
  const per = 15, cols = [];
  for (let c = 0; c < Math.ceil(test.items.length / per); c++) {
    const rows = test.items.slice(c * per, c * per + per).map((it, i) => {
      const n = c * per + i + 1;
      return `<div class="row"><b>${n}</b>${'ABCD'.split('').map(l => `<i>${l}</i>`).join('')}<span class="ar">${AREA[it.a].slice(0, 3)}.</span></div>`;
    }).join('');
    cols.push(`<div class="col">${rows}</div>`);
  }
  return `<section class="page sheet"><div class="eyebrow">${test.short} · Hoja de respuestas</div><h2>Hoja de respuestas</h2>
    <div class="fields"><span>Nombre: <u></u></span><span>Fecha: <u></u></span><span>Hora de inicio: <u></u></span><span>Hora de cierre: <u></u></span></div>
    <p class="hint">Rellene por completo el círculo de la opción elegida. Si cambia de respuesta, tache la anterior con una X. La columna de la derecha indica el área de cada ítem para contar los aciertos al corregir.</p>
    <div class="bubbles">${cols.join('')}</div>
    <h3>Al corregir con el solucionario</h3>
    ${cutTable(test)}
    ${levelTable(test.items.length)}
    <p class="hint">Después, haga el mismo simulacro o una práctica corta en la plataforma para que su avance quede registrado.</p>
  </section>`;
}

function solutions(test) {
  const rows = test.items.map((it, i) => `<tr><td class="n">${i + 1}</td><td class="k">${'ABCD'[it.k]}</td><td class="a">${AREA[it.a]}</td><td>${it.e}</td></tr>`).join('');
  return `<section class="sol"><div class="eyebrow">Solucionario</div><h2>${test.short}: respuestas y explicaciones</h2>
    <div class="keys">${test.items.map((it, i) => `<span><b>${i + 1}</b>${'ABCD'[it.k]}</span>`).join('')}</div>
    <table class="soltb"><thead><tr><th>N.º</th><th>Resp.</th><th>Área</th><th>Por qué</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function testSection(test) {
  let n = 0;
  const parts = ['L', 'G', 'M'].map((a, pi) => {
    const its = test.items.filter(it => it.a === a);
    return `<div class="part"><h3 class="parth">Parte ${pi + 1} · ${AREA[a]} <span>ítems ${n + 1} a ${n + its.length}</span></h3>${its.map(it => itemHTML(it, ++n)).join('')}</div>`;
  }).join('');
  return `<section class="page tcover">
      <div class="eyebrow">Prueba ${test.idx} de 3</div>
      <h1>${test.title}</h1><p class="lead">${test.full}</p>
      <div class="facts"><div><b>${test.items.length}</b><span>ítems</span></div><div><b>1 h 50 min</b><span>tiempo total</span></div><div><b>2 min 26 s</b><span>por ítem, en promedio</span></div></div>
      <table class="mix"><tr><th>Lectura</th><td>${test.counts.L} ítems</td></tr><tr><th>Lógica</th><td>${test.counts.G} ítems</td></tr><tr><th>Matemática</th><td>${test.counts.M} ítems</td></tr></table>
      <h3>Antes de empezar</h3>
      <ul class="rules">
        <li>Separe la hoja de respuestas de esta prueba (está al final de la prueba) y tenga lápiz, borrador y un reloj a la vista.</li>
        <li>No use calculadora ni celular.</li>
        <li>Cada ítem tiene cuatro opciones y solo una es correcta. Conteste todos los ítems, aunque tenga dudas.</li>
        <li>Anote la hora de inicio. Si pasa más de 2 a 3 minutos en un ítem, márquelo, siga adelante y vuelva al final.</li>
        <li>Use el solucionario (al final del cuadernillo) solo cuando haya terminado toda la prueba.</li>
      </ul>
      <p class="note">${test.note}</p>
    </section>
    <section class="test">${parts}<p class="end">Fin de la prueba ${test.short}. Revise su hoja de respuestas y anote la hora de cierre.</p></section>
    ${answerSheet(test)}`;
}


/* Sección "Cómo resolver un ítem": método general y un ejemplo resuelto por área.
   Usa ítems que no caen en ninguna de las tres pruebas. */
function example(it, label, steps, extra) {
  return `<div class="ex"><div class="exh"><span class="eyebrow">${label}</span></div>
    <div class="stem">${it.q}</div>
    <ol class="opts grid">${it.o.map((o, k) => `<li><span class="bub">${'ABCD'[k]}</span><span>${o}</span></li>`).join('')}</ol>
    <div class="think"><b>Cómo se piensa</b><ol>${steps.map(t => `<li>${t}</li>`).join('')}</ol>
    <p class="ans">Respuesta: <b>${'ABCD'[it.k]}</b>${extra ? ' · ' + extra : ''}</p></div></div>`;
}
function howto(B) {
  const by = id => B.find(i => i.id === id);
  return `<section class="page howto">
  <div class="eyebrow">Antes de la primera prueba</div><h2>Cómo resolver un ítem</h2>
  <p>Todos los ítems tienen la misma forma: un enunciado, una pregunta y cuatro opciones, de las cuales solo una es correcta. No se necesita saber datos de memoria: la respuesta siempre se obtiene razonando con lo que da el enunciado. Este método sirve para las tres áreas.</p>
  <ol class="method">
    <li><b>Lea todo el enunciado antes de ver las opciones.</b> Subraye los datos y las palabras clave (<i>no</i>, <i>solo</i>, <i>siempre</i>, <i>más alto que</i>, <i>se opone a</i>…).</li>
    <li><b>Diga con sus palabras qué le preguntan.</b> Muchos errores vienen de responder otra pregunta: por ejemplo, dar un sinónimo cuando piden lo contrario.</li>
    <li><b>Resuelva antes de mirar las opciones.</b> Haga un dibujo, una lista, un orden o una cuenta corta en el margen. Luego busque su resultado entre las opciones.</li>
    <li><b>Descarte.</b> Si no llega a una respuesta, elimine las opciones que contradicen el enunciado. Entre dos que quedan, elija la que se apoya en lo que dice el texto, no en lo que usted supone.</li>
    <li><b>Marque y siga.</b> Si pasa de 2 a 3 minutos, marque su mejor opción, anote el número y vuelva al final. Nunca deje un ítem en blanco: no se resta por error.</li>
  </ol>
  <div class="exwrap"><h3>Ejemplo resuelto · Lectura</h3>
  ${example(by(47), 'Ejemplo', [
    'La pregunta pide las palabras que <b>se oponen</b> a las subrayadas: hay que buscar contrarios, no sinónimos.',
    '<i>Ameno</i> es entretenido, agradable. Su contrario es <i>tedioso</i> (aburrido).',
    '<i>Escéptico</i> es quien duda, quien no cree fácilmente. Su contrario es <i>crédulo</i> (quien cree todo).',
    'Se revisan las opciones: B y D dan palabras que no son contrarios; C dice <i>desconfiado</i>, que es casi lo mismo que escéptico, no lo opuesto. Solo A tiene los dos contrarios.'
  ])}</div>
  <div class="exwrap"><h3>Ejemplo resuelto · Lógica</h3>
  ${example(by(114), 'Ejemplo', [
    'Se piden cinco edificios ordenados del más alto al más bajo. Conviene escribir el orden en el margen e ir colocando cada dato.',
    '<i>P es más alto que Q</i>: P, Q. &nbsp; <i>R es más bajo que Q</i>: P, Q, R.',
    '<i>S es más alto que P</i>: S va primero: S, P, Q, R.',
    '<i>T es más alto que R pero más bajo que Q</i>: T va entre Q y R: S, P, Q, T, R.',
    'De cinco, el del medio es el tercero: Q.'
  ], 'El dibujo en el margen evita tener todo en la cabeza.')}</div>
  <div class="exwrap"><h3>Ejemplo resuelto · Matemática</h3>
  ${example(by(150), 'Ejemplo', [
    'Datos: 1 libro = 150 puntos; 400 puntos = 1 insignia; Pablo tiene 6 insignias y no le sobraron puntos. Pregunta: ¿cuántos libros?',
    'Primero se pasa de insignias a puntos: 6 × 400 = 2400 puntos.',
    'Luego de puntos a libros: 2400 ÷ 150 = 16 libros.',
    'Comprobación: 16 × 150 = 2400 y 2400 ÷ 400 = 6 insignias justas. Coincide.'
  ], 'Resolver primero y buscar después el resultado entre las opciones evita caer en los distractores.')}</div>
  <p class="note">Al corregir, anote junto a cada ítem fallado en cuál paso del método se equivocó: ¿leyó mal la pregunta, se saltó un dato o eligió la opción que “sonaba” bien? Ese es el error que hay que trabajar.</p>
</section>`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  const B = await page.evaluate(() => B);
  const r = rng(20261116);
  const by = (u, a) => B.filter(it => u.includes(it.u) && it.a === a);

  // UCR y UNA: misma PAA, ítems P/X. Se reparten para que casi no se repitan.
  const ucr = { L: pick(by('P', 'L'), 21, r), G: pick(by('X', 'G'), 12, r), M: pick(by('X', 'M'), 12, r) };
  const used = new Set([...ucr.L, ...ucr.G, ...ucr.M].map(i => i.id));
  const freeL = by('P', 'L').filter(i => !used.has(i.id));
  const una = {
    L: freeL.length >= 21 ? pick(freeL, 21, r) : [...freeL, ...pick(ucr.L, 21 - freeL.length, r)].sort((a, b) => a.id - b.id),
    G: pick(by('X', 'G'), 12, r, used), M: pick(by('X', 'M'), 12, r, used)
  };
  // TEC: solo ítems propios del TEC, así no se cruzan con UCR/UNA.
  const tec = { L: pick(by('T', 'L'), 17, r), G: pick(by('T', 'G'), 14, r), M: pick(by('T', 'M'), 14, r) };

  const mk = (idx, short, title, full, set, note) => ({ idx, short, title, full, note, items: [...set.L, ...set.G, ...set.M], counts: { L: set.L.length, G: set.G.length, M: set.M.length } });
  const shared = una.L.filter(i => ucr.L.some(j => j.id === i.id)).length;
  const tests = [
    mk(1, 'UCR', 'Prueba UCR', 'Universidad de Costa Rica · Prueba de Aptitud Académica (PAA)', ucr, 'La PAA de la UCR mide razonamiento en contextos verbales y matemáticos. No mide conocimientos memorizados.'),
    mk(2, 'UNA', 'Prueba UNA', 'Universidad Nacional · Prueba de Aptitud Académica (PAA)', una, 'La UNA aplica la misma PAA que la UCR. Esta prueba usa ítems distintos a los de la prueba UCR' + (shared ? ` (solo ${shared} ítems de lectura se repiten)` : '') + ', así que sirve como segundo simulacro.'),
    mk(3, 'TEC', 'Prueba TEC', 'Instituto Tecnológico de Costa Rica · Prueba de Aptitud Académica', tec, 'La prueba del TEC pone más peso en lógica y matemática. Los ítems provienen del Cuaderno de ejercicios para la PAA del TEC.')
  ];

  const css = fs.readFileSync(path.join(__dirname, 'cuadernillo.css'), 'utf8');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cuadernillo de práctica: simulacro de admisión UCR, UNA y TEC</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,400..800&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>${css}</style></head><body>
<section class="page cover">
  <div class="eyebrow">Cuadernillo de práctica · Versión impresa</div>
  <h1>Simulacro de admisión</h1>
  <p class="lead">Tres pruebas completas para practicar el examen de admisión de la UCR, la UNA y el TEC, con hoja de respuestas y solucionario.</p>
  <div class="unis"><div><b>UCR</b><span>Prueba 1 · 45 ítems</span></div><div><b>UNA</b><span>Prueba 2 · 45 ítems</span></div><div><b>TEC</b><span>Prueba 3 · 45 ítems</span></div></div>
  <div class="name">Nombre del estudiante <u></u></div>
  <p class="small">Material de práctica. No es una prueba oficial ni está afiliado a la UCR, la UNA o el TEC.</p>
</section>
<section class="page guide">
  <div class="eyebrow">Antes de empezar</div><h2>Cómo usar este cuadernillo</h2>
  <p>Este cuadernillo es la versión en papel del simulacro de la plataforma. Se usan los dos juntos: en papel se practica en condiciones parecidas al examen real y en la plataforma queda registrado el avance.</p>
  <ol class="steps">
    <li><b>Haga una prueba completa en papel.</b> Siéntese en un lugar tranquilo, con reloj, lápiz y borrador. Tiene 1 hora y 50 minutos para los 45 ítems. Marque sus respuestas en la hoja de respuestas que está al final de cada prueba.</li>
    <li><b>Corrija con el solucionario.</b> Está al final del cuadernillo, separado de las pruebas. Cuente los aciertos de cada área y anótelos en el cuadro de la hoja de respuestas: ahí verá en qué área es fuerte y en cuál debe mejorar.</li>
    <li><b>Lea la explicación de cada ítem que falló.</b> Entender por qué se equivocó vale más que hacer muchos ítems nuevos.</li>
    <li><b>Siga en la plataforma.</b> Entre con su correo y haga prácticas cortas del área más débil. La plataforma mide el tiempo de cada ítem y su profesor o tutor ve el resumen de su avance.</li>
  </ol>
  <h3>Orden sugerido</h3>
  <table class="plan"><tr><th>Semana 1</th><td>Prueba 1 (UCR) en papel → corregir → prácticas cortas en la plataforma del área más débil.</td></tr>
    <tr><th>Semana 2</th><td>Prueba 2 (UNA) en papel → corregir → comparar con la prueba 1.</td></tr>
    <tr><th>Semana 3</th><td>Prueba 3 (TEC) en papel (más lógica y matemática) → corregir.</td></tr>
    <tr><th>Después</th><td>Simulacros completos en la plataforma, uno por semana.</td></tr></table>
  <h3>Cómo leer el resultado</h3>
  <p>Son los mismos cortes que usa el panel de la plataforma. Por área: <b>fuerte</b> con 75 % o más de aciertos, <b>aceptable</b> entre 55 % y 74 %, y <b>debe mejorar</b> con menos de 55 %. En total: 80 % o más es muy buen nivel, 65 % buen nivel, 50 % nivel intermedio y menos de 50 % nivel bajo. Son reglas fijas para orientar el estudio, no una calificación oficial.</p>
  <h3>Contenido</h3>
  <ul class="toc"><li>Prueba 1 · UCR, con su hoja de respuestas</li><li>Prueba 2 · UNA, con su hoja de respuestas</li><li>Prueba 3 · TEC, con su hoja de respuestas</li><li>Solucionarios de las tres pruebas</li></ul>
</section>
${howto(B)}
${tests.map(testSection).join('')}
<section class="page soldiv"><div class="eyebrow">Para corregir</div><h1>Solucionarios</h1><p class="lead">Use estas páginas solo después de terminar cada prueba. Si el cuadernillo es para varios estudiantes, el profesor o tutor puede separarlas.</p></section>
${tests.map(solutions).join('')}
<section class="credits"><h3>Créditos y licencia</h3>
<p>Los ítems de la prueba TEC provienen del <i>Cuaderno de ejercicios para la PAA del TEC</i> (2.ª ed., 2023), publicado con licencia Creative Commons BY-NC-SA 4.0. Este cuadernillo se comparte con la misma licencia: se puede copiar e imprimir sin fines de lucro, citando la fuente.</p>
<p>Material de práctica. No es una prueba oficial y no está afiliado a la Universidad de Costa Rica, la Universidad Nacional ni el Instituto Tecnológico de Costa Rica.</p></section>
</body></html>`;
  fs.writeFileSync(OUT_HTML, html);
  await page.goto('file://' + OUT_HTML, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: OUT_PDF, format: 'Letter', printBackground: true,
    margin: { top: '16mm', bottom: '18mm', left: '17mm', right: '17mm' },
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-size:8px;color:#5a6275;padding:0 17mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif"><span>Simulacro de admisión UCR · UNA · TEC — material de práctica</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>'
  });
  await browser.close();
  console.log('Listo:', OUT_PDF, '\n', tests.map(t => t.short + ' ' + JSON.stringify(t.counts)).join('\n '), '\nrepetidos UCR/UNA:', shared);
})();
