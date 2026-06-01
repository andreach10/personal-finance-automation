library(googlesheets4)
library(janitor)
library(tidyverse)

# Importo los datos con el API de Tidyverse
Bancolombia <- read_sheet(Sys.getenv("SHEETS_ID"), sheet = 'Bancolombia')
Lulo <- read_sheet(Sys.getenv("SHEETS_ID"), sheet = 'Lulo')

# Verifico que tengo las mismas columnas
compare_df_cols(Bancolombia, Lulo)

# Uno las bases
transacciones <- bind_rows(Bancolombia, Lulo)

compare_df_cols(transacciones)
lapply(transacciones, function(x) 
{sort(unique(x))})

transacciones <- transacciones %>% 
  mutate(producto = case_when(
    Producto == 'T.Credito Bancolombia' ~ 'Bancolombia',
    .default = 'Lulo Bank'
  ),
  cuenta = case_when(
    Producto %in% c('T.Credito Bancolombia', 'Lulo Credito', 'T.Credito Lulo') ~ 'Credito',
    .default = 'Debito'
  ))

transacciones$Subcategoria <- gsub("medicamento", "Medicamento", transacciones$Subcategoria)

# Creo mis variables .env

host <- Sys.getenv("SUPABASE_HOST")
port <- as.integer(Sys.getenv("SUPABASE_PORT"))
database <- Sys.getenv("SUPABASE_DB")
user <- Sys.getenv("SUPABASE_USER")
password <- Sys.getenv("SUPABASE_PW")

#Conecto al db
library(DBI)
library(RPostgres)

con <- dbConnect(
  RPostgres::Postgres(),
  dbname = database,
  host = host,
  port = port,
  user = user,
  password = password
)

# Verifico la conexión
dbListTables(con)

# Creo y subo las tablas

## Creo categories

categories <- data.frame(
  cat_name = c("Comida", "Tienda TQ", "Compras", "Tequi", "Casa", "Servicios", 
               "Transporte", "Carro", "Entretenimiento", "Viaje", "Suscripciones", 
               "Educación", "Hobbies", "Eventos", "Belleza", "Salud", 
               "Inversiones", "Ingreso", "Tarjeta de credito")
)

## Subo categories y verifico

dbWriteTable(con, 'categories', categories, append = TRUE)
cat <- dbReadTable(con, "categories")

## Creo subcategories

subcategories <- transacciones %>% 
  left_join(cat, join_by(Categoria == cat_name)) %>% 
  select(Subcategoria, cat_id) %>% 
  rename(subcat_name = Subcategoria) %>% 
  distinct(subcat_name, cat_id)

## Subo subcategories y verifico

dbWriteTable(con, 'subcategories', subcategories, append = TRUE)
subcat <- dbReadTable(con, "subcategories")

## Creo account

account <- transacciones %>% 
  distinct(producto, cuenta) %>% 
  rename(acc_name = producto,
         acc_type = cuenta)

## Subo account y verifico

dbWriteTable(con, 'accounts', account, append = TRUE)
acc <- dbReadTable(con, "accounts")

## Creo transactions

transactions <- transacciones %>% 
  rename(date = Fecha,
         amount = Valor,
         store = Comercio,
         note = Nota) %>% 
  left_join(acc, join_by(producto == acc_name, cuenta == acc_type))

transactions <- transactions %>% 
  left_join(cat, join_by(Categoria == cat_name))

transactions <- transactions %>% 
  left_join(subcat %>% select(subcat_id, cat_id, subcat_name), 
            join_by(Subcategoria == subcat_name, cat_id == cat_id)) %>% 
  select(date, amount, store, note, cat_id, subcat_id, acc_id)

## Subo transactions y verifico

dbWriteTable(con, 'transactions', transactions, append = TRUE)
trx <- dbReadTable(con, "transactions")

# Me desconecto
dbDisconnect(con)
