// ================================================
// MAIN: Recibe notificación y registra en Sheets
// ================================================
function doPost(e) {
  var ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty("idArchivo")
  );

  var data   = JSON.parse(e.postData.contents);
  var texto  = data.texto || "";
  var titulo = data.banco  || "";
  var nota   = data.nota   || "";
  var fecha  = new Date();

  Logger.log("TEXTO: " + texto + " | TITULO: " + titulo);

  // --- 0. FILTROS ---
  if (/cancelar/i.test(nota))    return responder("Cancelado por usuario");
  if (/rechaz|negad|fallid/i.test(titulo + texto)) return responder("Rechazado");
  if (/crédito por hasta|desembólsalo|aprovecha|pide tu|cashback|rentar|seguridad temporal|preaprobado|código|tasa desde|invertir|dólares digitales|descuento|El dólar sigue|millonario|seguro|invita/i
      .test(texto + titulo))      return responder("Publicidad Ignorada");

  var valorNum = 0, comercio = "", producto = "", pestana = "";

  // --- 1. BANCOLOMBIA ---
  if (/bancolombia/i.test(titulo)) {

    // A. Pago recibido en tarjeta (Wompi-PSE, etc.)
    if (/recibimos pago por/i.test(texto)) {
      var m = texto.match(/\$\s?([0-9.,]+)/);
      if (!m) return responder("Sin monto");
      valorNum = parsearMonto(m[1]);
      comercio = "Pago Tarjeta Bancolombia";
      producto = "T.Credito Bancolombia";
      pestana  = "Bancolombia";

    // B. Compra normal
    } else {
      var m = texto.match(/COP\s?([0-9.,]+)/);
      if (!m) return responder("Sin monto");
      valorNum = parsearMonto(m[1]) * -1;
      comercio = (texto.includes(" en ") && texto.includes(" con "))
        ? texto.split(" en ")[1].split(" con ")[0].trim()
        : "Transaccion Bancolombia";
      producto = "T.Credito Bancolombia";
      pestana  = "Bancolombia";
    }

  // --- 2. LULO ---
  } else {
    var m = texto.match(/\$\s?([0-9.,]+)/);
    if (!m) return responder("Sin monto");
    valorNum = parsearMonto(m[1]);

    var esEgreso  = /envío|pagaste|compra|pago|PSE/i.test(titulo + texto);
    var esIngreso = /recibiste|llegó/i.test(titulo + texto);
    var esBreB    = /bre-b/i.test(titulo + texto);
    var esPSE     = /PSE/i.test(titulo + texto);

    if (esEgreso) valorNum *= -1;

    // A. PSE
    if (esPSE && texto.includes(" - ")) {
      var partes = texto.split(" - ");
      comercio = partes[1] ? partes[1].replace(/\.$/, "").trim() : "Pago PSE";
      if (/bancolombia/i.test(comercio)) comercio = "Pago Tarjeta Bancolombia";
      producto = "Lulo Debito";

    // B. Transferencias / Bre-B / Ingresos
    } else if (esBreB || esIngreso || /envío/i.test(texto)) {
      var nMatch = texto.match(/(?:\s(?:a|de)\s)([^.$]+)/i);
      comercio = nMatch ? nMatch[1].split("Y lo mejor")[0].trim() : "Transferencia";
      producto = "Lulo Debito";

    // C. Compra con tarjeta
    } else if (texto.includes(" en ") && texto.includes(" con tu tarjeta")) {
      var numTC = PropertiesService.getScriptProperties().getProperty("NumeroTarjeta");
      comercio  = texto.split(" en ")[1].split(" con ")[0].trim();
      producto  = RegExp(numTC, "i").test(texto) ? "T.Credito Lulo" : "T.Debito Lulo";

    } else {
      comercio = "Comercio Desconocido";
      producto = "Lulo/Otros";
    }

    pestana = "Lulo";
  }

  // --- 3. DEVOLUCIÓN ---
  var esDevolucion = /devoluci[oó]n|devuelto|devolver|reembolso|reverso|reversi[oó]n|reversa|reintegro|contracargo/i
    .test(texto + titulo + nota);
  if (esDevolucion) valorNum = Math.abs(valorNum);

  // --- 4. CATEGORIZACIÓN ---
  var sheet    = ss.getSheetByName(pestana) || ss.getSheets()[0];
  var categoria = esDevolucion
    ? (buscarCategoriaEnSheet(sheet, comercio, valorNum) || obtenerCategoriaFinal(comercio, nota, valorNum))
    : obtenerCategoriaFinal(comercio, nota, valorNum);

  // --- 5. ESCRIBIR (lock solo al momento de escribir) ---
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  sheet.appendRow([fecha, valorNum, comercio, producto, nota, categoria.categoria, categoria.subcategoria]);
  lock.releaseLock();

  return responder("OK");
}

