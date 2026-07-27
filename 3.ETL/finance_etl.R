library(googlesheets4)
library(janitor)
library(tidyverse)

#Autenticarse
gs4_auth(path = "gs4-service-account.json")

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

categories <- transacciones %>%
    distinct(Categoria) %>%
    rename(cat_name = Categoria)

## Subo categories y verifico

base_cat <- dbReadTable(con, "categories")
nuevas_cat <- anti_join(categories, base_cat, join_by(cat_name))
dbWriteTable(con, 'categories', nuevas_cat, append = TRUE)
cat <- dbReadTable(con, "categories")

## Creo subcategories

subcategories <- transacciones %>% 
  left_join(cat, join_by(Categoria == cat_name)) %>% 
  select(Subcategoria, cat_id) %>% 
  rename(subcat_name = Subcategoria) %>% 
  distinct(subcat_name, cat_id)

## Subo subcategories y verifico

base_subcat <- dbReadTable(con, "subcategories")
nuevas_subcat <- anti_join(subcategories, base_subcat, join_by(subcat_name == subcat_name, cat_id == cat_id))
dbWriteTable(con, 'subcategories', nuevas_subcat, append = TRUE)
subcat <- dbReadTable(con, "subcategories")

## Creo account

accounts <- transacciones %>% 
  distinct(producto, cuenta) %>% 
  rename(acc_name = producto,
         acc_type = cuenta)

## Subo account y verifico

base_acc <- dbReadTable(con, "accounts")
nuevas_acc <- anti_join(accounts, base_acc, join_by(acc_name, acc_type))
dbWriteTable(con, 'accounts', nuevas_acc, append = TRUE)
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

base <- dbReadTable(con, "transactions")
transactions <- transactions %>% mutate(date_key = format(date, "%Y-%m-%d %H:%M:%S"))
base <- base %>% mutate(date_key = format(date, "%Y-%m-%d %H:%M:%S"))
nuevas <- anti_join(transactions, base, join_by(date_key)) %>% select(-date_key)
dbWriteTable(con, 'transactions', nuevas, append = TRUE)

# Me desconecto
dbDisconnect(con)