function doPost(e) {

  var idArchivo = PropertiesService.getScriptProperties().getProperty("idArchivo")
  var ss = SpreadsheetApp.openById(idArchivo);
  
  var data = JSON.parse(e.postData.contents);
  var texto = data.texto || "";
  var titulo = data.banco || "";
  var notaUsuario = data.nota || ""; 
  var fecha = new Date();

  Logger.log("TEXTO RECIBIDO: " + texto);

  var lock = LockService.getScriptLock();     
  lock.waitLock(30000);

  // --- 0. FILTROS DE SEGURIDAD ---
  if (/cancelar/i.test(notaUsuario)) return ContentService.createTextOutput("Cancelado por usuario");
  if (/rechaz|negad|fallid/i.test(titulo + texto)) return ContentService.createTextOutput("Rechazado");
  
  var esPublicidad = /crédito por hasta|desembólsalo|aprovecha|pide tu|cashback|rentar|seguridad temporal|preaprobado|código|tasa desde|invertir|dólares digitales|descuento|El dólar sigue|millonario|seguro|invita/i.test(texto + titulo);
  
  if (esPublicidad) return ContentService.createTextOutput("Publicidad Ignorada");

  var valorNum = 0;
  var comercio = "";
  var producto = ""; 
  var nombrePestana = ""; // Elegir la hoja destino

  // --- 1. PARA SMS BANCOLOMBIA
  if (texto.includes("Bancolombia") || titulo.includes("Bancolombia")) {

    // Caso A: Pago recibido a tarjeta de crédito (ej: desde Wompi-PSE)
    if (/recibimos pago por/i.test(texto)) {
      var montoMatch = texto.match(/\$\s?([0-9.,]+)/);
      if (!montoMatch) return ContentService.createTextOutput("Sin monto");

      valorNum = parsearMonto(montoMatch[1]);
      comercio = "Pago Tarjeta Bancolombia";
      producto = "T.Credito Bancolombia";
      nombrePestana = "Bancolombia";

    // Caso B: Compra normal
    } else {
      var montoMatch = texto.match(/COP\s?([0-9.,]+)/);
      if (!montoMatch) return ContentService.createTextOutput("Sin monto");

      valorNum = parsearMonto(montoMatch[1]) * -1;

      if (texto.includes(" en ") && texto.includes(" con ")) {
        comercio = texto.split(" en ")[1].split(" con ")[0].trim();
      } else {
        comercio = "Transaccion Bancolombia";
      }

      producto = "T.Credito Bancolombia";
      nombrePestana = "Bancolombia";
    }
  }

  // --- 2. PARA NOTIFICACIONES LULO
  else {
    var montoMatch = texto.match(/\$\s?([0-9.,]+)/);
    if (!montoMatch) return ContentService.createTextOutput("Sin monto");
    
    valorNum = parsearMonto(montoMatch[1]);

    var esEgreso = /envío|pagaste|compra|pago|PSE/i.test(titulo + texto);
    var esIngreso = /recibiste|llegó/i.test(titulo + texto);
    var esBreB = /bre-b/i.test(titulo + texto);
    var esPSE = /PSE/i.test(titulo + texto);

    if (esEgreso) valorNum *= -1;

    // A. Caso PSE
    if (esPSE && texto.includes(" - ")) {
      var partes = texto.split(" - ");
      comercio = partes[1] ? partes[1].replace(/\.$/, "").trim() : "Pago PSE";

      // Si el pago PSE es hacia Bancolombia → marcar como pago de tarjeta
      if (/bancolombia/i.test(comercio)) {
        comercio = "Pago Tarjeta Bancolombia";
      }

      producto = "Lulo Debito";
    }
    // B. Caso Transferencias
    else if (esBreB || esIngreso || /envío/i.test(texto)) {
      var nMatch = texto.match(/(?:\s(?:a|de)\s)([^.$]+)/i);
      comercio = nMatch ? nMatch[1].split("Y lo mejor")[0].trim() : "Transferencia";
      producto = "Lulo Debito";
    }
    // D. Caso Compras con Tarjeta de Crédito (notificación Lulo)
    else if (texto.includes(" en ") && texto.includes(" con tu tarjeta")) {
      var NumeroTarjeta = PropertiesService.getScriptProperties().getProperty("NumeroTarjeta")
      comercio = texto.split(" en ")[1].split(" con ")[0].trim();
      producto = RegExp(NumeroTarjeta, "i").test(texto) ? "T.Credito Lulo" : "T.Debito Lulo";
    }
    else {
        comercio = "Comercio Desconocido";
        producto = "Lulo/Otros";
    }
    
    nombrePestana = "Lulo"; // Pestaña Lulo
  }

// --- 3. CLASIFICACIÓN CON GEMINI Y ESCRIBIR EN EL SHEETS ---

  // Detección de devolución (cualquier forma)
  var esDevolucion = /devoluci[oó]n|devuelto|devolver|reembolso|reverso|reversi[oó]n|reversa|reintegro|contracargo/i.test(texto + titulo + notaUsuario);

  if (esDevolucion) {
    valorNum = Math.abs(valorNum); // Forzar positivo
  }

  // Hoja correspondiente
  var sheet = ss.getSheetByName(nombrePestana);
  if (!sheet) {
    sheet = ss.getSheets()[0];
  }

  var categoriaAsignada;

  if (esDevolucion) {
    // Busca en el sheet si hay un registro del mismo comercio y valor
    var categoriaEncontrada = buscarCategoriaEnSheet(sheet, comercio, valorNum);
    // Si no encuentra, clasifica con Gemini como respaldo
    categoriaAsignada = categoriaEncontrada || obtenerCategoriaFinal(comercio, notaUsuario, valorNum);
  } else {
    categoriaAsignada = obtenerCategoriaFinal(comercio, notaUsuario, valorNum);
  }
  
  sheet.appendRow([fecha, valorNum, comercio, producto, notaUsuario, categoriaAsignada.categoria, categoriaAsignada.subcategoria]);

  lock.releaseLock(); 
  return ContentService.createTextOutput("OK");
}