function responder(msg) {
  return ContentService.createTextOutput(msg);
}


// ================================================
// CATEGORIZACIÓN
// ================================================
function obtenerCategoriaFinal(comercio, nota, valorNum) {
  var texto = (comercio + " " + nota).toUpperCase();

  // Reglas fijas (más rápidas que Gemini)
  if (texto.includes("TECNOQUIMICAS") || texto.includes("TQ"))
    return valorNum > 0
      ? { categoria: "Ingreso",  subcategoria: "Salario"        }
      : { categoria: "Tienda TQ",subcategoria: "Tienda TQ"      };

  if (texto.includes("PAGO TARJETA BANCOLOMBIA"))
    return { categoria: "Tarjeta de credito", subcategoria: "TC Bancolombia" };

  if (texto.includes("ASEO"))    return { categoria: "Servicios", subcategoria: "Aseo"  };
  if (texto.includes("AVVILLAS")) return { categoria: "Casa",      subcategoria: "Administración" };
  if (texto.includes("EDS"))     return { categoria: "Carro",     subcategoria: "Gasolina"       };

  // Sin regla fija → Gemini
  return clasificarConGemini(comercio, nota);
}

function clasificarConGemini(comercio, nota) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("ApiKey");
  var url    = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + apiKey;

  var categorias =
    "- Comida: Antojo, Cafe, Restaurante, Mercado\n" +
    "- Tienda TQ: Tienda TQ, TQ\n" +
    "- Compras: Regalos, Electronica, Ropa, Accesorios, Deporte\n" +
    "- Tequi: Alimento, Snack, Veterinario, Juguete, Accesorio, Arena\n" +
    "- Casa: Administración, Mantenimiento, Arreglo\n" +
    "- Servicios: Internet, Emcali, Aseo, Gas\n" +
    "- Transporte: Taxi, Uber, Transporte publico\n" +
    "- Carro: SOAT, Tecnomecanica, Mantenimiento, Parqueadero, Gasolina, Infracciones\n" +
    "- Entretenimiento: Alcohol, Salida, Concierto, Evento\n" +
    "- Viaje: Tiquete, Hotel, Airbnb, Hostal\n" +
    "- Suscripciones: Crunchyroll, Youtube, Google, Claude, Otro\n" +
    "- Educación: General\n" +
    "- Hobbies: Salsa, Plantas, Ceramica, Ejercicio, Hobbies\n" +
    "- Eventos: Cumpleaños, Matrimonio, Grados, Día especial\n" +
    "- Belleza: Uñas, Peluquería, Skincare\n" +
    "- Salud: Medico, Medicamento, Examenes\n" +
    "- Inversiones: Ale, Ahorro, Skandia\n" +
    "- Ingreso: Salario, Arriendo\n" +
    "- Tarjeta de credito: TC Bancolombia, TC Lulo";

  var prompt = "Eres un asistente financiero experto. Tu tarea es clasificar un movimiento financiero en UNA SOLA subcategoría de la lista provista.\n\n" +
      "ESTRUCTURA DE CATEGORÍAS (Formato: Categoría: Subcategoría1, Subcategoría2):\n" + categorias + "\n\n" +
      "DATOS DE LA TRANSACCIÓN:\n" +
      "Comercio/Entidad: '" + comercio + "'\n" +
      "Nota del usuario: '" + (nota || "Sin nota") + "'\n\n" +
      "REGLAS:\n" +
      "1. Analiza el comercio y la nota para deducir el gasto.\n" +
      "2. Responde estrictamente en formato: Categoria | Subcategoria\n" +
      "3. No uses puntos finales, ni explicaciones, ni negritas.\n" +
      "4. Si la categoría no tiene subcategorías en la lista, usa el nombre de la categoría como subcategoría.\n" +
      "5. Si no puedes identificarlo y no hay nota, busca el nombre del comercio en internet y agréga la categoría y subcategoría que crees que corresponda \n" +
      "6. Si aún con la búsqueda no puedes identificarlo, responde: Compras | Compras";

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 }
    }),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code     = response.getResponseCode();
    var json     = JSON.parse(response.getContentText());

    if (code !== 200) {
      Logger.log("Error Gemini (" + code + "): " + JSON.stringify(json));
      return { categoria: "Error", subcategoria: "API" };
    }

    var partes = json.candidates[0].content.parts[0].text
      .trim().replace(/\n/g, "").split("|");

    return {
      categoria:    partes[0] ? partes[0].trim() : "Compras",
      subcategoria: partes[1] ? partes[1].trim() : "Compras"
    };

  } catch (err) {
    Logger.log("ERROR Gemini: " + err.toString());
    return { categoria: "Compras", subcategoria: "Compras" };
  }
}


