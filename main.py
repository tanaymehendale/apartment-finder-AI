import asyncio
import os
from dotenv import load_dotenv
from google.adk.runners import InMemoryRunner 
from agents.apartment_finder.agent import root_agent

load_dotenv()

async def main():
    print("🏗️ ApartmentFinder System Starting (Debug Mode)...")
    
    # Initialize the Runner (It handles Session memory automatically)
    runner = InMemoryRunner(agent=root_agent)

    print("\n✅ System Ready! The Manager is listening. (Type 'quit' to exit)")

    while True:
        try:
            user_input = input("\nUser >> ")
            if user_input.lower() in ["quit", "exit"]:
                break
            
            print("\n" + "="*50)
            
            # run_debug() automatically prints:
            # 1. The Agent's reasoning
            # 2. Tool execution & results
            # 3. Agent transfers (Manager -> Analyst)
            await runner.run_debug(user_input)
            
            print("="*50)

        except Exception as e:
            print(f"\n❌ Error: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    # Ensure we have the Maps Key before starting
    if not os.getenv("GOOGLE_MAPS_API_KEY"):
        print("⚠️ WARNING: GOOGLE_MAPS_API_KEY is missing from .env")
    
    asyncio.run(main())