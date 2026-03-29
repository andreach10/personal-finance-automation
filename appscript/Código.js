function doPost(e) {
  
  var idArchivo = "1LyuDdPbMk5irN5LexWJUFyz_s1iTCnqCv2UUbfzbHPI"; // Tu ID actual
  var ss = SpreadsheetApp.openById(idArchivo);
  Logger.log("TEXTO RECIBIDO: " + texto);
  
  // Parseamos los datos que vienen de MacroDroid
  var data = JSON.parse(e.postData.contents);
  var texto = data.texto || "";
  var titulo = data.banco || ""; 
  // Aqui capturamos la nota que escribiras en el pop-up
  var notaUsuario = data.nota || ""; 
  var fecha = new Date();

  var lock = LockService.getScriptLock();     
  lock.waitLock(30000);

  // --- 0. FILTROS DE SEGURIDAD MEJORADOS ---
  if (/rechaz|negad|fallid/i.test(titulo + texto)) return ContentService.createTextOutput("Rechazado");
  
  var esPublicidad = /crédito por hasta|desembólsalo|aprovecha|pide tu|cashback|rentar|seguridad temporal|codigo|tasa desde|invertir|dólares digitales|descuento|El dólar sigue|millonario|seguro|invita/i.test(texto + titulo);
  
  if (esPublicidad) return ContentService.createTextOutput("Publicidad Ignorada");

  var valorNum = 0;
  var comercio = "";
  var producto = ""; 
  var nombrePestana = ""; // Variable para elegir la hoja destino

  // --- 1. LÓGICA PARA SMS (BANCOLOMBIA) ---
  if (texto.includes("Bancolombia") || titulo.includes("Bancolombia")) {
    var montoMatch = texto.match(/COP\s?([0-9.,]+)/);
    if (!montoMatch) return ContentService.createTextOutput("Sin monto Bancolombia");
    
    // Limpieza de formato numerico
    valorNum = parseFloat(montoMatch[1].replace(/\./g, "").replace(/,/g, ".")) * -1;

    if (texto.includes(" en ") && texto.includes(" con ")) {
      comercio = texto.split(" en ")[1].split(" con ")[0].trim();
    } else {
      comercio = "Transaccion Bancolombia";
    }
    
    producto = "T.Credito Bancolombia";
    nombrePestana = "Bancolombia"; // Va a la pestaña Bancolombia
  } 

  // --- 2. LÓGICA PARA NOTIFICACIONES (LULO / OTRAS) ---
  else {
    var montoMatch = texto.match(/\$\s?([0-9.,]+)/);
    
    // Si no hay signo de pesos ni un numero claro, ignoramos
    if (!montoMatch) return ContentService.createTextOutput("Sin monto detectado");
    
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
    // D. Caso Compras con Tarjeta de Crédito (notificación Lulo)
    else if (texto.includes(" en ") && texto.includes(" con tu tarjeta")) {
      comercio = texto.split(" en ")[1].split(" con ")[0].trim();
      producto = /7068/i.test(texto) ? "T.Credito Lulo" : "T.Debito Lulo";
    }
    else {
        comercio = "Comercio Desconocido";
        producto = "Lulo/Otros";
    }
    
    nombrePestana = "Lulo"; // Va a la pestaña Lulo
  }

  // --- 3. CLASIFICACIÓN Y ESCRIBIR EN EL EXCEL ---
  
  // AQUÍ ESTÁ LA CORRECCIÓN: Llamamos a tus reglas fijas primero
  var categoriaAsignada = obtenerCategoriaFinal(comercio, notaUsuario, valorNum);

  // Buscamos la hoja correspondiente por su nombre
  var sheet = ss.getSheetByName(nombrePestana);
  if (!sheet) {
    sheet = ss.getSheets()[0]; // Respaldo por si borras o escribes mal el nombre de la pestaña
  }

  // Agrego categoria y subcategoria
  sheet.appendRow([fecha, valorNum, comercio, producto, notaUsuario, categoriaAsignada.categoria, categoriaAsignada.subcategoria]);

  lock.releaseLock(); 
  return ContentService.createTextOutput("OK");
}

function obtenerCategoriaFinal(comercio, nota, valorNum) {
  var textoAAnalizar = (comercio + " " + nota).toUpperCase();

  // --- ZONA DE REGLAS FIJAS ---
  if (textoAAnalizar.includes("TECNOQUIMICAS") || textoAAnalizar.includes("TQ")) {
    if (valorNum > 0) {
      return "Wage"; 
    } else {
      return "Tienda TQ"; 
    }
  }

  if (textoAAnalizar.includes("ASEO")) return "Aseo";
  if (textoAAnalizar.includes("AVVILLAS")) return "Admón";
  if (textoAAnalizar.includes("EDS")) return "Gasolina";
  
  // --- SI NO HAY REGLA, USA LA IA ---
  return clasificarConGemini(comercio, nota);
}

