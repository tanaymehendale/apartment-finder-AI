# Test script to verify the check_commutes and fetch_apartments tools directly
import os
from dotenv import load_dotenv
from apartment_finder.tools import check_commutes, fetch_apartments

load_dotenv()

def test_check_commutes():
    print("🧪 Testing 'check_commutes' tool...")

    test_origins = [
        "30.2672,-97.7431",  # Downtown Austin
        "30.2422,-97.7552",  # South Congress
        "30.4015,-97.7195",  # The Domain (North Austin)
    ]
    test_destination = "Austin-Bergstrom International Airport, Austin, TX"

    result = check_commutes(origins=test_origins, destination=test_destination, mode="driving")
    print("\n✅ check_commutes output:")
    print(result)

def test_fetch_apartments():
    print("\n🧪 Testing 'fetch_apartments' tool...")
    result = fetch_apartments(city="Austin", state="TX", max_budget=2000)
    print("\n✅ fetch_apartments output:")
    print(result)

if __name__ == "__main__":
    if not os.getenv("GOOGLE_MAPS_API_KEY"):
        print("❌ Error: GOOGLE_MAPS_API_KEY not found in .env")
    else:
        test_check_commutes()
        test_fetch_apartments()
