function doPost(e) {
  var idArchivo = "GOOGLE-SHEETS-ID";
  var ss = SpreadsheetApp.openById(idArchivo);
  var sheet = ss.getSheets()[0];
  
  var data = JSON.parse(e.postData.contents);
  var texto = data.texto || "";
  var titulo = data.banco || ""; //
  var fecha = new Date();

  // 1. EXTRAE EL VALOR
  var montoMatch = texto.match(/\$\s?([0-9.,]+)/);
  var valorStr = montoMatch ? montoMatch[1].replace(/\./g, "").replace(/,/g, "") : "0";
  var valorNum = parseFloat(valorStr);

  // 2. DETERMINAR SIGNO Y CATEGORÍA (Basado en el TÍTULO y TEXTO)
  // Buscamos "Envío" o "Recibiste" sin importar mayúsculas/minúsculas
  var esEgreso = /envío|pagaste|compra/i.test(titulo) || /envío|pagaste|compra/i.test(texto);
  var esIngreso = /recibiste|llegó/i.test(titulo) || /recibiste|llegó/i.test(texto);

  var categoria = "Otros";
  if (esEgreso) {
    valorNum = valorNum * -1;
    categoria = "Gastos";
  } else if (esIngreso) {
    categoria = "Ingresos";
  }

  // 3. EXTRAER NOMBRE PARA OBSERVACIONES
  var observaciones = "";
  var comercio = "Lulo App";
  
  // Expresión para capturar el nombre después de " a " o " de "
  var nombreMatch = texto.match(/(?:\s(?:a|de)\s)([^.]+)/i);
  if (nombreMatch && nombreMatch[1]) {
    var nombrePersona = nombreMatch[1].split(" Y lo mejor")[0].trim();
    observaciones = (valorNum < 0 ? "Enviado a: " : "Recibido de: ") + nombrePersona;
  }

  // 4. DEFINIR COMERCIO (Si es Bre-B o lugar físico)
  if (/bre-b/i.test(titulo + texto)) {
    comercio = "Bre-B";
    if (valorNum < 0) categoria = "Transferencia Enviada";
    else categoria = "Transferencia Recibida";
  } else if (texto.includes(" en ")) {
    comercio = texto.split(" en ")[1].split(" por ")[0].split(".")[0].trim().toUpperCase();
  }

  // 5. PRODUCTO
  var producto = /crédito/i.test(titulo + texto) ? "T.Credito" : "Lulo";

  // 6. ESCRIBIR EN EL EXCEL
  // Orden: Fecha | Valor | Comercio | Categoría | Producto | Observaciones
  sheet.appendRow([
    fecha, 
    valorNum, 
    comercio, 
    categoria, 
    producto, 
    observaciones
  ]);

  return ContentService.createTextOutput("OK");
}