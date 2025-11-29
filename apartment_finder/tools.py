# Define tools that agents will use
import pandas as pd
import json
import os

# --- 1. GLOBAL DATA LOADING (The "In-Memory Database") ---
# We load this once when the app starts. 
# This prevents re-reading the CSV for every user query.

DATA_PATH = os.path.join("data", "apartments_cleaned.csv")

try:
    print(f"📂 Loading apartment data from {DATA_PATH}...")
    df = pd.read_csv(DATA_PATH)
    print(f"✅ Data loaded! {len(df)} listings available.")
    
    # Ensure state/city are string types to prevent errors during filtering
    df['city'] = df['city'].astype(str)
    df['state'] = df['state'].astype(str)

except FileNotFoundError:
    print(f"❌ ERROR: Could not find {DATA_PATH}. Please run your preprocessing script first.")
    # Create an empty DF to prevent the tool from crashing the app entirely
    df = pd.DataFrame()


# ------------------------------------------------------------------------------- #
# TOOL 2: fetch_apartments - Gets relevant apartment data from mock dataset
# ------------------------------------------------------------------------------- #

def fetch_apartments(city: str, state: str, max_budget: float):
    """
    Queries the local database for apartments matching the location and budget.
    
    Args:
        city (str): The target city (e.g., 'Austin')
        state (str): The target state abbreviation (e.g., 'TX')
        max_budget (float): The maximum monthly rent the user is willing to pay.
        
    Returns:
        str: A JSON string containing the Top 5 matching apartments with 
             id, description, price, address, city, state, latitude, and longitude.
    """
    # 1. Fail fast if DB is empty
    if df.empty:
        return json.dumps({"error": "Database is unavailable."})

    # 2. Normalize inputs for comparison (lowercase, stripped)
    target_city = city.lower().strip()
    target_state = state.lower().strip()
    
    # 3. Apply Filters
    # We look for exact state match and city match, plus budget.
    matches = df[
        (df['city'].str.lower() == target_city) & 
        (df['state'].str.lower() == target_state) &
        (df['monthly_price'] <= max_budget)
    ]
    
    # 4. Handle "No Results"
    if matches.empty:
        return json.dumps({
            "message": f"No apartments found in {city}, {state} under ${max_budget}.",
            "count": 0
        })

    # 5. Select Output Columns (Token Optimization)
    # We only send specific columns to the Agent to save context window space.
    # We exclude 'body' (description) as it's too long; 'agent_description' is better.
    results = matches[[
        'id', 
        'agent_description', 
        'monthly_price', 
        'address',
        'city',
        'state', 
        'latitude', 
        'longitude'
    ]].head(5) # STRICT LIMIT: Only top 5
    
    # 6. Return as JSON
    return results.to_json(orient="records")

# --------------------------------------------------------- #
# TOOL 3: check_commutes using Google Maps MCP Server
# --------------------------------------------------------- #
import asyncio
from mcp import StdioServerParameters, ClientSession
from mcp.client.stdio import stdio_client

# Path to the local MCP server file (relative to project root)
SERVER_PATH = os.path.join(os.getcwd(), "node_modules", "@modelcontextprotocol", "server-google-maps", "dist", "index.js")

async def check_commutes(origins: list[str], destination: str, mode: str = "driving"):
    """
    Calculates distances and commute times from multiple origins to a single destination using the Maps MCP.
    
    Args:
        origins: A list of lat/lng strings (e.g., ["30.26,-97.74", "30.50,-97.60"])
        destination: The target landmark name or address (e.g., "Austin Airport")
        mode: Transport mode (default: "driving")
        
    Returns:
        str: A raw JSON string containing distance and duration for each origin.
    """
    print(f"   🔌 MCP: Checking commutes for {len(origins)} locations to '{destination}'...")

    # 1. Configure the Server Process
    server_params = StdioServerParameters(
        command="node", 
        args=[SERVER_PATH],
        env={"GOOGLE_MAPS_API_KEY": os.getenv("GOOGLE_MAPS_API_KEY")}
    )

    try:
        # 2. Connect to the Server
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                
                # 3. Call the 'maps_distance_matrix' tool
                # This single call processes ALL origins against the destination
                result = await session.call_tool(
                    "maps_distance_matrix", 
                    arguments={
                        "origins": origins, 
                        "destinations": [destination],
                        "mode": mode
                    }
                )
                
                # 1. Extract raw text (contains \n)
                raw_text = result.content[0].text
                
                # 2. CLEANUP: Parse and re-dump to remove \n and spaces
                # This ensures the Agent gets valid, compact JSON
                try:
                    data = json.loads(raw_text)
                    return json.dumps(data, separators=(',', ':')) # Minified JSON
                except json.JSONDecodeError:
                    # If Maps returns an error message (not JSON), return raw text
                    return raw_text
                

    except Exception as e:
        return f"Error connecting to Maps MCP: {str(e)}"