# Preprocessing of mock data (using dataset from Kaggle)
import pandas as pd
import kagglehub
import os

apartments_path = kagglehub.dataset_download("adithyaawati/apartments-for-rent-classified")

# List the contents of the path directory to identify the data file
apartments_csv_file_path = os.path.join(apartments_path + '/apartments_for_rent_classified_100K', 'apartments_for_rent_classified_100K.csv')
df_apartments = pd.read_csv(apartments_csv_file_path, sep=";", encoding='cp1252')

# Dropping unnecessary columns
df_apartments = df_apartments.drop(columns=['title', 'amenities', 'fee', 'has_photo', 'pets_allowed', 'price', 'source', 'time'])

# Remove rows in df_apartments where both address and latitude are null
df_apartments = df_apartments.dropna(subset=['address', 'latitude'], how='all')

# Convert datatypes into appropriate types

# Convert category, body, currency, price_display, price_type, address, cityname, state to String
df_apartments['category'] = df_apartments['category'].astype(str)
df_apartments['body'] = df_apartments['body'].astype(str)
df_apartments['currency'] = df_apartments['currency'].astype(str)
df_apartments['price_display'] = df_apartments['price_display'].astype(str)
df_apartments['price_type'] = df_apartments['price_type'].astype(str)
df_apartments['address'] = df_apartments['address'].astype(str)
df_apartments['cityname'] = df_apartments['cityname'].astype(str)
df_apartments['state'] = df_apartments['state'].astype(str)

# Clean category data
# Split new category after the string 'housing/rent'
df_apartments['category'] = df_apartments['category'].str.split('/').str[2]

# Fill nan category with the value apartment/home
df_apartments['category'] = df_apartments['category'].fillna('apartment/home')

# Rename columns
# Rename 'price_display' to 'price', 'cityname' to 'city'
df_apartments = df_apartments.rename(columns={'price_display': 'price', 'cityname': 'city'})

# Change category of records where price_type is not Monthly, to 'short_term'
df_apartments.loc[df_apartments['price_type'] != 'Monthly', 'category'] = 'short_term'

# Strip non-numeric characters in price column
df_apartments.loc[df_apartments['price_type'] != 'Monthly', 'price'] = df_apartments.loc[df_apartments['price_type'] != 'Monthly', 'price'].str.replace(r'\D', '', regex=True)

# Remove the $ and , signs for all records of price column (replace all occurences)
df_apartments['price'] = df_apartments['price'].astype(str).str.replace(r'\$', '', regex=True).str.replace(',', '', regex=True)

# Function to handle price ranges and convert to float
def parse_price_range_and_convert(price_str):
    if isinstance(price_str, str):
        if '-' in price_str:
            try:
                parts = price_str.split('-')
                lower = float(parts[0].strip())
                upper = float(parts[1].strip())
                return (lower + upper) / 2
            except ValueError:
                return None # Return None for unparseable parts
        else:
            try:
                return float(price_str.strip())
            except ValueError:
                return None # Return None for single unparseable string
    return price_str # Return as is if not a string (e.g., already float or NaN)

# Apply the function to the price column to handle ranges and convert to float
df_apartments['price'] = df_apartments['price'].apply(parse_price_range_and_convert)


# Change price_type to Weekly for records where price_type = Monthly|Weekly
df_apartments.loc[df_apartments['price_type'] == 'Monthly|Weekly', 'price_type'] = 'Weekly'

# Convert Weekly prices to Monthly prices by multiplying by 4.3 (average weeks in a month)
df_apartments.loc[df_apartments['price_type'] == 'Weekly', 'price'] = df_apartments.loc[df_apartments['price_type'] == 'Weekly', 'price'] * 4.3

# Drop the price_type column and rename the 'price' column to 'monthly_price'
df_apartments = df_apartments.drop(columns=['price_type'])
df_apartments = df_apartments.rename(columns={'price': 'monthly_price'})

# Fill missing monthly_price with the average monthly_price for records where city = 'Orlando' AND state = 'FL'
df_apartments.loc[df_apartments['monthly_price'].isnull(), 'monthly_price'] = df_apartments.loc[(df_apartments['city'] == 'Orlando') & (df_apartments['state'] == 'FL'), 'monthly_price'].mean()

# Handle NaN and 0.0 for bathrooms and bedrooms


# For bathrooms, fill NaN or 0.0 with 1.0 as any apartment has at least 1 bathroom
df_apartments['bathrooms'] = df_apartments['bathrooms'].fillna(1.0)
df_apartments.loc[df_apartments['bathrooms'] == 0.0, 'bathrooms'] = 1.0


# For bedrooms, assuming NaN is 1.0 (safe bet). If bedrooms = 0.0 then that means a Studio apartment
df_apartments['bedrooms'] = df_apartments['bedrooms'].fillna(1.0)


# This helps the LLM understand "0.0" means "Studio"
def make_desc(row):
    bed_str = "Studio" if row['bedrooms'] == 0.0 else f"{int(row['bedrooms'])} Bed"
    bath_str = f"{int(row['bathrooms'])} Bath"
    return f"{bed_str}, {bath_str} apartment in {row['city']}, {row['state']}"

df_apartments['agent_description'] = df_apartments.apply(make_desc, axis=1)

# Save this to a CSV file in a specified path
df_apartments.to_csv('data/apartments_cleaned.csv', index=False)