function clasificarConGemini(comercio, nota) {
  var apiKey = "REMOVED_API_KEY"; // RECUERDA PONER TU CLAVE AQUÍ
  var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey;

  var estructuraCategorias = `
  - Comida: Antojo, Cafe, Restaurante, Mercado
  - Tienda TQ: Tienda TQ, TQ
  - Compras: Regalos, Electronica, Ropa y accesorios, Deporte
  - Tequi: Alimento, Snack, Veterinario, Juguete, Accesorio, Arena
  - Casa: Arriendo, Administración, Mantenimiento, Arreglo
  - Servicios: Internet, Emcali, Aseo, Gas
  - Transporte: Taxi, Uber, Transporte publico
  - Carro: SOAT, Tecnomecanica, Mantenimiento, Parqueadero, Gasolina
  - Entretenimiento: Alcohol, Salida, Concierto, Evento
  - Viaje: Tiquete, Hotel, Airbnb, Hostal
  - Suscripciones: Crunchyroll, Youtube, Google
  - Educación
  - Hobbies: Salsa, Plantas, Ceramica 
  - Eventos: Cumpleaños, Matrimonio, Grados
  - Belleza: Uñas, Peluquería
  - Salud, Medico, Medicamento, Examenes
  - Inversiones: Ale, Ahorro, Skandia
  - Ingreso: Salario, Arriendo
  `;

  var prompt = "Eres un asistente financiero experto. Tu tarea es clasificar un movimiento financiero en UNA SOLA subcategoría de la lista provista.\n\n" +
               "ESTRUCTURA DE CATEGORÍAS:\n" + estructuraCategorias + "\n\n" +
               "DATOS DE LA TRANSACCIÓN:\n" +
               "Comercio/Entidad: '" + comercio + "'\n" +
               "Nota del usuario: '" + nota + "'\n\n" +
               "REGLAS:\n" +
               "1. Analiza el comercio y la nota para deducir el gasto. Si no reconoces el comercio, búscalo para entender qué vende.\n" +
               "2. Responde con los nombres de la categoría y subcategoría elegida en formato 'Categoria | Subcategoria'.\n" +
               "3. Incluye la categoría principal, no uses comillas, ni puntos, ni des explicaciones.\n" +
               "4. Si es completamente imposible clasificarlo, responde: Compras | Compras.";

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
    var respuesta = json.candidates[0].content.parts[0].text.trim();
    var partes = respuesta.split(" | ");
    return {
      categoria: partes[0] ? partes[0].trim() : "Compras",
      subcategoria: partes[1] ? partes[1].trim() : "Compras"
    };
  } catch (e) {
    Logger.log("EL ERROR REAL ES: " + e.toString());
    Logger.log("Comercio: " + comercio + " | Nota: " + nota);
    return { categoria: "Compras", subcategoria: "Compras" };
  }
}

function categorizarHistorico() {
  var idArchivo = "1LyuDdPbMk5irN5LexWJUFyz_s1iTCnqCv2UUbfzbHPI";
  var ss = SpreadsheetApp.openById(idArchivo);
  var hojasAProcesar = ["Bancolombia", "Lulo"];
  var props = PropertiesService.getScriptProperties();

  var hojaIndex = parseInt(props.getProperty("hojaIndex") || "0");
  var filaIndex = parseInt(props.getProperty("filaIndex") || "1");

  var tiempoInicio = new Date().getTime();
  var LIMITE_MS = 5 * 60 * 1000; // 5 minutos para no pasarnos del límite

  for (var h = hojaIndex; h < hojasAProcesar.length; h++) {
    var sheet = ss.getSheetByName(hojasAProcesar[h]);
    if (!sheet) continue;

    var data = sheet.getDataRange().getValues();

    for (var i = filaIndex; i < data.length; i++) {

      // Si llevamos casi 5 minutos, guardamos progreso y paramos
      if (new Date().getTime() - tiempoInicio > LIMITE_MS) {
        props.setProperty("hojaIndex", h.toString());
        props.setProperty("filaIndex", i.toString());
        Logger.log("Pausado en hoja " + hojasAProcesar[h] + ", fila " + (i + 1));
        return;
      }

      var comercio = data[i][2];
      var nota = data[i][4];

      var resultado = { categoria: "", subcategoria: "" };
      var intentos = 0;

      while (resultado.categoria === "" && intentos < 3) {
        intentos++;
        try {
          resultado = clasificarConGemini(comercio, nota);
        } catch (err) {
          Logger.log("Intento " + intentos + " fallido: " + err.toString());
          Utilities.sleep(15000);
        }
      }

      var categoria = resultado.categoria || "Desconocido";
      var subcategoria = resultado.subcategoria || "Desconocido";

      sheet.getRange(i + 1, 6).setValue(categoria);
      sheet.getRange(i + 1, 7).setValue(subcategoria);

      Utilities.sleep(2000);
    }

    // Terminó esta hoja, pasa a la siguiente desde fila 1
    filaIndex = 1;
  }

  // Si llegó aquí, terminó todo — limpiamos el progreso y borramos el trigger
  props.deleteProperty("hojaIndex");
  props.deleteProperty("filaIndex");
  eliminarTrigger();
  Logger.log("¡Recategorización completa!");
}

function eliminarTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var t = 0; t < triggers.length; t++) {
    if (triggers[t].getHandlerFunction() === "categorizarHistorico") {
      ScriptApp.deleteTrigger(triggers[t]);
    }
  }
}

function iniciarRecategorizacion() {
  // Limpia progreso anterior por si acaso
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty("hojaIndex");
  props.deleteProperty("filaIndex");

  // Crea trigger que ejecuta cada 8 minutos
  ScriptApp.newTrigger("categorizarHistorico")
    .timeBased()
    .everyMinutes(10)
    .create();

  // Corre la primera vez inmediatamente
  categorizarHistorico();
}

function simularNotificacion() {
  var url = "https://script.google.com/macros/s/AKfycbx57WOlz62QlLjxOa1K1kiJryUWJAyWcrUmEB2MflhTXoAgf74tNAb27EKvomA1Qxk6/exec"; // La misma URL que usa MacroDroid

  var payload = {
    "texto": "$762.904 en CLAUDE.AI SUBSCRIPTION con tu tarjeta de crédito • 7068",
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