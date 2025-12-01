# This is a test script to verify the working of 'check_commutes' tool
import asyncio
import os
from dotenv import load_dotenv
from agents.apartment_finder.tools import check_commutes

load_dotenv()

async def run_test():
    print("🧪 Testing 'check_commutes' tool...")
    
    # Mock Data (Simulating what the Agent would extract from JSON)
    test_origins = [
        "30.2672,-97.7431",  # Downtown Austin
        "30.2422,-97.7552",  # South Congress
        "30.4015,-97.7195"   # The Domain (North Austin)
    ]
    
    test_destination = "Austin-Bergstrom International Airport"
    
    # Call the function directly
    result = await check_commutes(
        origins=test_origins, 
        destination=test_destination,
        mode="transit" # OR 'driving'
    )
    
    print("\n✅ Tool Output:")
    print(result)

if __name__ == "__main__":
    # Checking if API Key is loaded first
    if not os.getenv("GOOGLE_MAPS_API_KEY"):
        print("❌ Error: GOOGLE_MAPS_API_KEY not found in .env")
    else:
        asyncio.run(run_test())