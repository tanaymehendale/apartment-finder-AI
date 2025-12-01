import pandas as pd
import json
import os
import asyncio
from mcp import StdioServerParameters, ClientSession
from mcp.client.stdio import stdio_client

# --- GLOBAL DATA LOADING (The "In-Memory Database") ---
# We load the dataset into memory immediately upon startup.
# This ensures that agent queries are instant (O(1) lookup) rather than reading from disk every time.

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


# ------------------------------
# CUSTOM FUNCTION DEFINITIONS
# -----------------------------

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
    # Fail fast if DB is empty
    if df.empty:
        return json.dumps({"error": "Database is unavailable."})

    # Normalize inputs for comparison (lowercase, stripped)
    target_city = city.lower().strip()
    target_state = state.lower().strip()
    
    # Apply Filters
    # We look for exact state match and city match, plus budget.
    matches = df[
        (df['city'].str.lower() == target_city) & 
        (df['state'].str.lower() == target_state) &
        (df['monthly_price'] <= max_budget)
    ]
    
    # Handle "No Results"
    if matches.empty:
        return json.dumps({
            "message": f"No apartments found in {city}, {state} under ${max_budget}.",
            "count": 0
        })

    # Select Output Columns (Token Optimization)
    # We select ONLY the columns the agent needs to reason and call the next tool.
    # 'latitude' and 'longitude' are crucial for the subsequent Maps MCP call.
    results = matches[[
        'id', 
        'agent_description', 
        'monthly_price', 
        'address',
        'city',
        'state', 
        'latitude', 
        'longitude'
    ]].head(5) # STRICT LIMIT: Only top 5 to save on tokens
    
    # Return as JSON
    return results.to_json(orient="records")



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

    # Configure the Server Process
    server_params = StdioServerParameters(
        command="node", 
        args=[SERVER_PATH],
        env={"GOOGLE_MAPS_API_KEY": os.getenv("GOOGLE_MAPS_API_KEY")}
    )

    try:
        # Connect to the Server
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                
                # Call the 'maps_distance_matrix' tool
                # This single call processes ALL origins against the destination
                result = await session.call_tool(
                    "maps_distance_matrix", 
                    arguments={
                        "origins": origins, 
                        "destinations": [destination],
                        "mode": mode
                    }
                )
                
                # Extract raw text (containing \n)
                raw_text = result.content[0].text
                
                # Parse and re-dump to remove \n and spaces
                # This ensures the Agent gets valid, compact JSON
                try:
                    data = json.loads(raw_text)
                    return json.dumps(data, separators=(',', ':')) # Minified JSON
                except json.JSONDecodeError:
                    # If Maps returns an error message (not JSON), return raw text
                    return raw_text
                

    except Exception as e:
        return f"Error connecting to Maps MCP: {str(e)}"