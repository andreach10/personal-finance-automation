function doPost(e) {
  var idArchivo = "SHEETS-ID";
  var ss = SpreadsheetApp.openById(idArchivo);
  
  var data = JSON.parse(e.postData.contents);
  var texto = data.texto || "";
  var titulo = data.banco || "";
  var notaUsuario = data.nota || ""; 
  var fecha = new Date();

  // --- 0. FILTROS DE SEGURIDAD ---
  // Si se rechaza la transaccion
  if (/rechaz|negad|fallid/i.test(titulo + texto)) return ContentService.createTextOutput("Ignorada");
  
  var esPublicidad = /crédito por hasta|desembólsalo|aprovecha|pide tu|cashback|rentar|seguridad temporal|código|tasa desde|invertir|dólares digitales|descuento|El dólar sigue|millonario|seguro|invita/i.test(texto + titulo);
  
  if (esPublicidad) return ContentService.createTextOutput("Publicidad Ignorada");

  var valorNum = 0;
  var comercio = "";
  var producto = ""; 
  var nombrePestana = ""; // Elegir la hoja destino

  // --- 1. PARA SMS BANCOLOMBIA
  if (texto.includes("Bancolombia") || titulo.includes("Bancolombia")) {
    var montoMatch = texto.match(/COP\s?([0-9.,]+)/);
    if (!montoMatch) return ContentService.createTextOutput("Sin monto");
    
    valorNum = parseFloat(montoMatch[1].replace(/\./g, "").replace(/,/g, ".")) * -1;

    if (texto.includes(" en ") && texto.includes(" con ")) {
      comercio = texto.split(" en ")[1].split(" con ")[0].trim();
    } else {
      comercio = "Transaccion Bancolombia";
    }
    
    producto = "T.Credito Bancolombia";
    nombrePestana = "Bancolombia"; // Pestaña Bancolombia
  } 

  // --- 2. PARA NOTIFICACIONES LULO
  else {
    var montoMatch = texto.match(/\$\s?([0-9.,]+)/);
    if (!montoMatch) return ContentService.createTextOutput("Sin monto");
    
    valorNum = parseFloat(montoMatch[1].replace(/\./g, "").replace(/,/g, ""));

    var esEgreso = /envío|pagaste|compra|pago|PSE/i.test(titulo + texto);
    var esIngreso = /recibiste|llegó/i.test(titulo + texto);
    var esBreB = /bre-b/i.test(titulo + texto);
    var esPSE = /PSE/i.test(titulo + texto);

    if (esEgreso) valorNum *= -1;

    // A. Caso PSE
    if (esPSE && texto.includes(" - ")) {
      comercio = texto.split(" - ")[1].replace(/\.$/, "").trim();
      producto = "Lulo Debito";
    } 
    // B. Caso Transferencias
    else if (esBreB || esIngreso || /envío/i.test(texto)) {
      var nMatch = texto.match(/(?:\s(?:a|de)\s)([^.$]+)/i);
      comercio = nMatch ? nMatch[1].split("Y lo mejor")[0].trim() : "Transferencia";
      producto = "Lulo Debito";
    } 
    // C. Caso Compras Estandar
    else if (texto.includes(" por ")) {
      comercio = texto.split(" por ")[0].trim();
      producto = /crédito/i.test(titulo + texto) ? "T.Credito Lulo" : "Lulo Debito";
    }
    else {
        comercio = "Comercio Desconocido";
        producto = "Lulo/Otros";
    }
    
    nombrePestana = "Lulo"; // Pestaña Lulo
  }

  // --- 3. CLASIFICACIÓN CON GEMINI Y ESCRIBIR EN EL SHEETS ---
  
  var categoriaAsignada = obtenerCategoriaFinal(comercio, notaUsuario, valorNum);

  // Hoja correspondiente
  var sheet = ss.getSheetByName(nombrePestana);
  if (!sheet) {
    sheet = ss.getSheets()[0];
  }

  // Escribimos UNA SOLA VEZ en el Excel (6 columnas)
  sheet.appendRow([fecha, valorNum, comercio, producto, notaUsuario, categoriaAsignada]);

  return ContentService.createTextOutput("OK");
}

