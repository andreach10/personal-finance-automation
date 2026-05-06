library(googlesheets4)
library(janitor)
library(tidyverse)

# Importo los datos con el API de Tidyverse
Bancolombia <- read_sheet(Sys.getenv("SHEETS_ID"), sheet = 'Bancolombia')
Lulo <- read_sheet(Sys.getenv("SHEETS_ID"), sheet = 'Lulo')

# Verifico que tengo las mismas columnas
compare_df_cols(Bancolombia, Lulo)

# Uno las bases
transactions <- bind_rows(Bancolombia, Lulo)

compare_df_cols(transactions)
lapply(transactions, function(x) 
  {sort(unique(x))})

transactions <- transactions %>% 
  mutate(producto = case_when(
    Producto == 'T.Credito Bancolombia' ~ 'Bancolombia',
    .default = 'Lulo Bank'
  ),
  cuenta = case_when(
    Producto %in% c('T.Credito Bancolombia', 'Lulo Credito', 'T.Credito Lulo') ~ 'Credito',
    .default = 'Debito'
  ))

transactions$Subcategoria <- gsub("medicamento", "Medicamento", transactions$Subcategoria)

# Creo mis db

paste(unique(Bancolombia$Categoria), collapse = "', '")
categories <- data.frame(
  cat_name = c("Comida", "Tienda TQ", "Compras", "Tequi", "Casa", "Servicios", 
               "Transporte", "Carro", "Entretenimiento", "Viaje", "Suscripciones", 
               "Educación", "Hobbies", "Eventos", "Belleza", "Salud", 
               "Inversiones", "Ingreso", "Tarjeta de credito")
)

subcategories <- transactions %>% 
  left_join(cat, join_by(Categoria == cat_name)) %>% 
  select(Subcategoria, cat_id) %>% 
  rename(subcat_name = Subcategoria) %>% 
  distinct(subcat_name, cat_id)

paste(unique(transactions$Producto), collapse = "', '")
account <- transactions %>% 
  distinct(producto, cuenta) %>% 
  rename(acc_name = producto,
         acc_type = cuenta)

months <- seq(as.Date("2026-01-17"), by = "month", length.out = 5)
categories <- unlist(cat$cat_id)
month_combinations <- expand.grid(months, categories) %>% 
  rename(month = Var1,
         cat_id = Var2)
class(month_combinations$month)

# Creo mis variables .env
usethis::edit_r_environ()

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

dbWriteTable(con, 'categories', categories, append = TRUE)
dbWriteTable(con, 'subcategories', subcategories, append = TRUE)
dbWriteTable(con, 'accounts', account, append = TRUE)

cat <- dbReadTable(con, "categories")
subcat <- dbReadTable(con, "subcategories")
acc <- dbReadTable(con, "accounts")

# Verifico la conexión
dbListTables(con)
dbDisconnect(con)