function obtenerCategoriaFinal(comercio, nota, valorNum) {
  var textoAAnalizar = (comercio + " " + nota).toUpperCase();

  // --- ZONA DE REGLAS FIJAS ---
  if (textoAAnalizar.includes("TECNOQUIMICAS") || textoAAnalizar.includes("TQ")) {
    if (valorNum > 0) {
      return {categoria: "Ingreso", subcategoria: "Salario"}
    } else {
      return {categoria: "Tienda TQ", subcategoria: "Tienda TQ"};
    }
  }

   if (textoAAnalizar.includes("PAGO TARJETA BANCOLOMBIA")) {
    return {categoria: "Tarjeta de credito", subcategoria: "TC Bancolombia"};
  }

  if (textoAAnalizar.includes("ASEO")) return {categoria: "Servicios", subcategoria: "Aseo"};
  if (textoAAnalizar.includes("AVVILLAS")) return {categoria: "Casa", subcategoria: "Administración"};
  if (textoAAnalizar.includes("EDS")) return {categoria: "Carro", subcategoria: "Gasolina"};
  
  // --- SI NO HAY REGLA, USA LA IA ---
  return clasificarConGemini(comercio, nota);
}

function clasificarConGemini(comercio, nota) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("ApiKey");
  
  // CORRECCIÓN: Usar gemini-1.5-flash (la versión 2.5 no existe aún)
  var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + apiKey;

  var estructuraCategorias = `
  - Comida: Antojo, Cafe, Restaurante, Mercado
  - Tienda TQ: Tienda TQ, TQ
  - Compras: Regalos, Electronica, Ropa, Accesorios, Deporte
  - Tequi: Alimento, Snack, Veterinario, Juguete, Accesorio, Arena
  - Casa: Administración, Mantenimiento, Arreglo
  - Servicios: Internet, Emcali, Aseo, Gas
  - Transporte: Taxi, Uber, Transporte publico
  - Carro: SOAT, Tecnomecanica, Mantenimiento, Parqueadero, Gasolina, Infracciones
  - Entretenimiento: Alcohol, Salida, Concierto, Evento
  - Viaje: Tiquete, Hotel, Airbnb, Hostal
  - Suscripciones: Crunchyroll, Youtube, Google, Claude, Otro.
  - Educación: General
  - Hobbies: Salsa, Plantas, Ceramica, Ejercicio, Hobbies.
  - Eventos: Cumpleaños, Matrimonio, Grados, Día especial
  - Belleza: Uñas, Peluquería, Skincare
  - Salud: Medico, Medicamento, Examenes
  - Inversiones: Ale, Ahorro, Skandia
  - Ingreso: Salario, Arriendo
  - Tarjeta de credito: TC Bancolombia, TC Lulo
  `;

  var prompt = "Eres un asistente financiero experto. Tu tarea es clasificar un movimiento financiero en UNA SOLA subcategoría de la lista provista.\n\n" +
               "ESTRUCTURA DE CATEGORÍAS (Formato: Categoría: Subcategoría1, Subcategoría2):\n" + estructuraCategorias + "\n\n" +
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

  var payload = {
    "contents": [{"parts": [{"text": prompt}]}],
    "generationConfig": {
      "temperature": 0.1 // Temperatura baja para respuestas consistentes
    }
  };

  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true // Para ver el error real si la API falla
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    var json = JSON.parse(response.getContentText());

    if (responseCode !== 200) {
      Logger.log("Error de API (" + responseCode + "): " + JSON.stringify(json));
      return { categoria: "Error", subcategoria: "API" };
    }

    var respuesta = json.candidates[0].content.parts[0].text.trim();
    
    // Limpiar respuesta de posibles caracteres extraños o saltos de línea
    respuesta = respuesta.replace(/\n/g, "");

    var partes = respuesta.split("|");
    
    return {
      categoria: partes[0] ? partes[0].trim() : "Compras",
      subcategoria: partes[1] ? partes[1].trim() : "Compras"
    };

  } catch (e) {
    Logger.log("ERROR CRÍTICO: " + e.toString());
    return { categoria: "Compras", subcategoria: "Compras" };
  }
}

