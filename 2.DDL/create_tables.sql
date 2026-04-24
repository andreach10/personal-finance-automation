-- Transaction category
CREATE TABLE categories (
  cat_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cat_name VARCHAR NOT NULL
)

-- Transaction subcategory
CREATE TABLE subcategories (
  subcat_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subcat_name VARCHAR NOT NULL,
  cat_id INT NOT NULL REFERENCES categories(cat_id)
)

-- Bank account
CREATE TABLE accounts (
  acc_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  acc_name VARCHAR NOT NULL,
  acc_type VARCHAR NOT NULL
)

-- Budget
CREATE TABLE budget (
  bgt_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bgt_month DATE NOT NULL,
  bgt_amount NUMERIC NOT NULL,
  bgt_qty INT,
  qty_amount INT,
  cat_id INT NOT NULL REFERENCES categories(cat_id),
  subcat_id INT REFERENCES subcategories(subcat_id),
  CONSTRAINT qty_check CHECK ((qty_amount IS NOT NULL AND bgt_qty IS NOT NULL) OR (qty_amount IS NULL AND bgt_qty IS NULL))
)

-- Transactions
CREATE TABLE transactions (
  txn_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date TIMESTAMPTZ NOT NULL,
  amount NUMERIC NOT NULL,
  store VARCHAR NOT NULL,
  note VARCHAR,
  cat_id INT NOT NULL REFERENCES categories(cat_id),
  subcat_id INT NOT NULL REFERENCES subcategories(subcat_id),
  acc_id INT NOT NULL REFERENCES accounts(acc_id)
)