// ================================================
// BÚSQUEDA EN SHEET PARA DEVOLUCIONES
// ================================================
function buscarCategoriaEnSheet(sheet, comercio, valor) {
  var data   = sheet.getDataRange().getValues();
  var buscar = comercio.trim().toLowerCase();

  for (var i = data.length - 1; i >= 0; i--) {
    var filaComercio = String(data[i][2]).trim().toLowerCase();
    var filaValor    = Math.abs(parseFloat(data[i][1]));
    if (filaComercio === buscar && Math.abs(filaValor - valor) < 1) {
      return { categoria: data[i][5], subcategoria: data[i][6] };
    }
  }
  return null;
}


// ================================================
// PARSEO DE MONTOS (maneja , y . como miles/decimal)
// ================================================
function parsearMonto(str) {
  str = str.trim();
  var tieneComa  = str.includes(",");
  var tienePunto = str.includes(".");

  // Ambos separadores: el más a la derecha es el decimal
  if (tieneComa && tienePunto) {
    return str.lastIndexOf(",") > str.lastIndexOf(".")
      ? parseFloat(str.replace(/\./g, "").replace(",", "."))  // europeo:  1.234,56
      : parseFloat(str.replace(/,/g, ""));  // americano: 1,234.56
  }
  // Solo comas: 2 dígitos al final = decimal, sino = miles
  if (tieneComa) {
    var partes = str.split(",");
    return (partes.length === 2 && partes[1].length <= 2)
      ? parseFloat(str.replace(",", "."))
      : parseFloat(str.replace(/,/g, ""));
  }
  // Solo puntos: 2 dígitos al final = decimal, sino = miles
  if (tienePunto) {
    var partes = str.split(".");
    return (partes.length === 2 && partes[1].length <= 2)
      ? parseFloat(str)
      : parseFloat(str.replace(/\./g, ""));
  }

  return parseFloat(str);
}


// ================================================
// TESTS
// ================================================
function runTests() {
  Logger.log("========== 🧪 INICIO DE TESTS ==========");
  _testParsearMonto();
  _testCategorias();
  testDirecto();
  Logger.log("=========================================");
}