function buscarCategoriaEnSheet(sheet, comercio, valor) {
  var data = sheet.getDataRange().getValues();
  var comercioNormalizado = comercio.trim().toLowerCase();

  // Recorre de más reciente a más antiguo buscando coincidencia
  for (var i = data.length - 1; i >= 0; i--) {
    var filaComercio = String(data[i][2]).trim().toLowerCase(); // Columna C: comercio
    var filaValor = Math.abs(parseFloat(data[i][1]));           // Columna B: valor absoluto

    if (filaComercio === comercioNormalizado && Math.abs(filaValor - valor) < 1) {
      return {
        categoria: data[i][5],    // Columna F
        subcategoria: data[i][6]  // Columna G
      };
    }
  }
  return null; // No encontró coincidencia
}

function testGemini() {
  var resultado = clasificarConGemini("Uber *Trip", "Viaje a la oficina");
  Logger.log(resultado); // Debería imprimir: {categoria: "Transporte", subcategoria: "Uber"}
}


function simularNotificacion() {
  var url = PropertiesService.getScriptProperties().getProperty("url")

  var payload = {
    "texto": "$762.904 en CLAUDE.AI SUBSCRIPTION con tu tarjeta de crédito",
    "banco": "Compra realizada",
    "nota": " "
  };

  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload)
  };

  var response = UrlFetchApp.fetch(url, options);
  Logger.log("Respuesta: " + response.getContentText());
}

function parsearMonto(str) {
  str = str.trim();
  var tieneComa = str.includes(",");
  var tienePunto = str.includes(".");

  // Si tiene ambos: el que está más a la derecha es el decimal
  if (tieneComa && tienePunto) {
    if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
      // Formato europeo: 1.234.567,89
      return parseFloat(str.replace(/\./g, "").replace(",", "."));
    } else {
      // Formato americano: 1,234,567.89
      return parseFloat(str.replace(/,/g, ""));
    }
  }

  // Solo comas: si la última parte tiene 1-2 dígitos → es decimal (ej: 762,90)
  if (tieneComa) {
    var partes = str.split(",");
    var ultima = partes[partes.length - 1];
    if (partes.length === 2 && ultima.length <= 2) {
      return parseFloat(str.replace(",", "."));
    }
    return parseFloat(str.replace(/,/g, "")); // Miles
  }

  // Solo puntos: si la última parte tiene 1-2 dígitos → es decimal (ej: 762.90)
  if (tienePunto) {
    var partes = str.split(".");
    var ultima = partes[partes.length - 1];
    if (partes.length === 2 && ultima.length <= 2) {
      return parseFloat(str);
    }
    return parseFloat(str.replace(/\./g, "")); // Miles
  }

  return parseFloat(str);
}