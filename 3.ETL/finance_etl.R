install.packages('googlesheets4')

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

transactions$Subcategoria <- gsub("medicamento", "Medicamento", transactions$Subcategoria)

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

# Verifico la conexión y cierro
dbListTables(con)
dbDisconnect(con)