function _testParsearMonto() {
  Logger.log("\n--- parsearMonto ---");
  var casos = [
    { input: "2,606,189.00", esperado: 2606189, label: "Americano con decimales  " },
    { input: "2.606.189",    esperado: 2606189, label: "Europeo sin decimales    " },
    { input: "50.000,90",    esperado: 50000.9, label: "Europeo con decimales    " },
    { input: "762,90",       esperado: 762.9,   label: "Coma decimal (2 dígitos) " },
    { input: "762904",       esperado: 762904,  label: "Sin separadores          " },
    { input: "1.500",        esperado: 1500,    label: "Punto miles (3 dígitos)  " },
    { input: "1.50",         esperado: 1.5,     label: "Punto decimal (2 dígitos)" },
  ];
  casos.forEach(function(c) {
    var resultado = parsearMonto(c.input);
    var ok = Math.abs(resultado - c.esperado) < 0.01;
    Logger.log((ok ? "✅" : "❌") + " " + c.label + ": '" + c.input + "' → " + resultado +
      (ok ? "" : "   ⚠️ esperado: " + c.esperado));
  });
}

function _testCategorias() {
  Logger.log("\n--- obtenerCategoriaFinal (reglas fijas) ---");
  var casos = [
    { comercio: "TECNOQUIMICAS SA",         nota: "", valor:  5000000, cat: "Ingreso",           sub: "Salario"        },
    { comercio: "Tienda TQ oficina",        nota: "", valor: -50000,   cat: "Tienda TQ",         sub: "Tienda TQ"      },
    { comercio: "Pago Tarjeta Bancolombia", nota: "", valor:  2606189, cat: "Tarjeta de credito", sub: "TC Bancolombia" },
    { comercio: "EDS La 14",               nota: "", valor: -80000,   cat: "Carro",             sub: "Gasolina"       },
    { comercio: "Conjunto AVVILLAS",        nota: "", valor: -300000,  cat: "Casa",              sub: "Administración" },
  ];
  casos.forEach(function(c) {
    var res = obtenerCategoriaFinal(c.comercio, c.nota, c.valor);
    var ok  = res.categoria === c.cat && res.subcategoria === c.sub;
    Logger.log((ok ? "✅" : "❌") + " " + c.comercio + " → " + res.categoria + " | " + res.subcategoria +
      (ok ? "" : "   ⚠️ esperado: " + c.cat + " | " + c.sub));
  });
}

function testDirecto() {
  Logger.log("\n--- Simulación de notificaciones ---");
  var casos = [
    { texto: "$762.904 en CLAUDE.AI SUBSCRIPTION con tu tarjeta de crédito", banco: "Compra realizada",         nota: ""         },
    { texto: "$2.606.189 - Bancolombia Sa.",                                  banco: "Tu pago PSE fue exitoso",  nota: ""         },
    { texto: "Enviaste $150.000 a Juan Perez. Y lo mejor...",                 banco: "Envío exitoso",            nota: ""         },
    { texto: "Recibiste $200.000 de Maria Lopez",                             banco: "Llegó una transferencia",  nota: ""         },
    { texto: "Devolución de $50.000 de Rappi",                                banco: "Reembolso recibido",       nota: ""         },
    { texto: "Bancolombia: Compra por COP 50.000 en RAPPI con Tarjeta",       banco: "Bancolombia",              nota: ""         },
    { texto: "Bancolombia: Recibimos pago por $2,606,189.00 a tu tarjeta de credito desde Wompi-PSE", banco: "Bancolombia", nota: "" },
    { texto: "$50.000 en Starbucks con tu tarjeta",                           banco: "Compra realizada",         nota: "cancelar" },
    { texto: "Aprovecha tu crédito preaprobado",                              banco: "Lulo",                     nota: ""         },
    { texto: "Transacción rechazada por fondos insuficientes",                banco: "Lulo",                     nota: ""         },
  ];
  casos.forEach(function(c) {
    var fakeEvent = {
      postData: { contents: JSON.stringify({ texto: c.texto, banco: c.banco, nota: c.nota }) }
    };
    var resultado = doPost(fakeEvent);
    Logger.log("📨 [" + c.banco + "] → " + resultado.getContent());
  });
}