function obtenerCategoriaFinal(comercio, nota, valorNum) {
  var textoAAnalizar = (comercio + " " + nota).toUpperCase();

  // --- REGLAS FIJAS ---
  
  // Se puede agregar reglas si sabes que el nombre del comercio o la nota dice algo especifico
  // if (textoAAnalizar.includes("EMCALI")) return "Emcali";
  
  // --- SI NO HAY REGLA, USA LA IA ---
  return clasificarConGemini(comercio, nota);
}

function clasificarConGemini(comercio, nota) {
  var apiKey = "API-KEY";
  var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;

  var estructuraCategorias = `
  - Food & Drinks: Cafetería / snack, Restaurante, Groceries
  - Shopping: Tienda TQ, Regalos, Electronica, Tequi, Arena, Alimento, Vacunas, Casa, Ropa y accesorios
  - Housing: Maintenance, repairs, Servicios, Admón, Internet, Emcali, Aseo, Gas
  - Transportation: Business trips, Long distance, Taxi, Public transport
  - Vehicle: Vehicle insurance, Tecnomecánica, Vehicle maintenance, Parking, Fuel
  - Life & Entertainment: Alcohol, tobacco, Donacion, Vacaciones, Viaje, Hotel, Suscripciones, Educación, Hobbies, Twerk, Salsa, Plantas, Life events, Cumpleaños, Matrimonio, Grados, Active sport, fitness, Wellness, beauty, Uñas, Peluquería, Salud, Medico
  - Investments: Ale, Savings, Financial investments
  - Income: Gifts, Refunds (tax, purchase), Dues & grants, Interests, dividends, Wage, invoices
  `;

  var prompt = "Eres un asistente financiero experto. Tu tarea es clasificar un movimiento financiero en UNA SOLA de las subcategorías de la lista provista.\n\n" +
               "ESTRUCTURA DE CATEGORÍAS:\n" + estructuraCategorias + "\n\n" +
               "DATOS DE LA TRANSACCIÓN:\n" +
               "Comercio/Entidad: '" + comercio + "'\n" +
               "Nota del usuario: '" + nota + "'\n\n" +
               "REGLAS:\n" +
               "1. Analiza el comercio y la nota para deducir el gasto (ej. si dice 'Tequi' o 'Arena', es la subcategoría 'Arena' o 'Tequi').\n" +
               "2. Responde ÚNICAMENTE con el nombre exacto de la subcategoría elegida.\n" +
               "3. No incluyas la categoría principal, no uses comillas, ni puntos, ni des explicaciones.\n" +
               "4. Si es completamente imposible clasificarlo, responde: Compras.";

  var payload = {
    "contents": [{"parts": [{"text": prompt}]}],
    "generationConfig": {
      "temperature": 0.1 
    }
  };

  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload)
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var json = JSON.parse(response.getContentText());
    return json.candidates[0].content.parts[0].text.trim();
  } catch (e) {
      Logger.log("EL ERROR REAL ES: " + e.toString());
      Logger.log("Comercio: " + comercio + " | Nota: " + nota);
    return "Desconocido";
  }
}

function pruebaRapida() {
  var resultado = clasificarConGemini("Crepes and Waffles", "Almuerzo de domingo");
  Logger.log("La IA respondió: " + resultado);
}

function simularNotificacion() {
  var url = "URL_DEL_WEB_APP";

  var payload = {
    "texto": "Compra por $25.000 en Crepes and Waffles",
    "banco": "Lulo",
    "nota": ""
  };

  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload)
  };

  var response = UrlFetchApp.fetch(url, options);
  Logger.log("Respuesta: " + response.getContentText());
}